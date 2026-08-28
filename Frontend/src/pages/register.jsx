import { useState } from "react";
import qDetectLogo from "../assets/qdetect-logo.png";
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
		<main className="min-h-screen bg-white px-4 py-10 text-center text-[#262626]">
			<div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-[420px] flex-col items-center justify-center gap-8">
				<div className="w-full">
					<img
						alt="Q-Detect logo"
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

						<label className="sr-only" htmlFor="username">
							Username
						</label>
						<input
							id="username"
							name="username"
							type="text"
							placeholder="Username"
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

						<label className="sr-only" htmlFor="retype-password">
							Retype Password
						</label>
						<input
							id="retype-password"
							name="retype-password"
							type="password"
							placeholder="Retype Password"
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
							{pending ? "Registering…" : "Register"}
						</button>

						<a
							href="#login"
							className="text-[11px] leading-none text-[#333333] underline underline-offset-2"
						>
							Already have an account? Login Here
						</a>
					</form>
				</section>
			</div>
		</main>
	);
}
