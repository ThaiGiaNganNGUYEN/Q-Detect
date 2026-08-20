"""One-time job: load the raw AML transactions CSV into Postgres via COPY.

Usage:
    uv run python -m scripts.load_transactions
"""

import sys
import time
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))

import psycopg
from sqlmodel import SQLModel, text

from db import PSYCOPG_DSN, get_engine
from models.transaction import StagingTransaction  # noqa: F401 (registers the table)

CSV_PATH = Path(__file__).resolve().parents[1] / "dataset" / "HI-Small_Trans.csv"

COPY_SQL = """
COPY staging_transactions (
    timestamp, from_bank, from_account, to_bank, to_account,
    amount_received, receiving_currency, amount_paid, payment_currency,
    payment_format, is_laundering
)
FROM STDIN WITH (FORMAT csv, HEADER true)
"""

INDEX_STATEMENTS = [
    "CREATE INDEX IF NOT EXISTS ix_staging_from_account ON staging_transactions (from_bank, from_account)",
    "CREATE INDEX IF NOT EXISTS ix_staging_to_account ON staging_transactions (to_bank, to_account)",
    "CREATE INDEX IF NOT EXISTS ix_staging_timestamp ON staging_transactions (timestamp)",
]


def main() -> None:
    if not CSV_PATH.exists():
        raise SystemExit(f"Dataset not found at {CSV_PATH}")

    engine = get_engine()

    print("Creating tables...")
    SQLModel.metadata.create_all(engine)

    with engine.connect() as conn:
        conn.execute(text("TRUNCATE TABLE staging_transactions RESTART IDENTITY"))
        conn.commit()

    print(f"Loading {CSV_PATH.name} into staging_transactions via COPY...")
    start = time.perf_counter()

    with psycopg.connect(PSYCOPG_DSN) as raw_conn:
        with raw_conn.cursor() as cur:
            with open(CSV_PATH, "r", encoding="utf-8") as f, cur.copy(COPY_SQL) as copy:
                while chunk := f.read(1024 * 1024):
                    copy.write(chunk)

    elapsed = time.perf_counter() - start
    print(f"Load complete in {elapsed:.1f}s")

    print("Building indexes...")
    with engine.connect() as conn:
        for stmt in INDEX_STATEMENTS:
            conn.execute(text(stmt))
        conn.commit()

    with engine.connect() as conn:
        count = conn.execute(text("SELECT COUNT(*) FROM staging_transactions")).scalar_one()
    print(f"staging_transactions now has {count:,} rows")


if __name__ == "__main__":
    main()