from sqlmodel import Field, SQLModel
class GraphTransactions:
    "A base class that maps each transaction to a graph using a graphID"
    graphId : str = Field(primary_key= True)
    transactionId : str = Field(foreign_key=True)
