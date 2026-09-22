"""
Build a graph using ONLY confirmed laundering transactions (Is Laundering == 1).

This mirrors the same data-loading, stratified-sampling, and node/edge-mapping
logic from the main notebook (Cells 6, 7, 9-11) -- sample 200k rows via
stratified sampling (same class ratio as the full dataset, not plain random
sampling), then filter that sample down to only the laundering rows.

Every row is validated through the StagingTransaction model before it's used,
and every node/edge added to the graph is built from the Account/Transaction
SQLModel models in models/ -- so the graph-construction step and the API step
(cluster_api.py) share one single definition of what a "transaction" is.

Usage:
    uv run python build_laundering_graph.py
"""

import os
import gc
import pandas as pd
import networkx as nx

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from models import Account, StagingTransaction, Transaction

SEED = 42
SAMPLE_SIZE = 200_000


# 1. Load data 
DATA_PATH = "../dataset/HI-Small_Trans.csv"   # adjust to your local path

dtype_map = {
    'From Bank': 'str',
    'Account': 'str',
    'To Bank': 'str',
    'Account.1': 'str',
    'Amount Received': 'float32',
    'Receiving Currency': str,
    'Amount Paid': 'float32',
    'Payment Currency': str,
    'Payment Format': str,
    'Is Laundering': 'int8',
}

print(f"[INFO] Loading from {DATA_PATH} (exists: {os.path.exists(DATA_PATH)})")
df_full = pd.read_csv(DATA_PATH, dtype=dtype_map)

# Fix duplicate 'Account' column name -> 'Account.1' (same defensive check as notebook)
if 'Account.1' not in df_full.columns:
    cols = list(df_full.columns)
    acc_idx = [i for i, c in enumerate(cols) if c == 'Account']
    if len(acc_idx) > 1:
        cols[acc_idx[1]] = 'Account.1'
        df_full.columns = cols

print(f"[OK] Full dataset: {df_full.shape[0]:,} rows")
print(f"     Laundering rate: {df_full['Is Laundering'].mean():.4%}")


# 2. Stratified sample to 200k rows 
#    -- preserves the true laundering ratio, instead of leaving the
#    laundering row count to random chance.
laundering_mask = df_full['Is Laundering'] == 1
n_launder = laundering_mask.sum()
n_legit = (~laundering_mask).sum()
launder_ratio = n_launder / len(df_full)

n_launder_sample = int(SAMPLE_SIZE * launder_ratio)
n_legit_sample = SAMPLE_SIZE - n_launder_sample

idx_launder = df_full[laundering_mask].sample(
    n=min(n_launder_sample, n_launder), random_state=SEED
).index
idx_legit = df_full[~laundering_mask].sample(
    n=min(n_legit_sample, n_legit), random_state=SEED
).index

df_full = df_full.loc[idx_launder.union(idx_legit)].copy().reset_index(drop=True)
gc.collect()

print(f"[OK] Stratified sample: {len(df_full):,} rows")
print(f"     Sampled laundering rate: {df_full['Is Laundering'].mean():.4%} "
      f"(target ratio: {launder_ratio:.4%})")
print(f"     Sampled laundering rows: {int(df_full['Is Laundering'].sum()):,}")


# 3. Filter the sample down to ONLY laundering transactions
#    (do this before the per-row model validation step, so we don't
#    waste time validating ~199k rows we're about to discard anyway)
df = df_full[df_full['Is Laundering'] == 1].copy().reset_index(drop=True)
del df_full  # free memory, don't need the sampled full set anymore

print(f"\n[OK] Laundering-only subset: {len(df):,} transactions")

if len(df) == 0:
    raise ValueError("No laundering transactions found -- check DATA_PATH / dtype_map.")

# Parse the raw timestamp string into a real datetime BEFORE it reaches
# StagingTransaction. table=True SQLModel classes use SQLAlchemy's own
# __init__, not Pydantic's validating one, so a raw "2022/09/01 08:23"
# string would otherwise be stored as-is (never parsed into a datetime),
# and .hour / .weekday() would fail downstream.
df['Timestamp'] = pd.to_datetime(df['Timestamp'], format='%Y/%m/%d %H:%M')


