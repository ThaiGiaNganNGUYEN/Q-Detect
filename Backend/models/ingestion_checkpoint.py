from datetime import datetime, timezone

from sqlalchemy import DateTime
from sqlmodel import Field, SQLModel


class IngestionCheckpoint(SQLModel, table=True):
    """Last staging_transaction.id a recurring job has fully processed, one row per job."""

    __tablename__ = "ingestion_checkpoint"

    jobName: str = Field(primary_key=True)
    lastId: int = Field(default=0)
    updatedAt: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_type=DateTime(timezone=True),
    )
