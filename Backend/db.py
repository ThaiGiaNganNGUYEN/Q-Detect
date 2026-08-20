import os

from dotenv import load_dotenv
from sqlmodel import create_engine

load_dotenv()

DATABASE_URL = os.environ["DATABASE_URL"]  # postgresql+psycopg://...
PSYCOPG_DSN = DATABASE_URL.replace("postgresql+psycopg://", "postgresql://")

_engine = create_engine(DATABASE_URL, echo=False)


def get_engine():
    return _engine


def get_session():
    from sqlmodel import Session

    with Session(_engine) as session:
        yield session