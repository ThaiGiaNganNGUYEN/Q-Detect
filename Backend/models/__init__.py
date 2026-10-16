"""
Models package.

Import order matters here: Account and Transaction reference each other
(Account.sentTransactions -> "Transaction", Transaction.sender -> "Account").
Both real classes must be imported into the same namespace before SQLModel
resolves those forward references (e.g. before SQLModel.metadata.create_all()
runs, or before FastAPI builds its OpenAPI schema) -- otherwise you'll hit a
NameError like "Transaction is not defined" at startup.

Importing everything through this __init__.py, and importing the package
itself (not individual files) elsewhere in the project, guarantees that
order without you having to think about it each time.
"""

from .account import Account
from .staging_transaction import StagingTransaction
from .ingestion_checkpoint import IngestionCheckpoint
from .transaction import Transaction, TransactionRead
from .cluster import Cluster, ClusterListResponse
from .graph import GraphNode, GraphEdge, GraphResponse

__all__ = [
    "Account",
    "StagingTransaction",
    "IngestionCheckpoint",
    "Transaction",
    "TransactionRead",
    "Cluster",
    "ClusterListResponse",
    "GraphNode",
    "GraphEdge",
    "GraphResponse",
]