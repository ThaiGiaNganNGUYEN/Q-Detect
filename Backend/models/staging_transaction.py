"""
StagingTransaction model -- one raw row as ingested from the source CSV,
before it's turned into a graph edge.

Deliberately has NO foreign keys to Account: at staging time you haven't
built the account index yet, and staging tables in general shouldn't
enforce referential integrity -- their whole job is to accept raw data
as-is so it can be validated/cleaned in a separate step. This mirrors a
classic ETL staging-table pattern.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel


class StagingTransaction(SQLModel, table=True):
    """One raw transaction row, validated but not yet linked into the graph."""

    __tablename__ = "staging_transaction"

    id: Optional[int] = Field(default=None, primary_key=True)

    fromBank: str
    account: str
    toBank: str
    account1: str

    amountPaid: float
    paymentCurrency: str
    amountReceived: float
    receivingCurrency: str
    paymentFormat: str = Field(index=True)

    isLaundering: bool = Field(default=False, index=True)
    timestamp: datetime = Field(index=True)

    # Derived temporal fields -- filled in by with_derived_time_fields(),
    # optional since they don't exist at the moment of raw ingestion
    hour: Optional[int] = None
    dayOfWeek: Optional[int] = None
    isWeekend: Optional[bool] = None
    isNight: Optional[bool] = None

    @property
    def senderId(self) -> str:
        return f"{self.fromBank}_{self.account}"

    @property
    def receiverId(self) -> str:
        return f"{self.toBank}_{self.account1}"

    def with_derived_time_fields(self) -> "StagingTransaction":
        """Return a copy with hour/dayOfWeek/isWeekend/isNight filled in."""
        hour = self.timestamp.hour
        dow = self.timestamp.weekday()
        return self.model_copy(update={
            "hour": hour,
            "dayOfWeek": dow,
            "isWeekend": dow >= 5,
            "isNight": (hour >= 22) or (hour <= 5),
        })