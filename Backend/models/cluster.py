"""
API response shapes for a cluster -- a connected group of accounts (a
candidate mule network), with the transactions that link them.

Not DB tables (table=False, the SQLModel default): the stored data lives in
models/mule_graph.py, and these are what the API sends for it.
"""

from __future__ import annotations

from datetime import datetime
from typing import List, Literal, Optional

from sqlmodel import SQLModel

from .transaction import TransactionRead

GraphStatus = Literal["Pending", "Safe", "Fraud"]


class Cluster(SQLModel):
    # The graph's stable number -- the frontend shows it as "Graph {clusterId}".
    clusterId: int
    numAccounts: int
    numTransactions: int
    # 0-100: average fraudRiskScore of this cluster's transactions.
    riskScore: int = 0
    status: GraphStatus = "Pending"
    # New flagged transactions arrived after the analyst's decision.
    hasNewActivity: bool = False
    transactions: List[TransactionRead] = []


class ClusterListResponse(SQLModel):
    totalClusters: int
    clusters: List[Cluster] = []


class GraphStatusRequest(SQLModel):
    status: GraphStatus


class GraphStatusResponse(SQLModel):
    clusterId: int
    status: GraphStatus
    hasNewActivity: bool


class GraphNoteRequest(SQLModel):
    note: str


class GraphNoteResponse(SQLModel):
    clusterId: int
    note: str
    updatedAt: Optional[datetime] = None
