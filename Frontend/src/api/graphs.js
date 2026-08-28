import { apiRequest } from "./client";

/**
 * @param {string} graphId
 * @param {"Pending" | "Safe" | "Fraud"} status
 */
export async function updateGraphStatus(graphId, status) {
	return apiRequest(`/graphs/${encodeURIComponent(graphId)}/status`, {
		method: "PATCH",
		body: { status },
	});
}
