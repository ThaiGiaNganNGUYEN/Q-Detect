"""
Utility router -- operational endpoints for the transaction poller job:
check its status, stop/start it, reset its ingestion checkpoint, and clear
the cache DB. All logic lives in jobs/transaction_poller.py.

The poller still starts automatically with the app (main.py's lifespan);
these endpoints only control it while the app is running.
"""

from fastapi import APIRouter

from jobs import transaction_poller

router = APIRouter(prefix="/api/util", tags=["util"])


def _status() -> dict:
    checkpoint = transaction_poller.get_checkpoint()
    return {
        "job": transaction_poller.JOB_NAME,
        "running": transaction_poller.is_running(),
        "batchInProgress": transaction_poller.is_batch_in_progress(),
        "lastId": checkpoint.lastId if checkpoint else 0,
        "checkpointUpdatedAt": checkpoint.updatedAt if checkpoint else None,
        "batchSize": transaction_poller.BATCH_SIZE,
        "pollIntervalSeconds": transaction_poller.POLL_INTERVAL_SECONDS,
    }


@router.get("/jobs/status")
def job_status():
    """Whether the poller is running, and where its checkpoint is."""
    return _status()


# async: start() schedules the loop on the app's event loop, which sync
# endpoints (run in a worker thread) don't have.
@router.post("/jobs/start")
async def start_job():
    """Start the poller. Its first batch runs immediately."""
    started = transaction_poller.start()
    return {"changed": started, **_status()}


@router.post("/jobs/stop")
async def stop_job():
    """Stop the poller. Waits for a batch in progress to finish first."""
    stopped = await transaction_poller.stop()
    return {"changed": stopped, **_status()}


@router.post("/ingestion/reset")
def reset_ingestion():
    """Reset the checkpoint so the next batch starts from staging id 1.

    Waits for a batch in progress to finish first. Doesn't stop the poller,
    and doesn't clear the cache DB -- already-cached transaction ids are
    skipped when re-processed, not re-scored.
    """
    previous = transaction_poller.reset_checkpoint()
    return {"previousLastId": previous, **_status()}


@router.post("/cache/clear")
def clear_cache(reset_checkpoint: bool = False):
    """Delete every account, transaction and stored graph from the cache DB.
    This permanently removes analysts' statuses and notes.

    Waits for a batch in progress to finish first. Without
    reset_checkpoint=true the poller carries on from its checkpoint, so the
    cleared rows are never re-scored; with it, the checkpoint is reset in the
    same step and everything is re-scored from staging id 1.
    """
    result = transaction_poller.clear_cache(reset=reset_checkpoint)
    return {**result, **_status()}
