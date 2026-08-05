from sqlmodel import Field, SQLModel
from .transaction import Transaction

class GraphTransactions(SQLModel, table=True):
    "A base class that maps each transaction to a graph using a graphID"
    graphId: str = Field(foreign_key="graph.graphId", primary_key=True)
transactionId: str = Field(foreign_key="transaction.transactionId", primary_key=True)
