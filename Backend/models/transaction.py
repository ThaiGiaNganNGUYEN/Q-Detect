from datetime import datetime

from sqlmodel import Field, SQLModel


class StagingTransaction(SQLModel, table=True):
    """Raw AML transaction rows, loaded 1:1 from the source CSV."""

    __tablename__ = "staging_transactions"

    id: int | None = Field(default=None, primary_key=True)
    timestamp: datetime
    from_bank: str
    from_account: str
    to_bank: str
    to_account: str
    amount_received: float
    receiving_currency: str
    amount_paid: float
    payment_currency: str
    payment_format: str
    is_laundering: bool
