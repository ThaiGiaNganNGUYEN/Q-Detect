"""
Account model -- one bank account, and one graph node.

table=True: this is a real database table (via SQLModel/SQLAlchemy),
so it can be queried, joined, and cached exactly like any other table
in your Postgres backend -- not just a response shape.
"""

from datetime import datetime
from typing import TYPE_CHECKING, List, Optional

from sqlmodel import Field, Relationship, SQLModel

if TYPE_CHECKING:
    # Only needed for type hints -- avoids a circular import at runtime,
    # since transaction.py also imports from this file.
    from .transaction import Transaction


class Account(SQLModel, table=True):
    """A bank account: identified by bank + account number, used as a graph node."""

    __tablename__ = "account"

    accountId: str = Field(primary_key=True)     # e.g. "1004287C8_070"
    bank: str = Field(index=True)                  # e.g. "070"
    accountNumber: str                              # e.g. "1004287C8"

    # Earliest/latest transaction timestamp this account appears in. NOT NULL
    # in the DB (always set by services/cache_store.py); None in Python only
    # so Account.from_id() still works for API response objects.
    firstSeen: Optional[datetime] = Field(default=None, nullable=False)
    lastSeen: Optional[datetime] = Field(default=None, nullable=False, index=True)

    sentTransactions: List["Transaction"] = Relationship(
        back_populates="sender",
        sa_relationship_kwargs={"foreign_keys": "Transaction.senderAcc"},
    )
    receivedTransactions: List["Transaction"] = Relationship(
        back_populates="receiver",
        sa_relationship_kwargs={"foreign_keys": "Transaction.receiverAcc"},
    )

    @classmethod
    def from_id(cls, account_id: str) -> "Account":
        """Split '1004287C8_070' -> Account(accountNumber='1004287C8',bank='070')."""
        account_number, _, bank = account_id.partition("_")
        return cls(accountId=account_id, bank=bank, accountNumber=account_number)