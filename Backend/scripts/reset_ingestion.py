"""Reset the transaction poller's checkpoint so the next run starts from id 1.

Deletes the job's ingestion_checkpoint row; with no row, the poller treats
lastId as 0. Stop the FastAPI app first -- this runs in a separate process,
so a batch in progress there would save its checkpoint after the reset and
undo it. While the app is running, use POST /api/util/ingestion/reset instead.

Usage:
    uv run python -m scripts.reset_ingestion
"""

import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))

from jobs.transaction_poller import JOB_NAME, reset_checkpoint


def main() -> None:
    previous = reset_checkpoint()
    if previous is None:
        print(f"No checkpoint for {JOB_NAME} -- already starts from id 1")
    else:
        print(f"Reset {JOB_NAME} (was at id {previous:,}) -- the next run starts from id 1")


if __name__ == "__main__":
    main()
