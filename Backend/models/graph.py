"""
Graph response schema -- NOT a DB table. This is the flat
{nodes: [...], edges: [...]} shape that graph-visualization libraries
(Cytoscape.js, vis.js, D3, react-force-graph, etc.) expect: each edge
references node IDs rather than nesting full node objects, since a
visualization renders each node once no matter how many edges touch it --
nesting full Account objects into every edge (like TransactionRead does)
would duplicate the same account data across every transaction it's
involved in, and grow the payload for no benefit here.
"""

from typing import List

from sqlmodel import SQLModel


class GraphNode(SQLModel):
    id: str              # matches Account.accountId
    bank: str
    accountNumber: str


class GraphEdge(SQLModel):
    id: str               # matches Transaction.transactionId
    source: str            # Account.accountId of the sender
    target: str             # Account.accountId of the receiver
    amount: float
    currency: str
    paymentFormat: str
    timestamp: str
    hoursFromStart: float
    isCrossBank: bool
    isCrossCurrency: bool
    isSelfTransfer: bool


class GraphResponse(SQLModel):
    numNodes: int
    numEdges: int
    nodes: List[GraphNode] = []
    edges: List[GraphEdge] = []