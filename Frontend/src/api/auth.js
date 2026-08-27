import { apiRequest, clearSession, setStoredUser, setToken } from "./client";

function storeSession(data) {
	if (data?.token) {
		setToken(data.token);
	}
	const user = data?.user ?? null;
	if (user) {
		setStoredUser(user);
	}
	return data;
}

/** @param {{ email: string, password: string }} payload */
export async function login(payload) {
	const data = await apiRequest("/auth/login", {
		method: "POST",
		body: { email: payload.email, password: payload.password },
		auth: false,
	});
	return storeSession(data);
}

/** @param {{ email: string, username: string, password: string }} payload */
export async function register(payload) {
	const data = await apiRequest("/auth/register", {
		method: "POST",
		body: {
			email: payload.email,
			username: payload.username,
			password: payload.password,
		},
		auth: false,
	});
	return storeSession(data);
}

export async function getMe() {
	const data = await apiRequest("/auth/me");
	const user = data?.user ?? data;
	if (user) {
		setStoredUser(user);
	}
	return { user };
}

/** @param {{ username: string, email: string, displayName: string }} payload */
export async function updateAccount(payload) {
	const data = await apiRequest("/auth/me", {
		method: "PATCH",
		body: {
			username: payload.username,
			email: payload.email,
			displayName: payload.displayName,
		},
	});
	const user = data?.user ?? data;
	if (user) {
		setStoredUser(user);
	}
	return { user };
}

/** @param {{ currentPassword: string, newPassword: string }} payload */
export async function changePassword(payload) {
	return apiRequest("/auth/change-password", {
		method: "POST",
		body: {
			currentPassword: payload.currentPassword,
			newPassword: payload.newPassword,
		},
	});
}

export function logout() {
	clearSession();
}
