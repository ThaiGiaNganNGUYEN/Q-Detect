"""
Transaction model -- one money transfer, and one graph edge.

Two classes, deliberately separate:

Transaction      -- the real DB table in the cache DB: one scored staging
                     row. senderAcc/receiverAcc are plain foreign-key ID
                     strings. Written in bulk by services/cache_store.py.

TransactionRead   -- NOT a table (table=False, the SQLModel default).
                     A response schema for the API/frontend, nesting full
                     Account objects instead of bare ID strings. Keeping
                     this separate from Transaction is the standard
                     SQLModel pattern: your DB shape and your API response
                     shape are allowed to differ.
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime
from sqlmodel import Field, Relationship, SQLModel

from .account import Account


class Transaction(SQLModel, table=True):
    """A single scored transaction: the DB/graph-edge record. FK-only, no nesting."""

    __tablename__ = "transaction"

    # Same id as the staging_transaction row it came from, so re-writing a
    # batch is a no-op instead of a duplicate.
    id: int = Field(primary_key=True, sa_column_kwargs={"autoincrement": False})
    senderAcc: str = Field(foreign_key="account.accountId", index=True)
    receiverAcc: str = Field(foreign_key="account.accountId", index=True)

    amountPaid: float = Field(index=True)
    amountReceived: float
    currencyPaid: str
    currencyReceived: str
    paymentFormat: str = Field(index=True)

    timestamp: datetime = Field(index=True)
    hoursFromStart: float
    isCrossBank: bool
    isCrossCurrency: bool
    isSelfTransfer: bool
    isLaundering: bool = Field(index=True)
    # GraphSAGE mule-hunter output. Distinct from isLaundering, which is the
    # dataset's ground-truth label.
    fraudRiskScore: float = Field(index=True)
    # fraudRiskScore >= the model bundle's decision_threshold
    isFlagged: bool = Field(index=True)
    scoredAt: datetime = Field(sa_type=DateTime(timezone=True))

    sender: Optional["Account"] = Relationship(
        back_populates="sentTransactions",
        sa_relationship_kwargs={"foreign_keys": "Transaction.senderAcc"},
    )
    receiver: Optional["Account"] = Relationship(
        back_populates="receivedTransactions",
        sa_relationship_kwargs={"foreign_keys": "Transaction.receiverAcc"},
    )


class TransactionRead(SQLModel):
    """API/frontend response shape -- same transaction, with nested Account objects."""

    transactionId: str
    amountPaid: float
    currencyPaid: str
    paymentFormat: str
    timestamp: str
    hoursFromStart: float
    isCrossBank: bool
    isCrossCurrency: bool
    isSelfTransfer: bool
    # 0.0-1.0 fraud probability from the GraphSAGE mule-hunter model.
    fraudRiskScore: float = 0.0
    sender: Account
    receiver: Account

    @classmethod
    def from_transaction(
        cls, tx: "Transaction", sender: Account, receiver: Account
    ) -> "TransactionRead":
        return cls(
            transactionId=str(tx.id),
            amountPaid=tx.amountPaid,
            currencyPaid=tx.currencyPaid,
            paymentFormat=tx.paymentFormat,
            timestamp=str(tx.timestamp),
            hoursFromStart=tx.hoursFromStart,
            isCrossBank=tx.isCrossBank,
            isCrossCurrency=tx.isCrossCurrency,
            isSelfTransfer=tx.isSelfTransfer,
            fraudRiskScore=tx.fraudRiskScore,
            sender=sender,
            receiver=receiver,
        )
