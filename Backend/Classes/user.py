class User:
    """Base class for each user of application. Stores username and password"""

    def __init__(self, userID : str, username :str, password: str):
        self.userId = userID
        self.username = username
        self.password = password