import { ApiError, apiRequest } from "./client";

/**
 * Saved investigator note for one cluster/graph.
 * Backend: GET /api/clusters/:clusterId/notes
 * 404 means no note has been stored yet.
 *
 * @param {string|number} clusterId
 * @returns {Promise<import("./contracts").GraphNote | null>}
 */
export async function getGraphNote(clusterId) {
	try {
		return await apiRequest(`/api/clusters/${encodeURIComponent(clusterId)}/notes`);
	} catch (error) {
		if (error instanceof ApiError && error.status === 404) {
			return null;
		}
		throw error;
	}
}

/**
 * Store an investigator note for one cluster/graph.
 * Backend: POST /api/clusters/:clusterId/notes
 *
 * @param {string|number} clusterId
 * @param {string} note
 * @returns {Promise<import("./contracts").GraphNote>}
 */
export async function submitGraphNote(clusterId, note) {
	return apiRequest(`/api/clusters/${encodeURIComponent(clusterId)}/notes`, {
		method: "POST",
		body: { note },
	});
}
