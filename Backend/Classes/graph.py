from sqlmodel import Field, SQLModel
from datetime import datetime
from .account import Account

class Graph(SQLModel, table =True):
    """A base class for each graph or network of (fraudulent) transactions"""
    graphId : str = Field(primary_key=True) # Generate UUID after ? or will be provided by ML model
    checked : bool | None = False
    overallScore : float | None = None # Not required yet assuming we will create this graph class in backend before ML. 
                                # Do otherwise if not true case
    marker : str | None = Field(default=None, foreign_key="account.accountId")
    markedTime: datetime | None = None
