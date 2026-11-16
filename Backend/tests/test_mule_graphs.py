"""Stored graphs: stable numbers, saved decisions, and what new batches do to them.

Runs on a throwaway SQLite file by default. Set TEST_CACHE_DATABASE_URL to a
disposable Postgres database to also cover clear_cache, which uses Postgres
COPY/TRUNCATE. Every table in that database is dropped between tests, so never
point it at real data.
"""

import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path

# Must be set before db.py is imported. load_dotenv() doesn't override these,
# so the tests can't reach the real databases configured in .env.
_DEFAULT_URL = f"sqlite:///{Path(tempfile.mkdtemp()) / 'graphs.db'}"
TEST_URL = os.environ.get("TEST_CACHE_DATABASE_URL", _DEFAULT_URL)
os.environ["CACHE_DATABASE_URL"] = TEST_URL
os.environ["STAGING_DATABASE_URL"] = TEST_URL

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, select

from db import get_cache_engine
from models import Account, MuleGraph, MuleGraphAccount, MuleGraphTransaction, Transaction
from routers.cluster_router import router
from services import cluster_service
from services.graph_store import assign_new_transactions

NOW = datetime(2026, 1, 1, tzinfo=timezone.utc)
TABLES = [
    MuleGraphAccount.__table__,
    MuleGraphTransaction.__table__,
    MuleGraph.__table__,
    Transaction.__table__,
    Account.__table__,
]

client = TestClient(FastAPI())
client.app.include_router(router)


@pytest.fixture(autouse=True)
def clean_database():
    engine = get_cache_engine()
    assert engine.url.database and "qdetect_cache" not in engine.url.database
    SQLModel.metadata.drop_all(engine, tables=TABLES)
    SQLModel.metadata.create_all(engine, tables=TABLES)
    yield
    engine.dispose()


def add_transactions(*edges, flagged=True, score=0.5):
    """Cache transactions as (id, sender, receiver), as the poller would."""
    with Session(get_cache_engine()) as session:
        for tx_id, sender, receiver in edges:
            for account_id in (sender, receiver):
                if session.get(Account, account_id) is None:
                    account = Account.from_id(account_id)
                    account.firstSeen = account.lastSeen = NOW
                    session.add(account)
                    session.flush()
            session.add(Transaction(
                id=tx_id, senderAcc=sender, receiverAcc=receiver,
                amountPaid=100.0, amountReceived=100.0,
                currencyPaid="USD", currencyReceived="USD", paymentFormat="ACH",
                timestamp=NOW, hoursFromStart=1.0,
                isCrossBank=False, isCrossCurrency=False, isSelfTransfer=sender == receiver,
                isLaundering=False, fraudRiskScore=score, isFlagged=flagged, scoredAt=NOW,
            ))
        session.commit()


def graph_of(account_id):
    with Session(get_cache_engine()) as session:
        return session.get(MuleGraphAccount, account_id).graphId


def clusters():
    return {c["clusterId"]: c for c in client.get("/api/clusters?min_size=1").json()["clusters"]}


def test_first_run_numbers_graphs_from_one_with_the_largest_first():
    add_transactions((1, "a_1", "b_1"), (2, "c_1", "d_1"), (3, "d_1", "e_1"))
    summary = assign_new_transactions()

    assert (summary.created, summary.transactions) == (2, 3)
    assert graph_of("c_1") == 1
    assert graph_of("a_1") == 2
    listed = clusters()
    assert list(listed) == [1, 2]
    assert (listed[1]["numAccounts"], listed[1]["numTransactions"]) == (3, 2)
    assert listed[1]["status"] == "Pending"


def test_unflagged_transactions_are_ignored():
    add_transactions((1, "a_1", "b_1"), flagged=False)
    assert assign_new_transactions().transactions == 0
    assert clusters() == {}


def test_running_again_with_no_new_data_changes_nothing():
    add_transactions((1, "a_1", "b_1"))
    assign_new_transactions()
    assert assign_new_transactions().transactions == 0
    assert list(clusters()) == [1]


def test_a_new_larger_network_does_not_renumber_existing_graphs():
    add_transactions((1, "a_1", "b_1"))
    assign_new_transactions()
    client.patch("/api/clusters/1/status", json={"status": "Fraud"})

    add_transactions((2, "c_1", "d_1"), (3, "d_1", "e_1"), (4, "e_1", "f_1"))
    assign_new_transactions()

    listed = clusters()
    assert graph_of("a_1") == 1
    assert graph_of("c_1") == 2
    assert listed[1]["status"] == "Fraud"
    assert listed[2]["status"] == "Pending"
    # Sorted by size, so the higher number comes first here.
    assert list(listed) == [2, 1]


def test_growing_a_reviewed_graph_keeps_the_decision_and_flags_new_activity():
    add_transactions((1, "a_1", "b_1"), score=0.2)
    assign_new_transactions()
    client.patch("/api/clusters/1/status", json={"status": "Safe"})

    add_transactions((2, "b_1", "c_1"), score=0.8)
    summary = assign_new_transactions()

    graph = clusters()[1]
    assert summary.grown == 1
    assert graph["status"] == "Safe"
    assert graph["hasNewActivity"] is True
    assert (graph["numAccounts"], graph["numTransactions"], graph["riskScore"]) == (3, 2, 50)

    response = client.patch("/api/clusters/1/status", json={"status": "Safe"})
    assert response.json()["hasNewActivity"] is False
    assert clusters()[1]["hasNewActivity"] is False


