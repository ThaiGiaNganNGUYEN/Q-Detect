import { useState } from "react";
import { AuthShell } from "../components/Brand";
import { register } from "../api/auth";
import { getErrorMessage, isApiConfigured } from "../api/client";

export default function Register() {
	const [error, setError] = useState("");
	const [pending, setPending] = useState(false);

	const onSubmit = async (event) => {
		event.preventDefault();
		setError("");

		const form = new FormData(event.currentTarget);
		const email = String(form.get("email") ?? "").trim();
		const username = String(form.get("username") ?? "").trim();
		const password = String(form.get("password") ?? "");
		const retypePassword = String(form.get("retype-password") ?? "");

		if (password !== retypePassword) {
			setError("Passwords do not match.");
			return;
		}

		if (!isApiConfigured()) {
			return;
		}

		if (!email || !username || !password) {
			setError("Enter an email, username, and password.");
			return;
		}

		setPending(true);
		try {
			const session = await register({ email, username, password });
			window.location.hash = session?.token ? "#dashboard" : "#login";
		} catch (err) {
			setError(getErrorMessage(err));
		} finally {
			setPending(false);
		}
	};

	return (
		<AuthShell title="Create your account" subtitle="Set up access to the Q-Detect investigation workspace.">
			<form className="flex flex-col gap-4" onSubmit={onSubmit}>
				<label className="field-label" htmlFor="email">
					Email address
					<input id="email" name="email" type="email" placeholder="name@company.com" className="field-input" />
				</label>

				<label className="field-label" htmlFor="username">
					Username
					<input id="username" name="username" type="text" placeholder="Username" className="field-input" />
				</label>

				<label className="field-label" htmlFor="password">
					Password
					<input id="password" name="password" type="password" placeholder="Password" className="field-input" />
				</label>

				<label className="field-label" htmlFor="retype-password">
					Retype password
					<input
						id="retype-password"
						name="retype-password"
						type="password"
						placeholder="Retype password"
						className="field-input"
					/>
				</label>

				{error ? (
					<p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
						{error}
					</p>
				) : null}

				<button type="submit" disabled={pending} className="btn-primary h-11 w-full">
					{pending ? "Registering…" : "Register"}
				</button>

				<p className="text-center text-sm text-zinc-500">
					Already have an account?{" "}
					<a href="#login" className="font-semibold text-brand-700 hover:underline">
						Log in here
					</a>
				</p>
			</form>
		</AuthShell>
	);
}
