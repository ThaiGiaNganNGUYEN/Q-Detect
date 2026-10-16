from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel


class StagingTransaction(SQLModel, table=True):

    __tablename__ = "staging_transaction"

    id: Optional[int] = Field(default=None, primary_key=True)
    fromBank: str
    fromAccount: str
    toBank: str
    toAccount: str
    amountPaid: float
    paymentCurrency: str
    amountReceived: float
    receivingCurrency: str
    paymentFormat: str = Field(index=True)
    isLaundering: bool = Field(index=True)
    timestamp: datetime = Field(index=True)

    