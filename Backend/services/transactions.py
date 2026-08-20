import numpy as np
import pandas as pd



# 1. PULL raw rows from Postgres
def fetch_transactions(engine, where_clause: str = "") -> pd.DataFrame:
    """Pull raw transaction rows. `where_clause` lets you scope this to a
    batch, e.g. "WHERE timestamp >= now() - interval '1 hour'" for a
    production micro-batch instead of the whole table."""
    sql = f"""
        SELECT
            id,
            from_bank, from_account,
            to_bank, to_account,
            amount_paid, amount_received,
            payment_currency, receiving_currency,
            payment_format,
            timestamp
        FROM staging_transactions
        {where_clause}
    """
    df = pd.read_sql(sql, engine)
    print(f"[fetch] pulled {len(df):,} raw transaction rows")
    return df



# 2. CLEAN — handle the usual real-world mess before any feature math
def clean_transactions(df: pd.DataFrame) -> pd.DataFrame:
    before = len(df)

    # Drop rows with missing identifiers or amounts — can't build an edge
    # without knowing who paid whom, how much.
    required = ['from_bank', 'from_account', 'to_bank', 'to_account',
                'amount_paid', 'amount_received', 'timestamp']
    df = df.dropna(subset=required)

    # Negative or zero amounts are invalid transactions, not just outliers
    df = df[(df['amount_paid'] > 0) & (df['amount_received'] > 0)]

    # Guard against div-by-zero / log(0) downstream
    df['amount_paid'] = df['amount_paid'].clip(lower=0.01)
    df['amount_received'] = df['amount_received'].clip(lower=0.01)

    # Build the composite account_id to use when building the graph
    df['src_account_id'] = df['from_bank'].astype(str) + '_' + df['from_account'].astype(str)
    df['dst_account_id'] = df['to_bank'].astype(str) + '_' + df['to_account'].astype(str)

    # Drop self-loops (account paying itself) — usually a data artifact,
    # and GCNConv treats self-loops specially internally already
    df = df[df['src_account_id'] != df['dst_account_id']]

    # Fill missing payment_format / currency with an explicit "unknown"
    # category rather than dropping the row
    df['payment_format'] = df['payment_format'].fillna('UNKNOWN')
    df['payment_currency'] = df['payment_currency'].fillna('UNKNOWN')
    df['receiving_currency'] = df['receiving_currency'].fillna('UNKNOWN')

    df = df.drop_duplicates(subset=['id'])

    print(f"[clean] {before:,} -> {len(df):,} rows after cleaning "
          f"({before - len(df):,} dropped)")
    return df