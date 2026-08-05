from sqlmodel import Field, SQLModel

class User(SQLModel, table = True):
    """Base class for each user of application. Stores username and password"""
    userId: str = Field(primary_key=True)
    username: str = Field(index= True)
    password: str = Field(index= True )
