"""
Cluster model -- a connected group of accounts (a candidate mule network),
with the transactions that link them.

Not a DB table (table=False, the SQLModel default): a cluster isn't stored
directly, it's *computed* on demand from connected components in the graph.
If you later want to persist "known ring #4, reviewed by an analyst", that
would be a separate, real table (e.g. FlaggedCluster) -- keep that distinct
from this ad-hoc, recomputed-every-request response shape.
"""

from __future__ import annotations

from typing import List

from sqlmodel import SQLModel

from .transaction import TransactionRead


class Cluster(SQLModel):
    clusterId: int
    numAccounts: int
    numTransactions: int
    transactions: List[TransactionRead] = []


class ClusterListResponse(SQLModel):
    totalClusters: int
    clusters: List[Cluster] = []