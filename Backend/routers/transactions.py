import json
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from db import get_engine
from services.transactions import clean_transactions, fetch_transactions

router = APIRouter(prefix="/transactions", tags=["transactions"])


def _to_records(df) -> list[dict]:
    """Serialize a DataFrame to JSON-safe records (handles numpy/Timestamp dtypes)."""
    return json.loads(df.to_json(orient="records", date_format="iso"))


@router.get("/recent")
def get_recent_transactions(
    engine=Depends(get_engine),
    minutes: int = Query(60, ge=1, le=10_080, description="How far back to pull, in minutes"),
    limit: int = Query(1_000, ge=1, le=50_000, description="Max rows to return"),
):
    """Pull + clean the most recent transactions within a time window."""
    where_clause = (
        f"WHERE timestamp >= now() - interval '{minutes} minutes' "
        f"ORDER BY timestamp DESC LIMIT {limit}"
    )
    df = fetch_transactions(engine, where_clause)
    df = clean_transactions(df)
    return _to_records(df)


@router.get("/oldest")
def get_oldest_transactions(
    engine=Depends(get_engine),
    start_date: datetime | None = Query(None, description="Only return rows at/after this timestamp"),
    end_date: datetime | None = Query(None, description="Only return rows at/before this timestamp"),
    limit: int = Query(30_000, ge=1, le=50_000, description="Max rows to return"),
):
    """Pull transactions, optionally bounded to a [start_date, end_date] window,
    ordered oldest first.

    `id` (a SERIAL assigned in COPY order) does NOT track this dataset's
    timestamp order, so this orders by `timestamp` (indexed via
    ix_staging_timestamp) with `id` as a tiebreaker for duplicate timestamps.
    """
    conditions = []
    if start_date is not None:
        conditions.append(f"timestamp >= '{start_date.isoformat()}'")
    if end_date is not None:
        conditions.append(f"timestamp <= '{end_date.isoformat()}'")

    where_clause = (
        (" WHERE " + " AND ".join(conditions) if conditions else "")
        + f" ORDER BY timestamp ASC, id ASC LIMIT {limit}"
    )
    df = fetch_transactions(engine, where_clause)
    df = clean_transactions(df)
    return _to_records(df)


@router.get("/{transaction_id}")
def get_transaction(transaction_id: int, engine=Depends(get_engine)):
    """Pull + clean a single transaction by id."""
    df = fetch_transactions(engine, f"WHERE id = {transaction_id}")
    df = clean_transactions(df)
    if df.empty:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return _to_records(df)[0]
