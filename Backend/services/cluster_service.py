"""
Cluster/graph service layer -- serves the stored graphs to the API and saves
analyst decisions on them.

A cluster is one row of mule_graph, with its members read from
mule_graph_transaction and mule_graph_account. Nothing is recomputed per
request: services/graph_store.py keeps those tables up to date as the poller
caches new batches. clusterId is the graph's stable number.

Deliberately has NO FastAPI imports or route decorators. This file should
be usable on its own (e.g. from a script, a test, or a different router)
without pulling in a web framework. routers/cluster_router.py is the only
place that knows this logic is being exposed over HTTP.
"""

from sqlalchemy import inspect
from sqlmodel import Session, func, select

from db import get_cache_engine
from models import (
    Account, Cluster, ClusterListResponse, GraphEdge, GraphNode, GraphNoteResponse,
    GraphResponse, GraphStatusResponse, MuleGraph, MuleGraphAccount, MuleGraphTransaction,
    Transaction, TransactionRead,
)
from models.mule_graph import utc_now


def _tables_ready() -> bool:
    # Created on the first assignment run (app startup or the poller's first batch).
    return inspect(get_cache_engine()).has_table(MuleGraphAccount.__tablename__)


def _active_graph(session: Session, cluster_id: int, lock: bool = False) -> MuleGraph | None:
    """The graph with this number, or None if it doesn't exist or was merged away."""
    graph = session.get(MuleGraph, cluster_id, with_for_update=lock or None)
    return graph if graph is not None and graph.mergedInto is None else None


def _graph_transactions(session: Session, graph_id: int | None = None) -> list[Transaction]:
    query = select(Transaction).join(
        MuleGraphTransaction, MuleGraphTransaction.transactionId == Transaction.id
    )
    if graph_id is not None:
        query = query.where(MuleGraphTransaction.graphId == graph_id)
    return session.exec(query.order_by(Transaction.id)).all()


# ============================================================
# Flatten the WHOLE graph (or one cluster's subgraph) into
# {nodes: [...], edges: [...]} -- the shape graph-visualization
# frontends expect, where edges reference node IDs instead of nesting
# full node objects.
# ============================================================
def _graph_response(session: Session, graph_id: int | None = None) -> GraphResponse:
    account_query = select(MuleGraphAccount.accountId)
    if graph_id is not None:
        account_query = account_query.where(MuleGraphAccount.graphId == graph_id)

    nodes = []
    for account_id in sorted(session.exec(account_query).all()):
        acc = Account.from_id(account_id)
        nodes.append(GraphNode(id=acc.accountId, bank=acc.bank, accountNumber=acc.accountNumber))

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
        for tx in _graph_transactions(session, graph_id)
    ]

    return GraphResponse(numNodes=len(nodes), numEdges=len(edges), nodes=nodes, edges=edges)


def compute_full_graph() -> GraphResponse:
    if not _tables_ready():
        return GraphResponse(numNodes=0, numEdges=0, nodes=[], edges=[])
    with Session(get_cache_engine()) as session:
        return _graph_response(session)


def compute_graph_for_cluster(cluster_id: int) -> GraphResponse | None:
    """Flat {nodes, edges} for one specific cluster. Returns None if there's
    no such cluster -- the router decides how to turn that into an HTTP error."""
    if not _tables_ready():
        return None
    with Session(get_cache_engine()) as session:
        if _active_graph(session, cluster_id) is None:
            return None
        return _graph_response(session, cluster_id)


# ============================================================
# Clusters with full TransactionRead objects (nested sender/receiver
# Account objects), read from the cache DB.
# ============================================================
def _build_cluster(session: Session, graph: MuleGraph) -> Cluster:
    transactions = _graph_transactions(session, graph.id)
    accounts = {
        acc.accountId: acc
        for acc in session.exec(
            select(Account)
            .join(MuleGraphAccount, MuleGraphAccount.accountId == Account.accountId)
            .where(MuleGraphAccount.graphId == graph.id)
        ).all()
    }
    return Cluster(
        clusterId=graph.id,
        numAccounts=graph.numAccounts,
        numTransactions=graph.numTransactions,
        riskScore=graph.riskScore,
        status=graph.status,
        hasNewActivity=graph.hasNewActivity,
        transactions=[
            TransactionRead.from_transaction(tx, accounts[tx.senderAcc], accounts[tx.receiverAcc])
            for tx in transactions
        ],
    )


def list_clusters(min_size: int = 1, limit: int = 20) -> ClusterListResponse:
    """The `limit` largest clusters with at least `min_size` accounts."""
    if not _tables_ready():
        return ClusterListResponse(totalClusters=0, clusters=[])
    with Session(get_cache_engine()) as session:
        matching = (MuleGraph.mergedInto.is_(None), MuleGraph.numAccounts >= min_size)
        total = session.exec(select(func.count()).select_from(MuleGraph).where(*matching)).one()
        graphs = session.exec(
            select(MuleGraph)
            .where(*matching)
            .order_by(MuleGraph.numAccounts.desc(), MuleGraph.id)
            .limit(limit)
        ).all()
        return ClusterListResponse(
            totalClusters=total, clusters=[_build_cluster(session, graph) for graph in graphs]
        )


def get_cluster_by_id(cluster_id: int) -> Cluster | None:
    if not _tables_ready():
        return None
    with Session(get_cache_engine()) as session:
        graph = _active_graph(session, cluster_id)
        return _build_cluster(session, graph) if graph else None


def get_cluster_for_account(account_id: str) -> Cluster | None:
    if not _tables_ready():
        return None
    with Session(get_cache_engine()) as session:
        membership = session.get(MuleGraphAccount, account_id)
        if membership is None:
            return None
        graph = _active_graph(session, membership.graphId)
        return _build_cluster(session, graph) if graph else None


# ============================================================
# Analyst decisions: the Mark as Safe / Mark as Fraud buttons and the note.
# Each returns None when there's no such cluster.
# ============================================================
def set_status(cluster_id: int, status: str) -> GraphStatusResponse | None:
    if not _tables_ready():
        return None
    with Session(get_cache_engine()) as session:
        graph = _active_graph(session, cluster_id, lock=True)
        if graph is None:
            return None
        graph.status = status
        graph.hasNewActivity = False
        graph.statusUpdatedAt = utc_now()
        session.add(graph)
        session.commit()
        return GraphStatusResponse(
            clusterId=graph.id, status=graph.status, hasNewActivity=graph.hasNewActivity
        )


def _note_response(graph: MuleGraph) -> GraphNoteResponse:
    return GraphNoteResponse(clusterId=graph.id, note=graph.note, updatedAt=graph.noteUpdatedAt)


def get_note(cluster_id: int) -> GraphNoteResponse | None:
    """Also None when the cluster has no note yet, which the frontend expects as a 404."""
    if not _tables_ready():
        return None
    with Session(get_cache_engine()) as session:
        graph = _active_graph(session, cluster_id)
        return _note_response(graph) if graph is not None and graph.note else None


def save_note(cluster_id: int, note: str) -> GraphNoteResponse | None:
    if not _tables_ready():
        return None
    with Session(get_cache_engine()) as session:
        graph = _active_graph(session, cluster_id, lock=True)
        if graph is None:
            return None
        graph.note = note
        graph.noteUpdatedAt = utc_now()
        session.add(graph)
        session.commit()
        return _note_response(graph)
