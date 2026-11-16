"""Pipeline: turn staging_transactions into a node/edge graph (CSV output).

Graph model (matches dataset/aml-graph-gnn-detection.ipynb):
    - Node   = bank account, identified as "{bank}_{account}"
    - Edge   = one transaction, source -> destination account
    - Node features = aggregated stats over each account's edges
    - Edge features = per-transaction attributes
    - Edge label     = is_laundering

All heavy aggregation runs in Postgres so the ~5M-row table is never pulled
into Python row-by-row; only the small node table and a streamed CSV copy
of the edge table touch this process.

Usage:
    uv run python -m scripts.build_graph
"""

import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))

import numpy as np
import pandas as pd
import psycopg

from db import STAGING_PSYCOPG_DSN, get_staging_engine

OUTPUT_DIR = Path(__file__).resolve().parents[1] / "output" / "graph"
NODES_CSV = OUTPUT_DIR / "nodes.csv"
EDGES_CSV = OUTPUT_DIR / "edges.csv"

NODE_AGG_SQL = """
WITH sent AS (
    SELECT from_bank || '_' || from_account AS account_id,
           SUM(amount_paid)                                   AS total_sent,
           COUNT(*)                                            AS tx_count_out,
           COUNT(DISTINCT to_bank || '_' || to_account)        AS unique_cp_out
    FROM staging_transactions
    GROUP BY 1
),
received AS (
    SELECT to_bank || '_' || to_account AS account_id,
           SUM(amount_received)                                AS total_received,
           COUNT(*)                                             AS tx_count_in,
           COUNT(DISTINCT from_bank || '_' || from_account)     AS unique_cp_in
    FROM staging_transactions
    GROUP BY 1
)
SELECT
    COALESCE(sent.account_id, received.account_id) AS account_id,
    COALESCE(total_sent, 0)     AS total_sent,
    COALESCE(total_received, 0) AS total_received,
    COALESCE(tx_count_out, 0)   AS tx_count_out,
    COALESCE(tx_count_in, 0)    AS tx_count_in,
    COALESCE(unique_cp_out, 0)  AS unique_cp_out,
    COALESCE(unique_cp_in, 0)   AS unique_cp_in
FROM sent
FULL OUTER JOIN received USING (account_id)
"""

NODE_RAW_COLS = [
    "total_sent", "total_received", "tx_count_out", "tx_count_in",
    "unique_cp_out", "unique_cp_in", "avg_sent", "avg_received",
]

# Common Table Expression: one row per transaction with raw (unnormalized)
# edge features. Referenced twice below (stats pass, then normalized export)
# so Postgres does two single-pass scans instead of Python touching 5M rows.
EDGE_RAW_CTE = """
WITH edge_raw AS (
    SELECT
        id,
        from_bank || '_' || from_account AS src_account_id,
        to_bank   || '_' || to_account   AS dst_account_id,
        is_laundering,
        ln(1 + amount_paid)     AS log_amount_paid,
        ln(1 + amount_received) AS log_amount_received,
        LEAST(GREATEST((amount_received + 1) / (amount_paid + 1), 0.01), 100.0)::double precision AS amount_ratio,
        (CASE WHEN payment_currency <> receiving_currency THEN 1.0 ELSE 0.0 END)::double precision AS is_cross_currency,
        sin(2 * pi() * EXTRACT(HOUR FROM timestamp) / 24) AS hour_sin,
        cos(2 * pi() * EXTRACT(HOUR FROM timestamp) / 24) AS hour_cos,
        (CASE WHEN EXTRACT(ISODOW FROM timestamp) IN (6, 7) THEN 1.0 ELSE 0.0 END)::double precision AS is_weekend,
        (CASE WHEN EXTRACT(HOUR FROM timestamp) < 6 OR EXTRACT(HOUR FROM timestamp) >= 22
             THEN 1.0 ELSE 0.0 END)::double precision AS is_night,
        (DENSE_RANK() OVER (ORDER BY payment_format) - 1)::float AS payment_format_enc
    FROM staging_transactions
)
"""

EDGE_FEATURE_COLS = [
    "log_amount_paid", "log_amount_received", "amount_ratio", "is_cross_currency",
    "hour_sin", "hour_cos", "is_weekend", "is_night", "payment_format_enc",
]


def build_nodes(engine) -> int:
    df = pd.read_sql(NODE_AGG_SQL, engine)

    df["avg_sent"] = np.where(df["tx_count_out"] > 0, df["total_sent"] / df["tx_count_out"], 0.0)
    df["avg_received"] = np.where(df["tx_count_in"] > 0, df["total_received"] / df["tx_count_in"], 0.0)

    log_df = np.log1p(df[NODE_RAW_COLS].astype(float))
    normalized = (log_df - log_df.mean()) / log_df.std(ddof=0).replace(0, 1)
    normalized.columns = [f"{c}_norm" for c in NODE_RAW_COLS]

    df.insert(0, "node_idx", np.arange(len(df)))
    out = pd.concat([df[["node_idx", "account_id"] + NODE_RAW_COLS], normalized], axis=1)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out.to_csv(NODES_CSV, index=False)
    print(f"Wrote {len(out):,} nodes -> {NODES_CSV}")
    return len(out)


def compute_edge_stats(conn) -> dict:
    """Single-pass mean/stddev per raw edge feature, needed to normalize below."""
    cols_sql = ", ".join(f"AVG({c}) AS {c}_mean, STDDEV_POP({c}) AS {c}_std" for c in EDGE_FEATURE_COLS)
    sql = EDGE_RAW_CTE + f"SELECT {cols_sql} FROM edge_raw"
    with conn.cursor() as cur:
        cur.execute(sql)
        row = cur.fetchone()
        colnames = [d.name for d in cur.description]
    return dict(zip(colnames, row))


def build_edges(conn) -> None:
    stats = compute_edge_stats(conn)

    norm_exprs = []
    for c in EDGE_FEATURE_COLS:
        mean = stats[f"{c}_mean"] or 0.0
        std = stats[f"{c}_std"] or 1.0
        norm_exprs.append(f"({c} - {mean}) / {std} AS {c}_norm")

    select_sql = (
        EDGE_RAW_CTE
        + "SELECT id, src_account_id, dst_account_id, is_laundering, "
        + ", ".join(EDGE_FEATURE_COLS) + ", "
        + ", ".join(norm_exprs)
        + " FROM edge_raw"
    )
    copy_sql = f"COPY ({select_sql}) TO STDOUT WITH (FORMAT csv, HEADER true)"

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    with conn.cursor() as cur, open(EDGES_CSV, "wb") as f, cur.copy(copy_sql) as copy:
        for chunk in copy:
            f.write(chunk)

    print(f"Wrote edges -> {EDGES_CSV}")


def main() -> None:
    engine = get_staging_engine()
    build_nodes(engine)

    with psycopg.connect(STAGING_PSYCOPG_DSN) as conn:
        build_edges(conn)

    print("Graph build complete.")


if __name__ == "__main__":
    main()
