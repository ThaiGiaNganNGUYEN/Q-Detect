import pytest
from sqlmodel import SQLModel, Session, create_engine, select

from Classes.account import Account
from Classes.transaction import Transaction
from Classes.graph import Graph
from Classes.graph_transactions import GraphTransactions
from Classes.user import User

@pytest.fixture(name="session")
def session_fixture():
    """Creates a fresh in-memory database for each test.
    This means every test starts clean.
    Nothing is saved to your real database."""
    engine = create_engine("sqlite://qdetecttestdb", echo=False)
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        yield session

def test_account_can_be_created():
    account = Account(accountId="ACC001")

    assert account.accountId == "ACC001"

def test_transaction_can_be_created():
    transaction = Transaction(transactionId="TXN001", senderAcc="ACC001", receiverAcc="ACC002", amount=100)

    assert transaction.transactionId == "TXN001"
    assert transaction.senderAcc == "ACC001"
    assert transaction.receiverAcc == "ACC002"
    assert transaction.amount == 100

def test_graph_can_be_created():
    graph = Graph(graphId="GRAPH001", checked=True, overallScore=0.85, marker="ACC001")

    assert graph.graphId == "GRAPH001"
    assert graph.checked is True
    assert graph.overallScore == 0.85
    assert graph.marker == "ACC001"
test_account_can_be_created()
test_transaction_can_be_created()
test_graph_can_be_created()