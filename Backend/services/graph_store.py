"""Assign newly flagged transactions to stored graphs.

The poller calls assign_new_transactions() after caching each batch. Accounts
are nodes and flagged transactions are edges, so every new transaction does
one of three things:

    new      -- touches no known account: creates a graph with the next number
    grow     -- touches accounts of one graph: joins that graph
    merge    -- touches accounts of several graphs: joins them into the oldest

A graph that already has a decision keeps it when it grows, with
hasNewActivity set so the analyst knows to look again. See _merge() for how
decisions and notes combine.

Idempotent: it only picks up flagged transactions with no graph yet, so it's
safe to re-run after a crash. The same call backfills existing cached data
the first time it runs.
"""

from dataclasses import dataclass

import networkx as nx
from sqlalchemy import update
from sqlmodel import Session, SQLModel, func, select

from db import get_cache_engine
from models import Account, MuleGraph, MuleGraphAccount, MuleGraphTransaction, Transaction
from models.mule_graph import utc_now

GRAPH_TABLES = [MuleGraph.__table__, MuleGraphTransaction.__table__, MuleGraphAccount.__table__]
_ID_CHUNK = 1000


@dataclass
class AssignmentSummary:
    transactions: int = 0
    created: int = 0
    grown: int = 0
    merged: int = 0


def ensure_tables() -> None:
    """Create any missing tables. The graph tables reference account and
    transaction, so those are created here too on an empty database."""
    SQLModel.metadata.create_all(
        get_cache_engine(), tables=[Account.__table__, Transaction.__table__, *GRAPH_TABLES]
    )


def _merge(keep: MuleGraph, others: list[MuleGraph], session: Session) -> None:
    """Fold `others` into `keep`. A Fraud decision always wins, Safe survives
    only if every graph was Safe, and otherwise the result is Pending. Every
    note is kept, labelled with the graph it came from."""
    statuses = {keep.status, *(other.status for other in others)}
    status = "Fraud" if "Fraud" in statuses else "Safe" if statuses == {"Safe"} else "Pending"
    if status != keep.status:
        keep.status = status
        keep.statusUpdatedAt = utc_now()

    for other in others:
        if other.note:
            section = f"--- From Graph {other.id} ---\n{other.note}"
            keep.note = f"{keep.note}\n\n{section}" if keep.note else section
            keep.noteUpdatedAt = utc_now()
        other.mergedInto = keep.id

    other_ids = [other.id for other in others]
    for model in (MuleGraphTransaction, MuleGraphAccount):
        session.exec(
            update(model).where(model.graphId.in_(other_ids)).values(graphId=keep.id)
        )


def _refresh_totals(session: Session, graphs: dict[int, MuleGraph]) -> None:
    ids = list(graphs)
    for start in range(0, len(ids), _ID_CHUNK):
        chunk = ids[start:start + _ID_CHUNK]
        transaction_totals = session.exec(
            select(
                MuleGraphTransaction.graphId,
                func.count(),
                func.avg(Transaction.fraudRiskScore),
            )
            .join(Transaction, Transaction.id == MuleGraphTransaction.transactionId)
            .where(MuleGraphTransaction.graphId.in_(chunk))
            .group_by(MuleGraphTransaction.graphId)
        ).all()
        for graph_id, count, average in transaction_totals:
            graphs[graph_id].numTransactions = count
            graphs[graph_id].riskScore = round(100 * average)

        account_totals = session.exec(
            select(MuleGraphAccount.graphId, func.count())
            .where(MuleGraphAccount.graphId.in_(chunk))
            .group_by(MuleGraphAccount.graphId)
        ).all()
        for graph_id, count in account_totals:
            graphs[graph_id].numAccounts = count


def assign_new_transactions() -> AssignmentSummary:
    """Put every unassigned flagged transaction into a graph. All-or-nothing:
    one DB transaction, so a failure leaves them unassigned for the next run."""
    ensure_tables()
    summary = AssignmentSummary()

    with Session(get_cache_engine()) as session:
        new_edges = session.exec(
            select(Transaction.id, Transaction.senderAcc, Transaction.receiverAcc)
            .outerjoin(MuleGraphTransaction, MuleGraphTransaction.transactionId == Transaction.id)
            .where(Transaction.isFlagged, MuleGraphTransaction.transactionId.is_(None))
            .order_by(Transaction.id)
        ).all()
        if not new_edges:
            return summary

        known_accounts = dict(
            session.exec(select(MuleGraphAccount.accountId, MuleGraphAccount.graphId)).all()
        )

        # Connect new edges to each other and to the graphs they touch. Each
        # connected component below is then exactly one resulting graph.
        linked = nx.Graph()
        for _, sender, receiver in new_edges:
            linked.add_edge(("account", sender), ("account", receiver))
            for account in (sender, receiver):
                if account in known_accounts:
                    linked.add_edge(("account", account), ("graph", known_accounts[account]))

        component_of = {}
        groups = []
        for index, nodes in enumerate(nx.connected_components(linked)):
            groups.append({
                "accounts": {value for kind, value in nodes if kind == "account"},
                "graphs": sorted(value for kind, value in nodes if kind == "graph"),
                "transactions": [],
            })
            for kind, value in nodes:
                if kind == "account":
                    component_of[value] = index
        for tx_id, sender, _ in new_edges:
            groups[component_of[sender]]["transactions"].append(tx_id)

        # Largest first, earliest transaction breaking ties, so the biggest
        # new network in a batch gets the lowest new number.
        groups.sort(key=lambda g: (-len(g["accounts"]), g["transactions"][0]))

        touched: dict[int, MuleGraph] = {}
        for group in groups:
            if group["graphs"]:
                # Lock the rows so a status or note saved at the same moment
                # isn't lost, or written to a graph that was just merged away.
                existing = session.exec(
                    select(MuleGraph)
                    .where(MuleGraph.id.in_(group["graphs"]))
                    .order_by(MuleGraph.id)
                    .with_for_update()
                ).all()
                graph, others = existing[0], existing[1:]
                if others:
                    _merge(graph, others, session)
                    summary.merged += len(others)
                else:
                    summary.grown += 1
                if graph.status != "Pending":
                    graph.hasNewActivity = True
            else:
                graph = MuleGraph()
                session.add(graph)
                session.flush()  # assigns the graph's number
                summary.created += 1

            touched[graph.id] = graph
            session.add_all(
                MuleGraphTransaction(transactionId=tx_id, graphId=graph.id)
                for tx_id in group["transactions"]
            )
            session.add_all(
                MuleGraphAccount(accountId=account, graphId=graph.id)
                for account in group["accounts"]
                if account not in known_accounts
            )

        session.flush()
        _refresh_totals(session, touched)
        session.commit()

    summary.transactions = len(new_edges)
    return summary
