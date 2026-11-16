from genericpath import exists
import Classes
from sqlmodel import SQLModel, create_engine
import os
from sqlmodel import SQLModel, create_engine



def createEngine():
    """Creates Database using SQLAlchemy engine"""

    # Guardrail to check if database already exists before creating. If not, create it.
    # Single source of truth for database creation.
    # engine = create_engine("postgresql+psycopg://qdetect_dev:devQdetect@127.0.0.1:5432/qdetect_test", echo=True) # Echo = true for debugging
    DATABASE_URL = os.getenv("DATABASE_URL")

    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL environment variable is not set")
    engine = create_engine(DATABASE_URL, echo=True)
    SQLModel.metadata.create_all(engine)

# createDatabase()
createEngine()