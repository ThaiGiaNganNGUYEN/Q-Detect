import { getAccessToken } from "../auth/getAccessToken";

const TOKEN_KEY = "qdetect-token";
const USER_KEY = "qdetect-user";

export class ApiError extends Error {
	/**
	 * @param {string} message
	 * @param {{ status?: number, details?: unknown }} [options]
	 */
	constructor(message, { status = 0, details = null } = {}) {
		super(message);
		this.name = "ApiError";
		this.status = status;
		this.details = details;
	}
}

export function isApiConfigured() {
	const base = import.meta.env.VITE_API_BASE_URL;
	return typeof base === "string" && base.trim().length > 0;
}

export function getApiBaseUrl() {
	return String(import.meta.env.VITE_API_BASE_URL ?? "").trim().replace(/\/$/, "");
}

export function getToken() {
	return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
	if (token) {
		localStorage.setItem(TOKEN_KEY, token);
	} else {
		localStorage.removeItem(TOKEN_KEY);
	}
}

export function getStoredUser() {
	try {
		const raw = localStorage.getItem(USER_KEY);
		return raw ? JSON.parse(raw) : null;
	} catch {
		return null;
	}
}

export function setStoredUser(user) {
	if (user) {
		localStorage.setItem(USER_KEY, JSON.stringify(user));
	} else {
		localStorage.removeItem(USER_KEY);
	}
}

export function clearSession() {
	localStorage.removeItem(TOKEN_KEY);
	localStorage.removeItem(USER_KEY);
}

export function getErrorMessage(error) {
	if (error instanceof ApiError) {
		return error.message;
	}
	if (error instanceof Error && error.message) {
		return error.message;
	}
	return "Something went wrong.";
}

/**
 * @param {string} path
 * @param {{ method?: string, body?: unknown, auth?: boolean }} [options]
 */
export async function apiRequest(path, { method = "GET", body, auth = true } = {}) {
	if (!isApiConfigured()) {
		throw new ApiError("API is not configured. Set VITE_API_BASE_URL.", { status: 0 });
	}

	const headers = { Accept: "application/json" };
	if (body !== undefined) {
		headers["Content-Type"] = "application/json";
	}
	if (auth) {
		const token = (await getAccessToken()) ?? getToken();
		if (token) {
			headers.Authorization = `Bearer ${token}`;
		}
	}

	const response = await fetch(`${getApiBaseUrl()}${path}`, {
		method,
		headers,
		body: body !== undefined ? JSON.stringify(body) : undefined,
	});

	const text = await response.text();
	let data = null;
	if (text) {
		try {
			data = JSON.parse(text);
		} catch {
			data = text;
		}
	}

	if (!response.ok) {
		const message =
			(data && typeof data === "object" && (data.message || data.detail || data.error)) ||
			response.statusText ||
			"Request failed";
		throw new ApiError(String(message), { status: response.status, details: data });
	}

	return data;
}
