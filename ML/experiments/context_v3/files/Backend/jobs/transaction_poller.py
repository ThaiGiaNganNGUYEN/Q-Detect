"""Recurring job: pull the next batch of staging transactions, oldest first.

Started via POST /api/util/jobs/start, or by main.py on app startup when
AUTO_START_POLLER=true. Every POLL_INTERVAL_SECONDS:
    1. read this job's checkpoint (last processed staging_transaction.id)
    2. fetch the next BATCH_SIZE rows after it into a DataFrame
    3. process the batch
    4. advance the checkpoint

Pages by id, not timestamp: ids run in chronological order (see
scripts/load_transactions.py) and are unique, while timestamps only have
minute precision and repeat across hundreds of rows.

The checkpoint only moves after process_batch succeeds, so a crash mid-batch
re-runs that batch on the next tick instead of skipping it.

start()/stop() control the loop (used by main.py and routers/util_router.py).
Every batch and every checkpoint reset holds _batch_lock, so a reset never
lands mid-batch and then gets overwritten when that batch saves.
"""

import asyncio
import threading
import traceback
from contextlib import suppress
from datetime import datetime, timezone

import pandas as pd
from sqlmodel import Session, SQLModel, text

from db import get_staging_engine
from models import IngestionCheckpoint, StagingTransaction
from services.cache_store import clear_cache as clear_cache_db, write_scored_batch
from services.transaction_scoring import context_rows, save_output, score_transactions

JOB_NAME = "transaction_poller"
BATCH_SIZE = 50_000
POLL_INTERVAL_SECONDS = 300

# The n rows just before a batch, newest first -- graph context for models that use it.
CONTEXT_SQL = text(
    f"SELECT * FROM {StagingTransaction.__tablename__} "
    "WHERE id < :first_id ORDER BY id DESC LIMIT :limit"
)
FETCH_SQL = text(
    f"SELECT * FROM {StagingTransaction.__tablename__} "
    "WHERE id > :last_id ORDER BY id LIMIT :limit"
)

_batch_lock = threading.Lock()
_task: asyncio.Task | None = None


def get_last_id(session: Session) -> int:
    checkpoint = session.get(IngestionCheckpoint, JOB_NAME)
    return checkpoint.lastId if checkpoint else 0


def save_last_id(session: Session, last_id: int) -> None:
    checkpoint = session.get(IngestionCheckpoint, JOB_NAME) or IngestionCheckpoint(jobName=JOB_NAME)
    checkpoint.lastId = last_id
    checkpoint.updatedAt = datetime.now(timezone.utc)
    session.add(checkpoint)
    session.commit()


def fetch_batch(last_id: int) -> pd.DataFrame:
    return pd.read_sql(
        FETCH_SQL, get_staging_engine(), params={"last_id": last_id, "limit": BATCH_SIZE}
    )


def process_batch(df: pd.DataFrame) -> None:
    first_id, last_id = int(df["id"].iloc[0]), int(df["id"].iloc[-1])
    n_context = context_rows()
    context = None
    if n_context:
        context = pd.read_sql(
            CONTEXT_SQL, get_staging_engine(), params={"first_id": first_id, "limit": n_context}
        ).iloc[::-1]  # oldest first
    result = score_transactions(df, context)
    output_path = save_output(result, first_id, last_id)
    accounts, transactions = write_scored_batch(result)
    print(
        f"[{JOB_NAME}] Scored {result['n_edges']:,} rows "
        f"(id {first_id}-{last_id}, "
        f"{df['timestamp'].iloc[0]} -> {df['timestamp'].iloc[-1]}): "
        f"{sum(result['flagged']):,} flagged (>= {result['decision_threshold']:.4f}); "
        f"cached {transactions:,} transactions, {accounts:,} accounts; output -> {output_path}"
    )


def run_once() -> int:
    """Process one batch. Returns the number of rows processed (0 when caught up)."""
    engine = get_staging_engine()
    SQLModel.metadata.create_all(engine, tables=[IngestionCheckpoint.__table__])

    with _batch_lock:
        with Session(engine) as session:
            last_id = get_last_id(session)

        df = fetch_batch(last_id)
        if df.empty:
            print(f"[{JOB_NAME}] No new transactions after id {last_id}")
            return 0

        process_batch(df)

        with Session(engine) as session:
            save_last_id(session, int(df["id"].iloc[-1]))
        return len(df)


def _delete_checkpoint() -> int | None:
    with Session(get_staging_engine()) as session:
        checkpoint = session.get(IngestionCheckpoint, JOB_NAME)
        if checkpoint is None:
            return None
        session.delete(checkpoint)
        session.commit()
        return checkpoint.lastId


def reset_checkpoint() -> int | None:
    """Delete this job's checkpoint so the next batch starts from id 1.

    Waits for a batch in progress to finish first. Returns the lastId it was
    at, or None if there was no checkpoint.
    """
    with _batch_lock:
        return _delete_checkpoint()


def clear_cache(reset: bool = False) -> dict:
    """Empty the cache DB, optionally resetting the checkpoint in the same step.

    Waits for a batch in progress to finish first, so a half-written batch
    can't survive the clear.
    """
    with _batch_lock:
        accounts, transactions = clear_cache_db()
        previous_last_id = _delete_checkpoint() if reset else None
    return {
        "accountsDeleted": accounts,
        "transactionsDeleted": transactions,
        "checkpointReset": reset,
        "previousLastId": previous_last_id,
    }


def get_checkpoint() -> IngestionCheckpoint | None:
    with Session(get_staging_engine()) as session:
        return session.get(IngestionCheckpoint, JOB_NAME)


def is_running() -> bool:
    return _task is not None and not _task.done()


def is_batch_in_progress() -> bool:
    return _batch_lock.locked()


async def run_forever() -> None:
    """Run a batch every POLL_INTERVAL_SECONDS until cancelled.

    The DB and pandas work is blocking, so it runs in a worker thread to keep
    the API's event loop responsive. A failed tick is logged and retried on
    the next one rather than killing the loop.
    """
    while True:
        try:
            await asyncio.to_thread(run_once)
        except Exception:
            traceback.print_exc()
        await asyncio.sleep(POLL_INTERVAL_SECONDS)


def start() -> bool:
    """Start the loop on the running event loop. Returns False if already running."""
    global _task
    if is_running():
        return False
    _task = asyncio.create_task(run_forever())
    return True


async def stop() -> bool:
    """Stop the loop. Returns False if it wasn't running.

    Cancelling can't interrupt a batch already running in its worker thread,
    so this also waits for that batch to finish -- once it returns, nothing
    is scoring or writing.
    """
    global _task
    if not is_running():
        return False
    _task.cancel()
    with suppress(asyncio.CancelledError):
        await _task
    _task = None
    await asyncio.to_thread(_wait_for_batch)
    return True


def _wait_for_batch() -> None:
    with _batch_lock:
        pass
