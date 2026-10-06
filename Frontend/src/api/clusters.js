import { apiRequest } from "./client";

// Whole laundering graph as flat {nodes, edges} -- GraphNode/GraphEdge,
// not the richer TransactionRead shape the cluster endpoints return.
/** @returns {Promise<import("./contracts").GraphResponse>} */
export async function getFullGraph() {
	return apiRequest("/api/graph");
}

// Same flat shape as getFullGraph, scoped to one cluster's subgraph.
/** @param {number|string} clusterId @returns {Promise<import("./contracts").GraphResponse>} */
export async function getGraphForCluster(clusterId) {
	return apiRequest(`/api/graph/cluster/${encodeURIComponent(clusterId)}`);
}

// Top laundering clusters, largest first -- min_size/limit map straight
// onto cluster_router.py's query params of the same name.
/**
 * @param {{ minSize?: number, limit?: number }} [options]
 * @returns {Promise<import("./contracts").ClusterListResponse>}
 */
export async function getClusters({ minSize = 2, limit = 20 } = {}) {
	const params = new URLSearchParams({ min_size: String(minSize), limit: String(limit) });
	return apiRequest(`/api/clusters?${params.toString()}`);
}

/** @param {number|string} clusterId @returns {Promise<import("./contracts").Cluster>} */
export async function getCluster(clusterId) {
	return apiRequest(`/api/clusters/${encodeURIComponent(clusterId)}`);
}

// Reverse lookup: given a real account string ("070_1004287C8"), find
// the cluster/mule-network it belongs to.
/** @param {string} accountId @returns {Promise<import("./contracts").Cluster>} */
export async function getClusterForAccount(accountId) {
	return apiRequest(`/api/accounts/${encodeURIComponent(accountId)}/cluster`);
}
