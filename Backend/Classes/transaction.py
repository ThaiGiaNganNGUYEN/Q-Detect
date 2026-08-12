from sqlmodel import Field, SQLModel

class Transaction(SQLModel, table= True):
        """A class for transactions, used in cache, backend filtering, quantum and frontend"""
        transactionId : str = Field(primary_key=True)
        senderAcc : str =Field(foreign_key="account.accountId")
        receiverAcc : str =Field(foreign_key="account.accountId")
        amount : float = Field(index = True)
        transactionType : str = Field(index = True)
