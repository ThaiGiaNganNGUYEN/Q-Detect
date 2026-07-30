class Graph:
    """A base class for each graph or network of (fraudulent) transactions"""

    def __init__(self, graphId : str):
        self.graphId = graphId
        self.checked = False
        self.overallScore = 0.0
        self.marker = ""
        self.markedTime = ""