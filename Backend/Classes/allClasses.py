class Account(SQLModel, table=True):
    """A base class for bank accpounts"""
    accountId : str = Field(primary_key=True)

class GraphTransactions(SQLModel, table=True):
    "A base class that maps each transaction to a graph using a graphID"
    graphId : str = Field(primary_key= True)
    transactionId : str = Field(foreign_key="transaction.transactionId")

class Graph(SQLModel, table =True):
    """A base class for each graph or network of (fraudulent) transactions"""
    graphId : str = Field(primary_key=True) # Generate UUID after ? or will be provided by ML model
    checked : bool | None = False
    overallScore : float = None # Not required yet assuming we will create this graph class in backend before ML. 
                                # Do otherwise if not true case
    marker : str | None = Field(default=None, foreign_key="account.accountId")
    markedTime : datetime | None 
class Transaction(SQLModel, table= True):
        """A class for transactions, used in cache, backend filtering, quantum and frontend"""
        transactionId : str = Field(primary_key=True)
        senderAcc : str =Field(foreign_key="account.accountId")
        receiverAcc : str =Field(foreign_key="account.accountId")
        amount : float = Field(index = True)

class User(SQLModel, table = True):
    """Base class for each user of application. Stores username and password"""
    userId: str = Field(primary_key=True)
    username: str = Field(index= True)
    password: str = Field(index= True )