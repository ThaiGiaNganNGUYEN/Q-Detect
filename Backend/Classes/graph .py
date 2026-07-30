from sqlmodel import Field, SQLModel
from datetime import datetime

class Graph(SQLModel, table =True):
    """A base class for each graph or network of (fraudulent) transactions"""
    graphId : str = Field(primary_key=True) # Generate UUID after ? or will be provided by ML model
    checked : bool | None = False
    overallScore : float = None # Not required yet assuming we will create this graph class in backend before ML. 
                                # Do otherwise if not true case
    marker : str | None = Field(default=None, foreign_key="userId")
    markedTime : datetime | None 

    def __init__(self, graphId : str):
        self.graphId = graphId
        self.checked = False
        self.overallScore = 0.0
        self.marker = ""
        self.markedTime = ""
    