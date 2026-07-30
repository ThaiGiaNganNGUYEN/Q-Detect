class GraphTransactions:
    "A base class that maps each transaction to a graph using a graphID"

    def __init__(self, graphId: str, transactionId: str):
        self.graphId = graphId
        self.transactionId = transactionId