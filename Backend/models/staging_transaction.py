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

    # Derived relational fields -- filled in by with_derived_relational_fields()
    isCrossBank: Optional[bool] = None
    isCrossCurrency: Optional[bool] = None
    isSelfTransfer: Optional[bool] = None

    # Derived dataset-relative field -- filled in by with_hours_from_start(),
    # since it needs the whole dataset's earliest timestamp, not just this row
    hoursFromStart: Optional[float] = None

    @property
    def senderId(self) -> str:
        return f"{self.account}_{self.fromBank}"

    @property
    def receiverId(self) -> str:
        return f"{self.account1}_{self.toBank}"

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

    def with_derived_relational_fields(self) -> "StagingTransaction":
        """Return a copy with isCrossBank/isCrossCurrency/isSelfTransfer filled in."""
        return self.model_copy(update={
            "isCrossBank": self.fromBank != self.toBank,
            "isCrossCurrency": self.paymentCurrency != self.receivingCurrency,
            "isSelfTransfer": self.senderId == self.receiverId,
        })

    def with_hours_from_start(self, start_time: datetime) -> "StagingTransaction":
        """Return a copy with hoursFromStart filled in, relative to start_time."""
        return self.model_copy(update={
            "hoursFromStart": (self.timestamp - start_time).total_seconds() / 3600,
        })