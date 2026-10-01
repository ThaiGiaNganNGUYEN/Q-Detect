import os

from dotenv import load_dotenv
from sqlmodel import Session, create_engine

load_dotenv()

STAGING_DATABASE_URL = os.environ["STAGING_DATABASE_URL"]  # postgresql+psycopg://...
CACHE_DATABASE_URL = os.environ["CACHE_DATABASE_URL"]  # postgresql+psycopg://...


def _to_psycopg_dsn(url: str) -> str:
    return url.replace("postgresql+psycopg://", "postgresql://")


STAGING_PSYCOPG_DSN = _to_psycopg_dsn(STAGING_DATABASE_URL)
CACHE_PSYCOPG_DSN = _to_psycopg_dsn(CACHE_DATABASE_URL)

_staging_engine = create_engine(STAGING_DATABASE_URL, echo=False)
_cache_engine = create_engine(CACHE_DATABASE_URL, echo=False)


def get_staging_engine():
    return _staging_engine


def get_cache_engine():
    return _cache_engine


def get_staging_session():
    with Session(_staging_engine) as session:
        yield session


def get_cache_session():
    with Session(_cache_engine) as session:
        yield session