def test_growing_a_pending_graph_does_not_flag_new_activity():
    add_transactions((1, "a_1", "b_1"))
    assign_new_transactions()
    add_transactions((2, "b_1", "c_1"))
    assign_new_transactions()
    assert clusters()[1]["hasNewActivity"] is False


@pytest.mark.parametrize(
    ("first", "second", "merged"),
    [
        ("Safe", "Fraud", "Fraud"),
        ("Fraud", "Pending", "Fraud"),
        ("Safe", "Safe", "Safe"),
        ("Safe", "Pending", "Pending"),
    ],
)
def test_merged_status(first, second, merged):
    add_transactions((1, "a_1", "b_1"), (2, "c_1", "d_1"))
    assign_new_transactions()
    client.patch("/api/clusters/1/status", json={"status": first})
    client.patch("/api/clusters/2/status", json={"status": second})

    add_transactions((3, "b_1", "c_1"))
    assign_new_transactions()

    assert clusters()[1]["status"] == merged


def test_merge_keeps_the_oldest_number_and_every_note():
    add_transactions((1, "a_1", "b_1"), (2, "c_1", "d_1"))
    assign_new_transactions()
    client.post("/api/clusters/1/notes", json={"note": "first note"})
    client.post("/api/clusters/2/notes", json={"note": "second note"})

    add_transactions((3, "b_1", "c_1"))
    assert assign_new_transactions().merged == 1

    listed = clusters()
    assert list(listed) == [1]
    assert (listed[1]["numAccounts"], listed[1]["numTransactions"]) == (4, 3)
    note = client.get("/api/clusters/1/notes").json()["note"]
    assert note == "first note\n\n--- From Graph 2 ---\nsecond note"

    # The merged number is gone, and it's never reused.
    assert client.get("/api/clusters/2").status_code == 404
    assert client.patch("/api/clusters/2/status", json={"status": "Fraud"}).status_code == 404
    add_transactions((4, "x_1", "y_1"))
    assign_new_transactions()
    assert graph_of("x_1") == 3


def test_two_new_edges_in_one_batch_can_merge_into_one_graph():
    add_transactions((1, "a_1", "b_1"), (2, "c_1", "d_1"))
    assign_new_transactions()
    add_transactions((3, "b_1", "e_1"), (4, "e_1", "c_1"), (5, "x_1", "y_1"))
    summary = assign_new_transactions()

    assert (summary.merged, summary.created) == (1, 1)
    assert list(clusters()) == [1, 3]
    assert graph_of("e_1") == graph_of("d_1") == 1


def test_status_and_note_survive_a_fresh_read():
    add_transactions((1, "a_1", "b_1"))
    assign_new_transactions()

    assert client.get("/api/clusters/1/notes").status_code == 404
    assert client.post("/api/clusters/1/notes", json={"note": "checked"}).status_code == 200
    assert client.patch("/api/clusters/1/status", json={"status": "Fraud"}).status_code == 200

    assert client.get("/api/clusters/1/notes").json()["note"] == "checked"
    assert client.get("/api/clusters/1").json()["status"] == "Fraud"
    assert client.get("/api/accounts/a_1/cluster").json()["clusterId"] == 1


def test_invalid_status_and_unknown_graph_are_rejected():
    add_transactions((1, "a_1", "b_1"))
    assign_new_transactions()
    assert client.patch("/api/clusters/1/status", json={"status": "Maybe"}).status_code == 422
    assert client.patch("/api/clusters/99/status", json={"status": "Safe"}).status_code == 404
    assert client.post("/api/clusters/99/notes", json={"note": "x"}).status_code == 404


def test_flat_graph_endpoints_read_stored_membership():
    add_transactions((1, "a_1", "b_1"), (2, "b_1", "c_1"), (3, "x_1", "y_1"))
    assign_new_transactions()

    one = cluster_service.compute_graph_for_cluster(1)
    assert (one.numNodes, one.numEdges) == (3, 2)
    everything = cluster_service.compute_full_graph()
    assert (everything.numNodes, everything.numEdges) == (5, 3)
    assert cluster_service.compute_graph_for_cluster(99) is None


@pytest.mark.skipif(not TEST_URL.startswith("postgresql"), reason="clear_cache needs Postgres")
def test_clear_cache_removes_graphs_and_restarts_numbering():
    from services.cache_store import clear_cache

    add_transactions((1, "a_1", "b_1"))
    assign_new_transactions()

    assert clear_cache() == (2, 1, 1)
    assert clusters() == {}

    add_transactions((2, "c_1", "d_1"))
    assign_new_transactions()
    assert graph_of("c_1") == 1


def test_all_flagged_transactions_end_up_with_exactly_one_graph():
    add_transactions(*[(i, f"a{i}_1", f"a{i + 1}_1") for i in range(1, 6)])
    assign_new_transactions()
    with Session(get_cache_engine()) as session:
        memberships = session.exec(select(MuleGraphTransaction)).all()
    assert sorted(m.transactionId for m in memberships) == [1, 2, 3, 4, 5]
    assert {m.graphId for m in memberships} == {1}
