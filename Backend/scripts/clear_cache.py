"""Delete every account, transaction and stored graph from the cache DB.

This permanently removes analysts' statuses and notes. With --reset-checkpoint, also resets the transaction poller's checkpoint so
everything is re-scored from staging id 1; without it, the poller carries on
from its checkpoint and the cleared rows are never re-scored.

Stop the FastAPI app first -- this runs in a separate process, so it can't
wait for a batch in progress there. While the app is running, use
POST /api/util/cache/clear instead.

Usage:
    uv run python -m scripts.clear_cache
    uv run python -m scripts.clear_cache --reset-checkpoint
"""

import argparse
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))

from jobs.transaction_poller import JOB_NAME, clear_cache


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--reset-checkpoint", action="store_true",
        help=f"also reset {JOB_NAME}'s checkpoint so everything is re-scored",
    )
    args = parser.parse_args()

    result = clear_cache(reset=args.reset_checkpoint)
    print(
        f"Deleted {result['transactionsDeleted']:,} transactions, "
        f"{result['accountsDeleted']:,} accounts and "
        f"{result['graphsDeleted']:,} graphs from the cache DB"
    )
    if args.reset_checkpoint:
        previous = result["previousLastId"]
        was = f"was at id {previous:,}" if previous is not None else "had no checkpoint"
        print(f"Reset {JOB_NAME} ({was}) -- the next run starts from id 1")


if __name__ == "__main__":
    main()
