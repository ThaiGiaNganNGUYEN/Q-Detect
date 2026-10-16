"""
Cluster/graph router -- HTTP endpoints only. All actual computation lives
in services/cluster_service.py; this file's only job is translating
between HTTP (query params, status codes, response models) and plain
Python function calls.
"""

from fastapi import APIRouter, HTTPException

from models import ClusterListResponse, Cluster, GraphResponse
from services import cluster_service

router = APIRouter(prefix="/api", tags=["clusters"])


@router.get("/graph", response_model=GraphResponse)
def get_full_graph():
    """
    Return the ENTIRE laundering graph as flat {nodes, edges}
    """
    return cluster_service.compute_full_graph()


@router.get("/graph/cluster/{cluster_id}", response_model=GraphResponse)
def get_cluster_graph(cluster_id: int):
    """
    Return just ONE cluster as flat {nodes, edges}
    """
    result = cluster_service.compute_graph_for_cluster(cluster_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Cluster {cluster_id} not found")
    return result


@router.get("/clusters", response_model=ClusterListResponse)
def list_clusters(min_size: int = 2, limit: int = 20):
    """
    Return the top laundering clusters, largest first.
    """
    return cluster_service.list_clusters(min_size=min_size, limit=limit)


@router.get("/clusters/{cluster_id}", response_model=Cluster)
def get_cluster(cluster_id: int):
    """Return one specific cluster by its id."""
    cluster = cluster_service.get_cluster_by_id(cluster_id)
    if cluster is None:
        raise HTTPException(status_code=404, detail=f"Cluster {cluster_id} not found")
    return cluster


@router.get("/accounts/{account_id}/cluster", response_model=Cluster)
def get_cluster_for_account(account_id: str):
    """Given an account id (e.g. '1004287C8_070'), find its cluster."""
    cluster = cluster_service.get_cluster_for_account(account_id)
    if cluster is None:
        raise HTTPException(status_code=404, detail=f"Account {account_id} not found in any cluster")
    return cluster
