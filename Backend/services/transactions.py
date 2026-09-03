import numpy as np
import pandas as pd
import torch

from db import get_engine  # your existing db.py

DEVICE = torch.device('cuda' if torch.cuda.is_available() else 'cpu')


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



# 3. NODE INDEX MAP — every account needs a stable integer id (0..N-1)
#    for tensor indexing. This is the step build_graph.py's CSV export
#    doesn't need but a tensor pipeline does.
def build_node_index(df: pd.DataFrame) -> dict:
    accounts = pd.Index(
        pd.concat([df['src_account_id'], df['dst_account_id']]).unique()
    )
    node_idx_map = {acct: i for i, acct in enumerate(accounts)}
    print(f"[index] {len(node_idx_map):,} unique accounts -> node indices")
    return node_idx_map



# 4. NODE FEATURES (x) — same aggregation as NODE_AGG_SQL, done here in
#    pandas since we already pulled the rows for edge building anyway.
#    For a large table, prefer running NODE_AGG_SQL in Postgres instead.
def build_node_features(df: pd.DataFrame, node_idx_map: dict) -> torch.Tensor:
    sent = df.groupby('src_account_id').agg(
        total_sent=('amount_paid', 'sum'),
        tx_count_out=('id', 'count'), # How many transactions this account sent
        unique_cp_out=('dst_account_id', 'nunique'), # how many distinct accounts this account received money from
    )
    received = df.groupby('dst_account_id').agg(
        total_received=('amount_received', 'sum'),
        tx_count_in=('id', 'count'),
        unique_cp_in=('src_account_id', 'nunique'),
    )

    node_df = pd.DataFrame(index=list(node_idx_map.keys()))
    node_df = node_df.join(sent).join(received).fillna(0.0)

    node_df['avg_sent'] = np.where(
        node_df['tx_count_out'] > 0,
        node_df['total_sent'] / node_df['tx_count_out'].replace(0, 1), 0.0)
    node_df['avg_received'] = np.where(
        node_df['tx_count_in'] > 0,
        node_df['total_received'] / node_df['tx_count_in'].replace(0, 1), 0.0)

    raw_cols = ['total_sent', 'total_received', 'tx_count_out', 'tx_count_in',
                'unique_cp_out', 'unique_cp_in', 'avg_sent', 'avg_received']

    # log1p + z-score, same normalization as build_graph.py's build_nodes()
    log_df = np.log1p(node_df[raw_cols].astype(float))
    std = log_df.std(ddof=0).replace(0, 1)
    normed = (log_df - log_df.mean()) / std

    # order rows by node_idx so row i == node i
    normed = normed.reindex(list(node_idx_map.keys()))
    x = torch.tensor(normed.values, dtype=torch.float32)
    print(f"[nodes] x shape = {tuple(x.shape)}")
    return x



# 5. EDGE INDEX + EDGE FEATURES — vectorized, no Python row loops
def build_edges(df: pd.DataFrame, node_idx_map: dict):
    src = df['src_account_id'].map(node_idx_map).values
    dst = df['dst_account_id'].map(node_idx_map).values
    edge_index = torch.tensor(np.vstack([src, dst]), dtype=torch.long)

    ts = pd.to_datetime(df['timestamp'])
    hour = ts.dt.hour.values.astype(float)
    dow = ts.dt.dayofweek.values  # 0=Mon .. 6=Sun

    log_amount_paid = np.log1p(df['amount_paid'].values)
    log_amount_received = np.log1p(df['amount_received'].values)
    amount_ratio = np.clip(
        (df['amount_received'].values + 1) / (df['amount_paid'].values + 1),
        0.01, 100.0
    )
    is_cross_currency = (df['payment_currency'] != df['receiving_currency']).astype(float).values
    hour_sin = np.sin(2 * np.pi * hour / 24)
    hour_cos = np.cos(2 * np.pi * hour / 24)
    is_weekend = np.isin(dow, [5, 6]).astype(float)
    is_night = ((hour < 6) | (hour >= 22)).astype(float)
    payment_format_enc = df['payment_format'].astype('category').cat.codes.astype(float).values

    raw = np.column_stack([
        log_amount_paid, log_amount_received, amount_ratio, is_cross_currency,
        hour_sin, hour_cos, is_weekend, is_night, payment_format_enc,
    ])

    # z-normalize each column (skip the already-bounded sin/cos/flag columns
    # if you'd rather leave them as-is — normalizing everything is simplest
    # and matches build_graph.py's approach)
    mean = raw.mean(axis=0)
    std = raw.std(axis=0)
    std[std == 0] = 1.0
    edge_attr = torch.tensor((raw - mean) / std, dtype=torch.float32)

    print(f"[edges] edge_index shape = {tuple(edge_index.shape)}, "
          f"edge_attr shape = {tuple(edge_attr.shape)}")
    return edge_index, edge_attr


# ============================================================
# 6. RUN INFERENCE
# ============================================================
def run_inference(model, x, edge_index, edge_attr):
    model.eval()
    with torch.no_grad():
        logits = model(x.to(DEVICE), edge_index.to(DEVICE), edge_attr.to(DEVICE))
        probs = torch.sigmoid(logits).cpu().numpy()
    return probs


def main():
    engine = get_engine()

    # for a production micro-batch, scope this with a WHERE clause, e.g.:
    # where_clause = "WHERE timestamp >= now() - interval '1 hour'"
    df = fetch_transactions(engine)
    df = clean_transactions(df)

    node_idx_map = build_node_index(df)
    x = build_node_features(df, node_idx_map)
    edge_index, edge_attr = build_edges(df, node_idx_map)

    model = GNNEdgeClassifier(node_dim=x.shape[1], edge_dim=edge_attr.shape[1],
                               hidden_dim=32, conv_type='GCN')
    model.load_state_dict(torch.load('gcn_model.pt', map_location=DEVICE))
    model.to(DEVICE)

    probs = run_inference(model, x, edge_index, edge_attr)

    results = pd.DataFrame({
        'transaction_id': df['id'].values,
        'src_account': df['src_account_id'].values,
        'dst_account': df['dst_account_id'].values,
        'laundering_prob': probs,
    }).sort_values('laundering_prob', ascending=False)

    print(results.head(10))
    return results


if __name__ == "__main__":
    main()
