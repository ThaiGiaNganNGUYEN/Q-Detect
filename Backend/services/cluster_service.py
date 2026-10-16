"""
Cluster/graph service layer -- reads scored transactions from the cache DB
and groups them into clusters (candidate mule networks) for the API.

The laundering graph is every cached transaction the model flagged
(isFlagged: score >= the model bundle's decision_threshold): accounts are
nodes, flagged transactions are edges. A cluster is one connected component
of that graph, numbered largest first.

Components are built from just (id, sender, receiver) of the flagged rows
and cached until the poller writes a new batch (MAX(transaction.id)
changes). Full transaction/account rows are only fetched for the clusters
actually being returned.

Deliberately has NO FastAPI imports or route decorators. This file should
be usable on its own (e.g. from a script, a test, or a different router)
without pulling in a web framework. routers/cluster_router.py is the only
place that knows this logic is being exposed over HTTP.
"""

from dataclasses import dataclass, field

import networkx as nx
from sqlalchemy import inspect
from sqlmodel import Session, func, select

from db import get_cache_engine
from models import (
    Account, Cluster, ClusterListResponse, GraphEdge, GraphNode, GraphResponse,
    Transaction, TransactionRead,
)


@dataclass
class _Component:
    accounts: set[str]
    transaction_ids: list[int] = field(default_factory=list)


@dataclass
class _Components:
    version: int | None = None
    components: list[_Component] = field(default_factory=list)
    account_index: dict[str, int] = field(default_factory=dict)


_cache = _Components()


def get_components() -> _Components:
    """Connected components of the flagged-transaction graph, largest first."""
    global _cache
    engine = get_cache_engine()
    # The poller creates the cache tables on its first batch.
    if not inspect(engine).has_table(Transaction.__tablename__):
        return _Components()

    with Session(engine) as session:
        version = session.exec(select(func.max(Transaction.id))).one()
        if version == _cache.version:
            return _cache
        edges = session.exec(
            select(Transaction.id, Transaction.senderAcc, Transaction.receiverAcc)
            .where(Transaction.isFlagged)
        ).all()

    # Undirected: connected components here = weakly connected components
    # of the directed transaction graph.
    G = nx.Graph()
    G.add_edges_from((sender, receiver) for _, sender, receiver in edges)
    components = [_Component(accounts=set(nodes)) for nodes in nx.connected_components(G)]

    account_index = {acc: i for i, comp in enumerate(components) for acc in comp.accounts}
    for tx_id, sender, _ in edges:
        components[account_index[sender]].transaction_ids.append(tx_id)

    # Largest first; earliest transaction breaks ties so cluster ids stay
    # stable between requests on the same data.
    for comp in components:
        comp.transaction_ids.sort()
    components.sort(key=lambda c: (-len(c.accounts), c.transaction_ids[0]))
    account_index = {acc: i for i, comp in enumerate(components) for acc in comp.accounts}

    _cache = _Components(version=version, components=components, account_index=account_index)
    return _cache


def invalidate_cache() -> None:
    """Force the next request to rebuild components -- needed after the cache
    DB is cleared, since a re-scored table can reach the same MAX(id) again."""
    global _cache
    _cache = _Components()


def _fetch_transactions(session: Session, transaction_ids: list[int]) -> list[Transaction]:
    return session.exec(
        select(Transaction).where(Transaction.id.in_(transaction_ids)).order_by(Transaction.id)
    ).all()


# ============================================================
# Flatten the WHOLE graph (or one cluster's subgraph) into
# {nodes: [...], edges: [...]} -- the shape graph-visualization
# frontends expect, where edges reference node IDs instead of nesting
# full node objects.
# ============================================================
def _graph_response(components: list[_Component]) -> GraphResponse:
    accounts = sorted(acc for comp in components for acc in comp.accounts)
    transaction_ids = [tx_id for comp in components for tx_id in comp.transaction_ids]

    nodes = []
    for account_id in accounts:
        acc = Account.from_id(account_id)
        nodes.append(GraphNode(id=acc.accountId, bank=acc.bank, accountNumber=acc.accountNumber))

    with Session(get_cache_engine()) as session:
        transactions = _fetch_transactions(session, transaction_ids) if transaction_ids else []

    edges = [
        GraphEdge(
            id=str(tx.id),
            source=tx.senderAcc,
            target=tx.receiverAcc,
            amount=tx.amountPaid,
            currency=tx.currencyPaid,
            paymentFormat=tx.paymentFormat,
            timestamp=str(tx.timestamp),
            hoursFromStart=tx.hoursFromStart,
            isCrossBank=tx.isCrossBank,
            isCrossCurrency=tx.isCrossCurrency,
            isSelfTransfer=tx.isSelfTransfer,
        )
        for tx in transactions
    ]

    return GraphResponse(numNodes=len(nodes), numEdges=len(edges), nodes=nodes, edges=edges)


def compute_full_graph() -> GraphResponse:
    return _graph_response(get_components().components)


def compute_graph_for_cluster(cluster_id: int) -> GraphResponse | None:
    """Flat {nodes, edges} for one specific cluster. Returns None if
    cluster_id is out of range -- the router decides how to turn that
    into an HTTP error."""
    components = get_components().components
    if cluster_id < 0 or cluster_id >= len(components):
        return None
    return _graph_response([components[cluster_id]])


# ============================================================
# Clusters with full TransactionRead objects (nested sender/receiver
# Account objects), read from the cache DB.
# ============================================================
def _build_cluster(session: Session, cluster_id: int, comp: _Component) -> Cluster:
    transactions = _fetch_transactions(session, comp.transaction_ids)
    accounts = {
        acc.accountId: acc
        for acc in session.exec(select(Account).where(Account.accountId.in_(comp.accounts))).all()
    }
    transaction_reads = [
        TransactionRead.from_transaction(tx, accounts[tx.senderAcc], accounts[tx.receiverAcc])
        for tx in transactions
    ]

    # Cluster-level risk score: average fraudRiskScore across this
    # cluster's transactions, as a percentage.
    total_score = sum(tx.fraudRiskScore for tx in transactions)
    risk_score = round(100 * total_score / len(transactions)) if transactions else 0

    return Cluster(
        clusterId=cluster_id,
        numAccounts=len(comp.accounts),
        numTransactions=len(transactions),
        riskScore=risk_score,
        transactions=transaction_reads,
    )


def list_clusters(min_size: int = 1, limit: int = 20) -> ClusterListResponse:
    """The `limit` largest clusters with at least `min_size` accounts."""
    matching = [
        (cluster_id, comp)
        for cluster_id, comp in enumerate(get_components().components)
        if len(comp.accounts) >= min_size
    ]
    with Session(get_cache_engine()) as session:
        clusters = [_build_cluster(session, cid, comp) for cid, comp in matching[:limit]]
    return ClusterListResponse(totalClusters=len(matching), clusters=clusters)


def get_cluster_by_id(cluster_id: int) -> Cluster | None:
    components = get_components().components
    if cluster_id < 0 or cluster_id >= len(components):
        return None
    with Session(get_cache_engine()) as session:
        return _build_cluster(session, cluster_id, components[cluster_id])


def get_cluster_for_account(account_id: str) -> Cluster | None:
    cached = get_components()
    cluster_id = cached.account_index.get(account_id)
    if cluster_id is None:
        return None
    with Session(get_cache_engine()) as session:
        return _build_cluster(session, cluster_id, cached.components[cluster_id])
