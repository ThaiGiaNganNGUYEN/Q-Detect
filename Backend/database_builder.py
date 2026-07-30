from sqlmodel import SQLModel, create_engine

def createEngine():
    """Creates Database using SQLAlchemy engine"""
    engine = create_engine("postgresql:///qdetectdb.db", echo=True) # Echo = true for debugging
    SQLModel.metadata.create_all(engine)    