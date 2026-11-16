import { useState } from "react";
import { AuthShell } from "../components/Brand";
import { login } from "../api/auth";
import { getErrorMessage } from "../api/client";

export default function LogIn() {
	const [error, setError] = useState("");
	const [pending, setPending] = useState(false);

	const onSubmit = async (event) => {
		event.preventDefault();
		setError("");

		const form = new FormData(event.currentTarget);
		const email = String(form.get("email") ?? "").trim();
		const password = String(form.get("password") ?? "");

		if (!email || !password) {
			setError("Enter your email and password.");
			return;
		}

		setPending(true);
		try {
			await login({ email, password });
			window.location.hash = "#dashboard";
		} catch (err) {
			setError(getErrorMessage(err));
		} finally {
			setPending(false);
		}
	};

	return (
		<AuthShell title="Welcome back" subtitle="Log in to your Q-Detect workspace.">
			<form className="flex flex-col gap-4" onSubmit={onSubmit}>
				<label className="field-label" htmlFor="email">
					Email address
					<input id="email" name="email" type="email" placeholder="name@company.com" className="field-input" />
				</label>

				<label className="field-label" htmlFor="password">
					Password
					<input id="password" name="password" type="password" placeholder="Password" className="field-input" />
				</label>

				<div className="flex justify-end">
					<a href="#forgot-password" className="text-sm font-medium text-brand-700 hover:underline">
						Forgot password?
					</a>
				</div>

				{error ? (
					<p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
						{error}
					</p>
				) : null}

				<button type="submit" disabled={pending} className="btn-primary h-11 w-full">
					{pending ? "Logging in…" : "Log In"}
				</button>

				<p className="text-center text-sm text-zinc-500">
					Don’t have an account?{" "}
					<a href="#register" className="font-semibold text-brand-700 hover:underline">
						Register here
					</a>
				</p>
			</form>
		</AuthShell>
	);
}
