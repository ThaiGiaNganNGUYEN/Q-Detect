"""
Cluster/graph service layer -- all business logic for reading the saved
laundering graph and computing clusters or flat graph responses.

Deliberately has NO FastAPI imports or route decorators. This file should
be usable on its own (e.g. from a script, a test, or a different router)
without pulling in a web framework. routers/cluster_router.py is the only
place that knows this logic is being exposed over HTTP.
"""

import networkx as nx
from pathlib import Path
from models import Account, TransactionRead, Cluster, GraphNode, GraphEdge, GraphResponse

GRAPH_PATH = str(Path(__file__).resolve().parent / "output" / "laundering_graph.gexf")


# ============================================================
# Load the graph once, not on every call (rebuilding/reloading per-call
# would be slow). Module-level cache -- shared across every caller that
# imports this module, for the lifetime of the process.
# ============================================================
_graph_cache: nx.Graph | None = None


def get_graph() -> nx.Graph:
    global _graph_cache
    if _graph_cache is None:
        _graph_cache = nx.read_gexf(GRAPH_PATH)
    return _graph_cache


def get_sorted_components(G: nx.Graph | None = None) -> list[set]:
    """Weakly connected components, largest first -- one call, reused by
    both compute_full_graph (via cluster_id) and compute_clusters."""
    G = G if G is not None else get_graph()
    components = list(nx.weakly_connected_components(G))
    components.sort(key=len, reverse=True)
    return components


# ============================================================
# Flatten the WHOLE graph (or one cluster's subgraph) into
# {nodes: [...], edges: [...]} -- the shape graph-visualization
# frontends expect, where edges reference node IDs instead of nesting
# full node objects.
# ============================================================
def compute_full_graph(cluster_node_ids: set | None = None) -> GraphResponse:
    G = get_graph()

    # Either the whole graph, or just one cluster's subgraph if the
    # caller passed a specific set of node ids
    sub = G.subgraph(cluster_node_ids) if cluster_node_ids is not None else G

    nodes = [
        GraphNode(
            id=data.get('account', node_id),
            bank=data.get('bank', ''),
            accountNumber=data.get('account_number', ''),
        )
        for node_id, data in sub.nodes(data=True)
    ]

    edges = []
    for i, (src, dst, edge_data) in enumerate(sub.edges(data=True), start=1):
        edges.append(GraphEdge(
            id=str(i),
            source=G.nodes[src].get('account', src),
            target=G.nodes[dst].get('account', dst),
            amount=float(edge_data.get('amount_paid', 0.0)),
            currency=str(edge_data.get('currency_paid', '')),
            paymentFormat=str(edge_data.get('payment_format', '')),
            timestamp=str(edge_data.get('timestamp', '')),
            hoursFromStart=float(edge_data.get('hours_from_start', 0.0)),
            isCrossBank=bool(edge_data.get('is_cross_bank', False)),
            isCrossCurrency=bool(edge_data.get('is_cross_currency', False)),
            isSelfTransfer=bool(edge_data.get('is_self_transfer', False)),
        ))

    return GraphResponse(
        numNodes=sub.number_of_nodes(),
        numEdges=sub.number_of_edges(),
        nodes=nodes,
        edges=edges,
    )


def compute_graph_for_cluster(cluster_id: int) -> GraphResponse | None:
    """Flat {nodes, edges} for one specific cluster. Returns None if
    cluster_id is out of range -- the router decides how to turn that
    into an HTTP error."""
    components = get_sorted_components()
    if cluster_id < 0 or cluster_id >= len(components):
        return None
    return compute_full_graph(cluster_node_ids=components[cluster_id])


# ============================================================
# For each cluster, rebuild TransactionRead objects (with nested
# sender/receiver Account objects) directly from the graph's edge
# attributes.
# ============================================================
def compute_clusters(min_size: int = 1) -> list[Cluster]:
    G = get_graph()
    components = get_sorted_components(G)

    clusters = []
    tx_id_counter = 1

    for cluster_id, node_ids in enumerate(components):
        if len(node_ids) < min_size:
            continue

        sub = G.subgraph(node_ids)
        transactions: list[TransactionRead] = []

        # G is a MultiDiGraph -- edges(data=True) gives every individual
        # transaction between two nodes, not just one per account pair
        for src, dst, edge_data in sub.edges(data=True):
            sender = Account.from_id(G.nodes[src].get('account', src))
            receiver = Account.from_id(G.nodes[dst].get('account', dst))

            transactions.append(TransactionRead(
                transactionId=str(tx_id_counter),
                amountPaid=float(edge_data.get('amount_paid', 0.0)),
                currencyPaid=str(edge_data.get('currency_paid', '')),
                paymentFormat=str(edge_data.get('payment_format', '')),
                timestamp=str(edge_data.get('timestamp', '')),
                hoursFromStart=float(edge_data.get('hours_from_start', 0.0)),
                isCrossBank=bool(edge_data.get('is_cross_bank', False)),
                isCrossCurrency=bool(edge_data.get('is_cross_currency', False)),
                isSelfTransfer=bool(edge_data.get('is_self_transfer', False)),
                # Placeholder until real ML scoring exists -- 0.0/1.0 mirroring
                # is_laundering. Swap this one line for a real per-transaction
                # fraud probability (e.g. 0.6995) later; nothing below needs to change.
                fraudRiskScore=float(edge_data.get('is_laundering', False)),
                sender=sender,
                receiver=receiver,
            ))
            tx_id_counter += 1

        # Cluster-level risk score: average fraud_risk_score across this
        # cluster's transactions, as a percentage. Averaging (not counting
        # how many are "flagged") is what makes this keep working once
        # fraudRiskScore becomes a real continuous probability instead of 0/1.
        total_score = sum(tx.fraudRiskScore for tx in transactions)
        risk_score = round(100 * total_score / len(transactions)) if transactions else 0

        clusters.append(Cluster(
            clusterId=cluster_id,
            numAccounts=len(node_ids),
            numTransactions=sub.number_of_edges(),
            riskScore=risk_score,
            transactions=transactions,
        ))

    return clusters


def get_cluster_by_id(cluster_id: int) -> Cluster | None:
    for c in compute_clusters(min_size=1):
        if c.clusterId == cluster_id:
            return c
    return None


def get_cluster_for_account(account_id: str) -> Cluster | None:
    for c in compute_clusters(min_size=1):
        for tx in c.transactions:
            if tx.sender.accountId == account_id or tx.receiver.accountId == account_id:
                return c
    return None