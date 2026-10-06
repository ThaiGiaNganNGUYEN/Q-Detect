"""
Load the saved laundering graph and extract the real account identifiers
belonging to each connected cluster (candidate mule network).

Usage:
    uv run python analyze_clusters.py
"""

import os
import csv
import networkx as nx

GRAPH_PATH = "output/laundering_graph.gexf"
OUTPUT_CSV = "output/cluster_accounts.csv"

# ============================================================
# 1. Load the saved graph
# ============================================================
print(f"[INFO] Loading graph from {GRAPH_PATH}")
G = nx.read_gexf(GRAPH_PATH)   # node ids come back as strings when reloaded from GEXF

print(f"[OK] Loaded: {G.number_of_nodes():,} nodes, {G.number_of_edges():,} edges")

# ============================================================
# 2. Find connected components (weakly connected -- ignores edge direction,
#    since a mule ring can involve money flowing either way between accounts)
# ============================================================
components = list(nx.weakly_connected_components(G))
components.sort(key=len, reverse=True)

print(f"[OK] Found {len(components):,} clusters")

# ============================================================
# 3. For each cluster, pull the real account string from the
#    'account' node attribute -- not just the internal node id/index
# ============================================================
cluster_summaries = []
for cluster_id, node_ids in enumerate(components):
    sub = G.subgraph(node_ids)

    accounts = [G.nodes[n].get('account', n) for n in node_ids]

    cluster_summaries.append({
        'cluster_id': cluster_id,
        'num_accounts': len(node_ids),
        'num_transactions': sub.number_of_edges(),
        'accounts': accounts,
    })

# ============================================================
# 4. Print the top clusters with their actual account numbers
# ============================================================
print("\nTop 10 largest clusters:\n")
for c in cluster_summaries[:10]:
    print(f"Cluster {c['cluster_id']}: {c['num_accounts']} accounts, "
          f"{c['num_transactions']} transactions")
    for acc in c['accounts'][:10]:          # print first 10 accounts per cluster
        print(f"    {acc}")
    if len(c['accounts']) > 10:
        print(f"    ... and {len(c['accounts']) - 10} more")
    print()

# ============================================================
# 5. Save every cluster's full account list to CSV for further use
#    (e.g. flagging these accounts in your Q-Detect pipeline)
# ============================================================
os.makedirs("output", exist_ok=True)
with open(OUTPUT_CSV, "w", newline="") as f:
    writer = csv.writer(f)
    writer.writerow(["cluster_id", "num_accounts", "num_transactions", "account"])
    for c in cluster_summaries:
        for acc in c['accounts']:
            writer.writerow([c['cluster_id'], c['num_accounts'], c['num_transactions'], acc])

print(f"[OK] Saved full cluster -> account mapping to {OUTPUT_CSV}")

# ============================================================
# 6. Quick lookup helper: find which cluster a specific account belongs to
# ============================================================
def find_cluster_for_account(account_str, summaries=cluster_summaries):
    for c in summaries:
        if account_str in c['accounts']:
            return c
    return None

# Example usage (uncomment and set a real account you saw earlier):
# result = find_cluster_for_account("070_1004287C8")
# if result:
#     print(f"Account found in cluster {result['cluster_id']} "
#           f"({result['num_accounts']} accounts total)")