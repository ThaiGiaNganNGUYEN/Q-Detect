"""
Build a graph using transactions the GraphSAGE mule-hunter model scores as
risky (fraud_risk_score > 0.5), instead of the dataset's ground-truth
"Is Laundering" label.

Mirrors the same data-loading and stratified-sampling logic from the main
notebook (Cells 6, 7, 9-11) -- sample 200k rows via stratified sampling
(same class ratio as the full dataset, not plain random sampling). Every
sampled row is then scored by the trained MuleHunterGNN (mule_hunter_infer.py)
in one batch, since the model is 2-hop GraphSAGE and needs the surrounding
neighborhood to score well -- scoring rows one at a time or after already
discarding their neighbors would starve it of context.

Every row is validated through the StagingTransaction model before it's used,
and every node/edge added to the graph is built from the Account/Transaction
SQLModel models in models/ -- so the graph-construction step and the API step
(cluster_service.py) share one single definition of what a "transaction" is.

Usage:
    uv run python build_laundering_graph.py
"""

import gc
import json
import pandas as pd
import networkx as nx

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from models import Account, StagingTransaction, Transaction
from Backend.scripts.mule_hunter_infer import load_infer_bundle, infer_transactions

SEED = 42
SAMPLE_SIZE = 200_000
RISK_THRESHOLD = 0.5

BACKEND_DIR = Path(__file__).resolve().parent.parent
DATA_PATH = BACKEND_DIR / "dataset" / "HI-Small_Trans.csv"
BUNDLE_PATH = Path(__file__).resolve().parent / "model" / "ibm_graph.pt"


# 1. Load data
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

print(f"[INFO] Loading from {DATA_PATH} (exists: {DATA_PATH.exists()})")
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

df_sample = df_full.loc[idx_launder.union(idx_legit)].copy().reset_index(drop=True)
del df_full
gc.collect()

print(f"[OK] Stratified sample: {len(df_sample):,} rows")
print(f"     Sampled laundering rate: {df_sample['Is Laundering'].mean():.4%} "
      f"(target ratio: {launder_ratio:.4%})")
print(f"     Sampled laundering rows: {int(df_sample['Is Laundering'].sum()):,}")


# 3. Score the whole sample with the trained GraphSAGE model, then keep
#    only the rows the model itself flags as risky -- NOT the ground-truth
#    "Is Laundering" label. Scored as one batch (not row-by-row) so the
#    2-hop neighborhood the model needs is actually present.
print(f"\n[INFO] Loading mule-hunter bundle from {BUNDLE_PATH}")
bundle = load_infer_bundle(path=BUNDLE_PATH)

INPUT_PATH = Path(__file__).resolve().parent / "output" / "model_input.txt"
INPUT_PATH.parent.mkdir(exist_ok=True)
INPUT_PATH.write_text(
    json.dumps(df_sample.to_dict(orient="records"), indent=2, default=str),
    encoding="utf-8",
)
print(f"[OK] Wrote raw model input transactions to {INPUT_PATH}")

print(f"[INFO] Scoring {len(df_sample):,} sampled transactions...")
result = infer_transactions(df_sample, bundle=bundle, output="both")

RESULT_PATH = Path(__file__).resolve().parent / "output" / "model_result.txt"
RESULT_PATH.parent.mkdir(exist_ok=True)
RESULT_PATH.write_text(result["json"], encoding="utf-8")
print(f"[OK] Wrote raw model scoring result to {RESULT_PATH}")

scored = result["frame"]  # polars DataFrame: df_sample's columns + risk_score

risky = scored.filter(scored["risk_score"] > RISK_THRESHOLD)
print(f"[OK] Model-flagged subset (risk_score > {RISK_THRESHOLD}): {risky.height:,} transactions "
      f"({risky.height / scored.height:.4%} of the sample)")

if risky.height == 0:
    raise ValueError(f"No transactions scored above {RISK_THRESHOLD} -- check the model bundle.")

df = risky.to_pandas()
del scored, risky
gc.collect()

print(f"\n[OK] Model-flagged subset: {len(df):,} transactions")

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
#
#    risk_score travels alongside each StagingTransaction as a plain
#    (staged, score) pair -- it isn't part of the raw-row schema, it's
#    the model's output, so it doesn't belong on StagingTransaction itself.
staged_and_scores: list[tuple[StagingTransaction, float]] = []
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
    staged_and_scores.append((staged, float(row['risk_score'])))

# Sort chronologically now that every row is a validated StagingTransaction
staged_and_scores.sort(key=lambda pair: pair[0].timestamp)

# hoursFromStart is relative to the earliest transaction in this dataset,
# so it can only be computed once every row is sorted chronologically.
dataset_start = staged_and_scores[0][0].timestamp
staged_and_scores = [
    (staged.with_hours_from_start(dataset_start), score)
    for staged, score in staged_and_scores
]

print(f"[OK] Validated {len(staged_and_scores):,} rows through StagingTransaction")


# 5. Build unique account identity + node index map
#    (same pattern as notebook Cell 9, driven off StagingTransaction
#    properties instead of raw dataframe columns)
all_account_ids = sorted({
    acc for staged, _ in staged_and_scores for acc in (staged.senderId, staged.receiverId)
})
accounts = [Account.from_id(acc_id) for acc_id in all_account_ids]

account_to_idx = {acc.accountId: idx for idx, acc in enumerate(accounts)}
idx_to_account = {idx: acc for idx, acc in enumerate(accounts)}   # idx -> Account object, not bare string
num_nodes = len(accounts)

print(f"[OK] Laundering-network nodes (unique accounts): {num_nodes:,}")
print(f"     Laundering-network edges (transactions):    {len(staged_and_scores):,}")


# 6. Build the graph with NetworkX (directed multigraph --
#    same account pair CAN have multiple laundering transfers).
#    Every node/edge added here comes from the Account/Transaction
#    models -- the same models cluster_service.py uses.
G = nx.MultiDiGraph()

for idx, acc in idx_to_account.items():
    # GEXF only stores primitives -- pull the Account's fields out
    # individually rather than storing the object itself
    G.add_node(idx, account=acc.accountId, bank=acc.bank, account_number=acc.accountNumber)

for i, (staged, score) in enumerate(staged_and_scores, start=1):
    transaction = Transaction.from_staging(staged, tx_id=str(i), fraud_risk_score=score)

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
