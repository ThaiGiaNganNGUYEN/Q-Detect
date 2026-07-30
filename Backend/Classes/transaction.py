from sqlmodel import Field, SQLModel

class Transaction(SQLModel, Table= True):
        """A class for transactions, used in cache, backend filtering, quantum and frontend"""
        transactionId : str = Field(primary_key=True)
        senderAcc : str =Field(foreign_key="accountId")
        receiverAcc : str =Field(foreign_key="accountId")
        amount : int = Field(index = True)
        transactionType : str = Field(index = True)