# 4. Validate every row through StagingTransaction, then derive
#    time fields -- this is the "staging" step: raw row -> clean,
#    typed, validated object, before anything graph-specific happens.
#    model_validate() explicitly runs Pydantic validation/coercion,
#    which plain StagingTransaction(**kwargs) construction skips for
#    table=True models.
staging_rows: list[StagingTransaction] = []
for row in df.to_dict(orient="records"):
    staged = StagingTransaction.model_validate({
        "fromBank": row['From Bank'],
        "account": row['Account'],
        "toBank": row['To Bank'],
        "account1": row['Account.1'],
        "amountPaid": row['Amount Paid'],
        "paymentCurrency": row['Payment Currency'],
        "amountReceived": row['Amount Received'],
        "receivingCurrency": row['Receiving Currency'],
        "paymentFormat": row['Payment Format'],
        "isLaundering": bool(row['Is Laundering']),
        "timestamp": row['Timestamp'].to_pydatetime(),
    }).with_derived_time_fields().with_derived_relational_fields()
    staging_rows.append(staged)

# Sort chronologically now that every row is a validated StagingTransaction
staging_rows.sort(key=lambda t: t.timestamp)

# hoursFromStart is relative to the earliest transaction in this dataset,
# so it can only be computed once every row is sorted chronologically.
dataset_start = staging_rows[0].timestamp
staging_rows = [t.with_hours_from_start(dataset_start) for t in staging_rows]

print(f"[OK] Validated {len(staging_rows):,} rows through StagingTransaction")


# 5. Build unique account identity + node index map
#    (same pattern as notebook Cell 9, driven off StagingTransaction
#    properties instead of raw dataframe columns)
all_account_ids = sorted({
    acc for t in staging_rows for acc in (t.senderId, t.receiverId)
})
accounts = [Account.from_id(acc_id) for acc_id in all_account_ids]

account_to_idx = {acc.accountId: idx for idx, acc in enumerate(accounts)}
idx_to_account = {idx: acc for idx, acc in enumerate(accounts)}   # idx -> Account object, not bare string
num_nodes = len(accounts)

print(f"[OK] Laundering-network nodes (unique accounts): {num_nodes:,}")
print(f"     Laundering-network edges (transactions):    {len(staging_rows):,}")


# 6. Build the graph with NetworkX (directed multigraph --
#    same account pair CAN have multiple laundering transfers).
#    Every node/edge added here comes from the Account/Transaction
#    models -- the same models cluster_api.py uses.
G = nx.MultiDiGraph()

for idx, acc in idx_to_account.items():
    # GEXF only stores primitives -- pull the Account's fields out
    # individually rather than storing the object itself
    G.add_node(idx, account=acc.accountId, bank=acc.bank, account_number=acc.accountNumber)

for i, staged in enumerate(staging_rows, start=1):
    transaction = Transaction.from_staging(staged, tx_id=str(i))

    src_idx = account_to_idx[transaction.senderAcc]
    dst_idx = account_to_idx[transaction.receiverAcc]

    # edge_attrs() returns only primitive fields -- GEXF/graph attribute
    # storage can't serialize nested objects or relationships
    G.add_edge(src_idx, dst_idx, **transaction.edge_attrs())

print(f"\n[OK] Graph built: {G.number_of_nodes():,} nodes, {G.number_of_edges():,} edges")


# 7. Quick structural summary -- connected components
#    (each component = one candidate "mule network" / laundering ring)
components = list(nx.weakly_connected_components(G))
components.sort(key=len, reverse=True)

print(f"\n[OK] Found {len(components):,} separate connected clusters")
print("     Top 5 largest clusters (by account count):")
for i, comp in enumerate(components[:5]):
    sub = G.subgraph(comp)
    n_cycles = len(list(nx.simple_cycles(sub))) if len(comp) <= 50 else "skipped (too large)"
    print(f"       Cluster {i}: {len(comp)} accounts, {sub.number_of_edges()} transactions, "
          f"cycles={n_cycles}")


# 8. Save for reuse (so you don't have to rebuild every time)
OUTPUT_DIR = Path(__file__).resolve().parent / "output"
OUTPUT_DIR.mkdir(exist_ok=True)
graph_path = OUTPUT_DIR / "laundering_graph.gexf"
nx.write_gexf(G, str(graph_path))   # open this in Gephi for visual exploration
print(f"\n[OK] Saved graph to {graph_path}")