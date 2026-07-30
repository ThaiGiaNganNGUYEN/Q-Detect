from sqlmodel import Field, SQLModel

##Imports sqlmodel to create table from python object
class Account(SQLModel, table=True):
    """A base class for bank accpounts"""
    accountId : str = Field(primary_key=True)
