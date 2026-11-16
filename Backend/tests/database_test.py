import pytest
from sqlmodel import SQLModel, Session, create_engine, select

from Classes.account import Account
from Classes.transaction import Transaction
from Classes.graph import Graph
from Classes.graph_transactions import GraphTransactions
from Classes.user import User



def test_account_can_be_created():
    account = Account(accountId="ACC001")

    assert account.accountId == "ACC001"

def test_transaction_can_be_created():
    transaction = Transaction(transactionId="TXN001", senderAcc="ACC001", receiverAcc="ACC002", amount=100.023)

    assert transaction.transactionId == "TXN001"
    assert transaction.senderAcc == "ACC001"
    assert transaction.receiverAcc == "ACC002"
    assert transaction.amount == 100.023

def test_graph_can_be_created():
    graph = Graph(graphId="GRAPH001", checked=True, overallScore=0.85, marker="ACC001")

    assert graph.graphId == "GRAPH001"
    assert graph.checked is True
    assert graph.overallScore == 0.85
    assert graph.marker == "ACC001"

def test_user_can_be_created():
    user = User(userId="USER001", username="testuser", password="password123")

    assert user.userId == "USER001"
    assert user.username == "testuser"
    assert user.password == "password123"

def test_graph_transactions_can_be_created():
    graph_transaction = GraphTransactions(graphId="GRAPH001", transactionId="TXN001")

    assert graph_transaction.graphId == "GRAPH001"
    assert graph_transaction.transactionId == "TXN001"

@pytest.fixture(name="session")
def session_fixture():
    """Creates a fresh in-memory database for each test.
    This means every test starts clean.
    Nothing is saved to your real database."""
    #    engine = create_engine("postgresql+psycopg://qdetect_dev:devQdetect@127.0.0.1:5432/qdetect_test", echo=True) # Echo = true for debugging

    engine = create_engine("postgresql+psycopg://qdetect_dev:devQdetect@127.0.0.1:5432/qdetect_pytest", echo=False)

    ## Only safe for testing, will drop all tables and recreate them for each test
    SQLModel.metadata.drop_all(engine)

    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        yield session

def test_account_can_be_saved_to_database(session):
    account = Account(accountId="ACC001")
    session.add(account)
    session.commit()
    saved_account = session.get(Account, "ACC001")
    assert saved_account is not None
    assert saved_account.accountId == "ACC001"

def test_transaction_can_be_saved_to_database(session):
    account = Account(accountId="ACC001")
    session.add(account)
    session.commit()
    account = Account(accountId="ACC002")
    session.add(account)
    session.commit()
    transaction = Transaction(transactionId="TXN002", senderAcc="ACC001", receiverAcc="ACC002", transactionType="transfer", amount=100.023)
    session.add(transaction)
    session.commit()
    saved_transaction = session.get(Transaction, "TXN002")
    assert saved_transaction is not None
    assert saved_transaction.transactionId == "TXN002"
    assert saved_transaction.senderAcc == "ACC001"
    assert saved_transaction.receiverAcc == "ACC002"
    assert saved_transaction.transactionType == "transfer"
    assert saved_transaction.amount == 100.023

def test_account_can_be_updated_in_database(session):
    account = Account(accountId="ACC001")
    session.add(account)
    session.commit()

    # Update the account
    account.accountId = "ACC007"
    session.add(account)
    session.commit()

    updated_account = session.get(Account, "ACC007")
    assert updated_account is not None
    assert updated_account.accountId == "ACC007"

def test_account_can_be_deleted_from_database(session):
    account = Account(accountId="ACC001")
    session.add(account)
    session.commit()

    # Delete the account
    session.delete(account)
    session.commit()

    deleted_account = session.get(Account, "ACC001")
    assert deleted_account is None