"""Write a scored batch into the cache DB's account and transaction tables.

One DB transaction per batch:
    1. COPY the batch's unique accounts into a temp table, then upsert them
       into account -- new accounts are inserted, accounts seen in earlier
       batches just widen their firstSeen/lastSeen range.
    2. COPY the scored rows into a temp table, then insert them into
       transaction, skipping ids that are already there.

COPY + one INSERT ... ON CONFLICT per table keeps this to a handful of
statements per batch, instead of an ORM round trip per row.

Every write is idempotent, so re-writing a batch (the poller re-runs one if it
crashed before saving its checkpoint) changes nothing.
"""

from datetime import datetime, timezone

import polars as pl
import psycopg
from sqlalchemy import inspect
from sqlmodel import SQLModel

from db import CACHE_PSYCOPG_DSN, get_cache_engine
from models import Account, Transaction

ACCOUNT_COLUMNS = ["accountId", "bank", "accountNumber", "firstSeen", "lastSeen"]
TRANSACTION_COLUMNS = [
    "id", "senderAcc", "receiverAcc",
    "amountPaid", "amountReceived", "currencyPaid", "currencyReceived", "paymentFormat",
    "timestamp", "hoursFromStart", "isCrossBank", "isCrossCurrency", "isSelfTransfer",
    "isLaundering", "fraudRiskScore", "isFlagged", "scoredAt",
]


def _cols(columns: list[str]) -> str:
    return ", ".join(f'"{c}"' for c in columns)


def build_transactions(result: dict) -> pl.DataFrame:
    """Map infer_transactions' "both" output to transaction table rows."""
    return result["frame"].select(
        pl.col("id"),
        pl.col("sender_id").alias("senderAcc"),
        pl.col("receiver_id").alias("receiverAcc"),
        pl.col("Amount Paid").alias("amountPaid"),
        pl.col("Amount Received").alias("amountReceived"),
        pl.col("Payment Currency").alias("currencyPaid"),
        pl.col("Receiving Currency").alias("currencyReceived"),
        pl.col("Payment Format").alias("paymentFormat"),
        pl.col("ts").alias("timestamp"),
        pl.col("hours_from_start").alias("hoursFromStart"),
        pl.col("is_cross_bank").cast(pl.Boolean).alias("isCrossBank"),
        pl.col("is_cross_currency").cast(pl.Boolean).alias("isCrossCurrency"),
        pl.col("is_self_transfer").cast(pl.Boolean).alias("isSelfTransfer"),
        pl.col("Is Laundering").cast(pl.Boolean).alias("isLaundering"),
        pl.col("risk_score").alias("fraudRiskScore"),
        pl.Series("isFlagged", result["flagged"], dtype=pl.Boolean),
        pl.lit(datetime.now(timezone.utc)).alias("scoredAt"),
    )


def build_accounts(transactions: pl.DataFrame) -> pl.DataFrame:
    """Unique accounts in the batch, with the time range they appear in."""
    # Account ids are "{accountNumber}_{bank}", same as Account.from_id().
    ends = pl.concat([
        transactions.select(pl.col("senderAcc").alias("accountId"), "timestamp"),
        transactions.select(pl.col("receiverAcc").alias("accountId"), "timestamp"),
    ])
    return (
        ends.group_by("accountId")
        .agg(
            pl.col("timestamp").min().alias("firstSeen"),
            pl.col("timestamp").max().alias("lastSeen"),
        )
        .with_columns(pl.col("accountId").str.splitn("_", 2).alias("_parts"))
        .with_columns(
            pl.col("_parts").struct.field("field_0").alias("accountNumber"),
            pl.col("_parts").struct.field("field_1").alias("bank"),
        )
        .select(ACCOUNT_COLUMNS)
    )


def _copy_rows(cur: psycopg.Cursor, table: str, columns: list[str], df: pl.DataFrame) -> None:
    with cur.copy(f"COPY {table} ({_cols(columns)}) FROM STDIN") as copy:
        for row in df.select(columns).iter_rows():
            copy.write_row(row)


def write_scored_batch(result: dict) -> tuple[int, int]:
    """Store one scored batch. Returns (accounts upserted, transactions inserted)."""
    SQLModel.metadata.create_all(
        get_cache_engine(), tables=[Account.__table__, Transaction.__table__]
    )

    transactions = build_transactions(result)
    accounts = build_accounts(transactions)
    account_cols = _cols(ACCOUNT_COLUMNS)
    transaction_cols = _cols(TRANSACTION_COLUMNS)

    with psycopg.connect(CACHE_PSYCOPG_DSN) as conn, conn.cursor() as cur:
        cur.execute("CREATE TEMP TABLE tmp_account (LIKE account) ON COMMIT DROP")
        _copy_rows(cur, "tmp_account", ACCOUNT_COLUMNS, accounts)
        cur.execute(
            f"INSERT INTO account ({account_cols}) SELECT {account_cols} FROM tmp_account "
            'ON CONFLICT ("accountId") DO UPDATE SET '
            '"firstSeen" = LEAST(account."firstSeen", EXCLUDED."firstSeen"), '
            '"lastSeen" = GREATEST(account."lastSeen", EXCLUDED."lastSeen")'
        )
        accounts_upserted = cur.rowcount

        cur.execute('CREATE TEMP TABLE tmp_transaction (LIKE "transaction") ON COMMIT DROP')
        _copy_rows(cur, "tmp_transaction", TRANSACTION_COLUMNS, transactions)
        cur.execute(
            f'INSERT INTO "transaction" ({transaction_cols}) '
            f"SELECT {transaction_cols} FROM tmp_transaction "
            "ON CONFLICT (id) DO NOTHING"
        )
        transactions_inserted = cur.rowcount

    return accounts_upserted, transactions_inserted


def clear_cache() -> tuple[int, int]:
    """Delete every cached account and transaction. Returns (accounts, transactions) removed."""
    if not inspect(get_cache_engine()).has_table(Transaction.__tablename__):
        return 0, 0
    with psycopg.connect(CACHE_PSYCOPG_DSN) as conn:
        accounts = conn.execute("SELECT COUNT(*) FROM account").fetchone()[0]
        transactions = conn.execute('SELECT COUNT(*) FROM "transaction"').fetchone()[0]
        conn.execute('TRUNCATE "transaction", account')
    return accounts, transactions
