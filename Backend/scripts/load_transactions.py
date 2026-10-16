"""One-time job: bulk-load the raw AML transactions CSV into the staging DB,
sorted chronologically.

Rows are inserted in timestamp order (CSV row order breaks ties), so
staging_transaction.id runs 1..N in chronological order. A recurring job can
then pull transactions in order by walking id forward from its last position.

Timestamps only have minute precision, so hundreds of rows (up to ~11k)
share each timestamp. That's why the recurring job must page by id, not by
timestamp: a timestamp cursor would skip or re-read rows within a minute.

Re-running truncates the table and reloads from scratch.

Usage:
    uv run python -m scripts.load_transactions
"""

import sys
import time
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))

import psycopg
from sqlmodel import SQLModel

from db import STAGING_PSYCOPG_DSN, get_staging_engine
from models import StagingTransaction

CSV_PATH = Path(__file__).resolve().parents[1] / "dataset" / "HI-Small_Trans.csv"
TABLE = StagingTransaction.__tablename__

# Model fields in the same order as the CSV header columns.
CSV_COLUMNS = [
    "timestamp", "fromBank", "fromAccount", "toBank", "toAccount",
    "amountReceived", "receivingCurrency", "amountPaid", "paymentCurrency",
    "paymentFormat", "isLaundering",
]
COLUMNS_SQL = ", ".join(f'"{c}"' for c in CSV_COLUMNS)


def main() -> None:
    if not CSV_PATH.exists():
        raise SystemExit(f"Dataset not found at {CSV_PATH}")

    # Only create the staging table -- the models package registers every
    # model, and the rest don't belong in the staging DB.
    SQLModel.metadata.create_all(get_staging_engine(), tables=[StagingTransaction.__table__])

    start = time.perf_counter()
    with psycopg.connect(STAGING_PSYCOPG_DSN) as conn, conn.cursor() as cur:
        cur.execute(f"TRUNCATE TABLE {TABLE} RESTART IDENTITY")

        # Unsorted landing table with the same column types, plus csv_row to
        # keep the original file order as a tiebreaker for equal timestamps.
        cur.execute(
            f"CREATE TEMP TABLE csv_load ON COMMIT DROP AS "
            f"SELECT {COLUMNS_SQL} FROM {TABLE} WITH NO DATA"
        )
        cur.execute("ALTER TABLE csv_load ADD COLUMN csv_row bigint GENERATED ALWAYS AS IDENTITY")

        print(f"Copying {CSV_PATH.name}...")
        copy_sql = f"COPY csv_load ({COLUMNS_SQL}) FROM STDIN WITH (FORMAT csv, HEADER true)"
        with open(CSV_PATH, "rb") as f, cur.copy(copy_sql) as copy:
            while chunk := f.read(1024 * 1024):
                copy.write(chunk)

        print("Inserting into staging in chronological order...")
        cur.execute(
            f"INSERT INTO {TABLE} ({COLUMNS_SQL}) "
            f"SELECT {COLUMNS_SQL} FROM csv_load ORDER BY \"timestamp\", csv_row"
        )
        count = cur.rowcount

    print(f"Loaded {count:,} rows into {TABLE} in {time.perf_counter() - start:.1f}s")


if __name__ == "__main__":
    main()
