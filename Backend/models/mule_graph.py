"""
Stored mule-network graphs: one row per graph, plus which transactions and
accounts belong to it. These live in the cache DB, next to the transaction
and account tables they point at.

The graph's id is the number the frontend shows ("Graph 7"). It is assigned
once and never changes or gets reused, so an analyst's status and note stay
attached to the same network when new batches arrive.

Written by services/graph_store.py (membership and totals) and
services/cluster_service.py (status and note).
"""

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import DateTime, Text
from sqlmodel import Field, SQLModel


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class MuleGraph(SQLModel, table=True):
    __tablename__ = "mule_graph"

    id: Optional[int] = Field(default=None, primary_key=True)

    # "Pending", "Safe" or "Fraud"
    status: str = Field(default="Pending", index=True)
    note: str = Field(default="", sa_type=Text)
    # New flagged transactions arrived after the analyst made a decision.
    # Cleared the next time the status is set.
    hasNewActivity: bool = Field(default=False)

    # Stored so listing graphs doesn't have to aggregate every transaction.
    numAccounts: int = Field(default=0, index=True)
    numTransactions: int = 0
    # 0-100: average fraudRiskScore of this graph's transactions.
    riskScore: int = 0

    # Set when a new transaction joined this graph to an older one. The row is
    # kept as a record of the merge, but is no longer served by the API.
    mergedInto: Optional[int] = Field(default=None, foreign_key="mule_graph.id", index=True)

    createdAt: datetime = Field(default_factory=utc_now, sa_type=DateTime(timezone=True))
    statusUpdatedAt: Optional[datetime] = Field(default=None, sa_type=DateTime(timezone=True))
    noteUpdatedAt: Optional[datetime] = Field(default=None, sa_type=DateTime(timezone=True))


class MuleGraphTransaction(SQLModel, table=True):
    """Which graph a flagged transaction belongs to. A row here also marks the
    transaction as already assigned."""

    __tablename__ = "mule_graph_transaction"

    transactionId: int = Field(
        primary_key=True, foreign_key="transaction.id", sa_column_kwargs={"autoincrement": False}
    )
    graphId: int = Field(foreign_key="mule_graph.id", index=True)


class MuleGraphAccount(SQLModel, table=True):
    """Which graph an account belongs to. An account is only ever in one."""

    __tablename__ = "mule_graph_account"

    accountId: str = Field(primary_key=True, foreign_key="account.accountId")
    graphId: int = Field(foreign_key="mule_graph.id", index=True)
