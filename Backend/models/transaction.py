"""
Transaction model -- one money transfer, and one graph edge.

Two classes, deliberately separate:

Transaction      -- the real DB table. senderAcc/receiverAcc are plain
                     foreign-key ID strings (matches your example exactly).
                     This is what gets persisted and what backs each
                     graph edge.

TransactionRead   -- NOT a table (table=False, the SQLModel default).
                     A response schema for the API/frontend, nesting full
                     Account objects instead of bare ID strings. Keeping
                     this separate from Transaction is the standard
                     SQLModel pattern: your DB shape and your API response
                     shape are allowed to differ.
"""

from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlmodel import Field, Relationship, SQLModel

from .account import Account

if TYPE_CHECKING:
    # StagingTransaction is only ever used as a plain Python type hint on a
    # method parameter (from_staging), never as a real Pydantic field --
    # so it's safe to keep this one TYPE_CHECKING-only, unlike Account.
    from .staging_transaction import StagingTransaction


class Transaction(SQLModel, table=True):
    """A single transaction: the DB/graph-edge record. FK-only, no nesting."""

    __tablename__ = "transaction"

    transactionId: str = Field(primary_key=True)
    senderAcc: str = Field(foreign_key="account.accountId", index=True)
    receiverAcc: str = Field(foreign_key="account.accountId", index=True)

    amountPaid: float = Field(index=True)
    amountReceived: float
    currencyPaid: str
    currencyReceived: str
    paymentFormat: str = Field(index=True)

    timestamp: datetime = Field(index=True)
    isNight: bool = Field(default=False)
    isWeekend: bool = Field(default=False)
    hoursFromStart: float = Field(default=0.0)
    isCrossBank: bool = Field(default=False)
    isCrossCurrency: bool = Field(default=False)
    isSelfTransfer: bool = Field(default=False)
    isLaundering: bool = Field(default=False, index=True)

    sender: Optional["Account"] = Relationship(
        back_populates="sentTransactions",
        sa_relationship_kwargs={"foreign_keys": "Transaction.senderAcc"},
    )
    receiver: Optional["Account"] = Relationship(
        back_populates="receivedTransactions",
        sa_relationship_kwargs={"foreign_keys": "Transaction.receiverAcc"},
    )

    @classmethod
    def from_staging(cls, staging: "StagingTransaction", tx_id: str) -> "Transaction":
        """Build a graph-ready Transaction from a validated StagingTransaction."""
        return cls(
            transactionId=tx_id,
            senderAcc=staging.senderId,
            receiverAcc=staging.receiverId,
            amountPaid=staging.amountPaid,
            amountReceived=staging.amountReceived,
            currencyPaid=staging.paymentCurrency,
            currencyReceived=staging.receivingCurrency,
            paymentFormat=staging.paymentFormat,
            timestamp=staging.timestamp,
            isNight=bool(staging.isNight),
            isWeekend=bool(staging.isWeekend),
            hoursFromStart=staging.hoursFromStart or 0.0,
            isCrossBank=bool(staging.isCrossBank),
            isCrossCurrency=bool(staging.isCrossCurrency),
            isSelfTransfer=bool(staging.isSelfTransfer),
            isLaundering=staging.isLaundering,
        )

    def edge_attrs(self) -> dict:
        """
        Flat dict of primitive values only -- for use as a NetworkX/GEXF
        edge attribute set. Graph file formats can't store nested objects,
        so sender/receiver identity is carried by which two nodes this
        edge connects, not by attributes on the edge itself.
        """
        return {
            "amount_paid": self.amountPaid,
            "amount_received": self.amountReceived,
            "currency_paid": self.currencyPaid,
            "currency_received": self.currencyReceived,
            "payment_format": self.paymentFormat,
            "timestamp": str(self.timestamp),
            "is_night": self.isNight,
            "is_weekend": self.isWeekend,
            "hours_from_start": self.hoursFromStart,
            "is_cross_bank": int(self.isCrossBank),
            "is_cross_currency": int(self.isCrossCurrency),
            "is_self_transfer": int(self.isSelfTransfer),
        }


class TransactionRead(SQLModel):
    """API/frontend response shape -- same transaction, with nested Account objects."""

    transactionId: str
    amountPaid: float
    amountReceived: float
    currencyPaid: str
    currencyReceived: str
    paymentFormat: str
    timestamp: str
    isNight: bool
    isWeekend: bool
    hoursFromStart: float
    isCrossBank: bool
    isCrossCurrency: bool
    isSelfTransfer: bool
    sender: Account
    receiver: Account

    @classmethod
    def from_transaction(
        cls, tx: "Transaction", sender: Account, receiver: Account
    ) -> "TransactionRead":
        return cls(
            transactionId=tx.transactionId,
            amountPaid=tx.amountPaid,
            amountReceived=tx.amountReceived,
            currencyPaid=tx.currencyPaid,
            currencyReceived=tx.currencyReceived,
            paymentFormat=tx.paymentFormat,
            timestamp=str(tx.timestamp),
            isNight=tx.isNight,
            isWeekend=tx.isWeekend,
            hoursFromStart=tx.hoursFromStart,
            isCrossBank=tx.isCrossBank,
            isCrossCurrency=tx.isCrossCurrency,
            isSelfTransfer=tx.isSelfTransfer,
            sender=sender,
            receiver=receiver,
        )