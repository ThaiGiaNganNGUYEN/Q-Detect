import { useState } from "react";
import qDetectLogo from "../assets/qdetect-logo.png";
import { login } from "../api/auth";
import { getErrorMessage, isApiConfigured } from "../api/client";

export default function LogIn() {
	const [error, setError] = useState("");
	const [pending, setPending] = useState(false);

	const onSubmit = async (event) => {
		event.preventDefault();
		setError("");

		// TEMP: login has no backend yet -- VITE_API_BASE_URL is only set so
		// the graph/cluster API (api/clusters.js) is reachable, and that
		// backend has no auth endpoints mounted. Bypassing straight to the
		// dashboard for now instead of running the real login call below.
		window.location.hash = "#dashboard";
		return;

		/* eslint-disable no-unreachable */
		const form = new FormData(event.currentTarget);
		const email = String(form.get("email") ?? "").trim();
		const password = String(form.get("password") ?? "");

		if (!isApiConfigured()) {
			window.location.hash = "#dashboard";
			return;
		}

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
		/* eslint-enable no-unreachable */
	};

	return (
		<main className="min-h-screen bg-white px-4 py-10 text-center text-[#262626]">
			<div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-[420px] flex-col items-center justify-center gap-8">
				<div className="w-full">
					<img
						alt="Q-Detect Logo"
						src={qDetectLogo}
						className="mx-auto w-36 h-auto"
					/>
				</div>

				<h1
					className="whitespace-nowrap text-[64px] leading-none text-black"
					style={{ fontFamily: '"Inter", sans-serif' }}
				>
					Q-Detect
				</h1>

				<section className="w-full rounded-[12px] border border-[#E3E3E3] bg-white px-3 py-3">
					<form className="flex flex-col gap-3" onSubmit={onSubmit}>
						<label className="sr-only" htmlFor="email">
							Email Address
						</label>
						<input
							id="email"
							name="email"
							type="email"
							placeholder="Email Address"
							className="h-7 w-full rounded-[5px] border border-[#E2E2E2] px-3 text-[11px] text-[#222] outline-none placeholder:text-[#B8B8B8] focus:border-[#B7B7B7]"
						/>

						<label className="sr-only" htmlFor="password">
							Password
						</label>
						<input
							id="password"
							name="password"
							type="password"
							placeholder="Password"
							className="h-7 w-full rounded-[5px] border border-[#E2E2E2] px-3 text-[11px] text-[#222] outline-none placeholder:text-[#B8B8B8] focus:border-[#B7B7B7]"
						/>

						{error ? (
							<p className="text-left text-[11px] text-red-600" role="alert">
								{error}
							</p>
						) : null}

						<button
							type="submit"
							disabled={pending}
							className="h-6 w-full rounded-[4px] bg-[#2F2F2F] text-[11px] font-normal text-white transition-colors hover:bg-[#1f1f1f] disabled:opacity-60"
						>
							{pending ? "Logging in…" : "Log In"}
						</button>

						<a
							href="#forgot-password"
							className="text-[11px] leading-none text-[#333333] underline underline-offset-2"
						>
							Forgot password?
						</a>

						<a
							href="#register"
							className="text-[11px] leading-none text-[#333333] underline underline-offset-2"
						>
							Don’t have an account? Register Here
						</a>
					</form>
				</section>
			</div>
		</main>
	);
}
