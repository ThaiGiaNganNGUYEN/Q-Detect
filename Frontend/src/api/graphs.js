import { apiRequest } from "./client";

/**
 * @param {string} graphId
 * @param {"Pending" | "Safe" | "Fraud"} status
 * @returns {Promise<import("./contracts").UpdateGraphStatusResponse>}
 */
export async function updateGraphStatus(graphId, status) {
	return apiRequest(`/api/clusters/${encodeURIComponent(graphId)}/status`, {
		method: "PATCH",
		body: { status },
	});
}
