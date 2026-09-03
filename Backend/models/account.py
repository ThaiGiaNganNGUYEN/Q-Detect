"""
Account model -- one bank account, and one graph node.

table=True: this is a real database table (via SQLModel/SQLAlchemy),
so it can be queried, joined, and cached exactly like any other table
in your Postgres backend -- not just a response shape.
"""

from typing import TYPE_CHECKING, List, Optional

from sqlmodel import Field, Relationship, SQLModel

if TYPE_CHECKING:
    # Only needed for type hints -- avoids a circular import at runtime,
    # since transaction.py also imports from this file.
    from .transaction import Transaction


class Account(SQLModel, table=True):
    """A bank account: identified by bank + account number, used as a graph node."""

    __tablename__ = "account"

    accountId: str = Field(primary_key=True)     # e.g. "070_1004287C8"
    bank: str = Field(index=True)                  # e.g. "070"
    accountNumber: str                              # e.g. "1004287C8"

    # Two separate relationships back to Transaction, since a Transaction
    # has TWO foreign keys into this table (senderAcc, receiverAcc) --
    # sa_relationship_kwargs disambiguates which FK each relationship follows.
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
        """Split '070_1004287C8' -> Account(bank='070', accountNumber='1004287C8')."""
        bank, _, account_number = account_id.partition("_")
        return cls(accountId=account_id, bank=bank, accountNumber=account_number)