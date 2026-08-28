import { useEffect, useState } from "react";
import { changePassword, logout, updateAccount } from "../api/auth";
import { getErrorMessage, getStoredUser, isApiConfigured } from "../api/client";

const SECTIONS = [
	{ id: "account", label: "Account" },
	{ id: "terms", label: "Terms and Conditions" },
	{ id: "privacy", label: "Privacy Policy" },
];

function AccountPanel() {
	const storedUser = getStoredUser();
	const [accountMessage, setAccountMessage] = useState("");
	const [accountError, setAccountError] = useState("");
	const [accountPending, setAccountPending] = useState(false);
	const [passwordMessage, setPasswordMessage] = useState("");
	const [passwordError, setPasswordError] = useState("");
	const [passwordPending, setPasswordPending] = useState(false);

	const onSaveAccount = async (event) => {
		event.preventDefault();
		setAccountMessage("");
		setAccountError("");

		const form = new FormData(event.currentTarget);
		const username = String(form.get("username") ?? "").trim();
		const email = String(form.get("email") ?? "").trim();
		const displayName = String(form.get("displayName") ?? "").trim();

		if (!isApiConfigured()) {
			return;
		}

		setAccountPending(true);
		try {
			await updateAccount({ username, email, displayName });
			setAccountMessage("Account details updated.");
		} catch (err) {
			setAccountError(getErrorMessage(err));
		} finally {
			setAccountPending(false);
		}
	};

	const onChangePassword = async (event) => {
		event.preventDefault();
		setPasswordMessage("");
		setPasswordError("");

		const form = new FormData(event.currentTarget);
		const currentPassword = String(form.get("currentPassword") ?? "");
		const newPassword = String(form.get("newPassword") ?? "");
		const confirmPassword = String(form.get("confirmPassword") ?? "");

		if (newPassword !== confirmPassword) {
			setPasswordError("New passwords do not match.");
			return;
		}

		if (!newPassword) {
			setPasswordError("Enter a new password.");
			return;
		}

		if (!isApiConfigured()) {
			return;
		}

		setPasswordPending(true);
		const formEl = event.currentTarget;
		try {
			await changePassword({ currentPassword, newPassword });
			setPasswordMessage("Password updated.");
			formEl.reset();
		} catch (err) {
			setPasswordError(getErrorMessage(err));
		} finally {
			setPasswordPending(false);
		}
	};

	return (
		<div className="mx-auto w-full max-w-xl space-y-8">
			<section>
				<h2 className="mb-1 text-xl font-semibold">Account details</h2>
				<p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
					Update the profile information associated with your Q-Detect account.
				</p>
				<form
					className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900"
					onSubmit={onSaveAccount}
				>
					<label className="block text-left text-xs font-medium text-zinc-600 dark:text-zinc-300">
						Username
						<input
							type="text"
							name="username"
							defaultValue={storedUser?.username ?? "user"}
							className="mt-1 h-9 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-950"
						/>
					</label>
					<label className="block text-left text-xs font-medium text-zinc-600 dark:text-zinc-300">
						Email address
						<input
							type="email"
							name="email"
							defaultValue={storedUser?.email ?? "abc123@example.com"}
							className="mt-1 h-9 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-950"
						/>
					</label>
					<label className="block text-left text-xs font-medium text-zinc-600 dark:text-zinc-300">
						Display name
						<input
							type="text"
							name="displayName"
							defaultValue={storedUser?.displayName ?? "Test User"}
							className="mt-1 h-9 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-950"
						/>
					</label>
					{accountError ? (
						<p className="text-sm text-red-600 dark:text-red-400" role="alert">
							{accountError}
						</p>
					) : null}
					{accountMessage ? (
						<p className="text-sm text-emerald-600 dark:text-emerald-400">{accountMessage}</p>
					) : null}
					<button
						type="submit"
						disabled={accountPending}
						className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
					>
						{accountPending ? "Saving…" : "Save changes"}
					</button>
				</form>
			</section>

			<section>
				<h2 className="mb-1 text-xl font-semibold">Change password</h2>
				<p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
					Choose a strong password to keep your fraud investigation workspace secure.
				</p>
				<form
					className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900"
					onSubmit={onChangePassword}
				>
					<label className="block text-left text-xs font-medium text-zinc-600 dark:text-zinc-300">
						Current password
						<input
							type="password"
							name="currentPassword"
							defaultValue="abc123"
							className="mt-1 h-9 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-950"
						/>
					</label>
					<label className="block text-left text-xs font-medium text-zinc-600 dark:text-zinc-300">
						New password
						<input
							type="password"
							name="newPassword"
							className="mt-1 h-9 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-950"
						/>
					</label>
					<label className="block text-left text-xs font-medium text-zinc-600 dark:text-zinc-300">
						Confirm new password
						<input
							type="password"
							name="confirmPassword"
							className="mt-1 h-9 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-950"
						/>
					</label>
					{passwordError ? (
						<p className="text-sm text-red-600 dark:text-red-400" role="alert">
							{passwordError}
						</p>
					) : null}
					{passwordMessage ? (
						<p className="text-sm text-emerald-600 dark:text-emerald-400">{passwordMessage}</p>
					) : null}
					<button
						type="submit"
						disabled={passwordPending}
						className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
					>
						{passwordPending ? "Updating…" : "Update password"}
					</button>
				</form>
			</section>

			<section>
				<h2 className="mb-1 text-xl font-semibold">Log out</h2>
				<p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
					End your current Q-Detect session on this device.
				</p>
				<a
					href="#login"
					className="inline-flex rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40"
					onClick={() => logout()}
				>
					Log out
				</a>
			</section>
		</div>
	);
}

function TermsPanel() {
	return (
		<article className="mx-auto w-full max-w-3xl space-y-4 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
			<h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">Terms and Conditions</h2>
			<p className="text-zinc-500 dark:text-zinc-400">Last updated: August 19, 2026</p>
			<p>
				Welcome to Q-Detect, a hybrid quantum-classical fraud detection platform that uses Quantum
				Graph Neural Networks (QGNN) to identify high-risk transactional clusters. By accessing or
				using Q-Detect, you agree to these Terms and Conditions.
			</p>
			<h3 className="pt-2 text-base font-semibold text-zinc-900 dark:text-zinc-100">1. Permitted use</h3>
			<p>
				You may use Q-Detect only for lawful fraud monitoring, investigation, and risk review within
				your organization. You must not attempt to reverse engineer model outputs for unauthorized
				purposes, disrupt service availability, or access another user’s cases without permission.
			</p>
			<h3 className="pt-2 text-base font-semibold text-zinc-900 dark:text-zinc-100">2. Risk scores and decisions</h3>
			<p>
				Risk percentages, cluster labels (such as Fraud, Pending, Safe, or Flagged), and related
				insights are decision-support outputs. They do not automatically freeze funds or initiate
				legal action. Final account actions remain the responsibility of authorized human reviewers.
			</p>
			<h3 className="pt-2 text-base font-semibold text-zinc-900 dark:text-zinc-100">3. Data accuracy</h3>
			<p>
				You are responsible for ensuring transaction graphs and supporting records submitted to
				Q-Detect are accurate and complete. Incomplete or corrupted graph data may reduce detection
				quality.
			</p>
			<h3 className="pt-2 text-base font-semibold text-zinc-900 dark:text-zinc-100">4. Confidentiality</h3>
			<p>
				Investigation workspaces, flagged clusters, and reviewer notes are confidential. Do not share
				exports or screenshots outside approved channels.
			</p>
			<h3 className="pt-2 text-base font-semibold text-zinc-900 dark:text-zinc-100">5. Service changes</h3>
			<p>
				Q-Detect may update models, dashboards, and workflows over time. Material changes to these
				terms will be reflected on this page. Continued use after an update constitutes acceptance.
			</p>
			<p>
				For questions about these terms, contact your Q-Detect administrator or
				legal@q-detect.example.
			</p>
		</article>
	);
}

function PrivacyPanel() {
	return (
		<article className="mx-auto w-full max-w-3xl space-y-4 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
			<h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">Privacy Policy</h2>
			<p className="text-zinc-500 dark:text-zinc-400">Last updated: August 19, 2026</p>
			<p>
				This Privacy Policy describes how Q-Detect handles personal and transactional information
				when you use our quantum-assisted fraud detection services.
			</p>
			<h3 className="pt-2 text-base font-semibold text-zinc-900 dark:text-zinc-100">1. Information we process</h3>
			<p>
				We process account credentials (such as username and email), authentication logs, and
				transaction graph data needed to run QGNN risk analysis. Graph data may include account
				identifiers, transfer amounts, timestamps, and relationship edges between entities.
			</p>
			<h3 className="pt-2 text-base font-semibold text-zinc-900 dark:text-zinc-100">2. How we use information</h3>
			<p>
				Data is used to authenticate users, compute risk scores, present investigation dashboards,
				and improve model reliability. We do not sell personal data to third-party advertisers.
			</p>
			<h3 className="pt-2 text-base font-semibold text-zinc-900 dark:text-zinc-100">3. Retention</h3>
			<p>
				Investigation records and model outputs are retained for as long as required by your
				organization’s compliance policies and applicable financial-crime regulations, then deleted
				or anonymized according to those rules.
			</p>
			<h3 className="pt-2 text-base font-semibold text-zinc-900 dark:text-zinc-100">4. Access controls</h3>
			<p>
				Access to dashboards and case details is limited to authenticated users with appropriate
				roles. Password changes and logout help protect your session on shared devices.
			</p>
			<h3 className="pt-2 text-base font-semibold text-zinc-900 dark:text-zinc-100">5. Your choices</h3>
			<p>
				You may update account details in Settings, request access corrections through your
				administrator, or log out to end an active session. For privacy requests, contact
				privacy@q-detect.example.
			</p>
		</article>
	);
}

export default function Settings({ open, onClose }) {
	const [section, setSection] = useState("account");

	useEffect(() => {
		if (!open) {
			return undefined;
		}

		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";

		const onKeyDown = (event) => {
			if (event.key === "Escape") {
				onClose();
			}
		};
		window.addEventListener("keydown", onKeyDown);

		return () => {
			document.body.style.overflow = previousOverflow;
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [open, onClose]);

	useEffect(() => {
		if (open) {
			setSection("account");
		}
	}, [open]);

	if (!open) {
		return null;
	}

	return (
		<div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
			<button
				type="button"
				className="absolute inset-0 bg-zinc-950/50 backdrop-blur-md"
				aria-label="Close settings"
				onClick={onClose}
			/>

			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby="settings-title"
				className="relative z-10 flex h-[min(88vh,820px)] w-full max-w-5xl overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50 text-zinc-900 shadow-2xl dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
			>
				<button
					type="button"
					className="absolute top-3 right-3 z-20 flex h-11 w-11 items-center justify-center rounded-full text-3xl leading-none text-zinc-500 hover:bg-zinc-200/80 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
					aria-label="Close settings"
					onClick={onClose}
				>
					×
				</button>

				<aside className="flex w-44 shrink-0 flex-col border-r border-zinc-200 bg-white sm:w-56 dark:border-zinc-800 dark:bg-zinc-900">
					<div className="border-b border-zinc-200 px-3 py-3 dark:border-zinc-800">
						<h2 id="settings-title" className="text-lg font-semibold">
							Settings
						</h2>
					</div>
					<nav className="flex flex-col gap-1 p-3">
						{SECTIONS.map((item) => {
							const active = section === item.id;
							return (
								<button
									key={item.id}
									type="button"
									className={`rounded-md px-3 py-2.5 text-left text-sm ${
										active
											? "bg-zinc-900 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
											: "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
									}`}
									onClick={() => setSection(item.id)}
								>
									{item.label}
								</button>
							);
						})}
					</nav>
				</aside>

				<main className="min-w-0 flex-1 overflow-y-auto px-4 py-6 pr-14 sm:px-6 sm:pr-16">
					{section === "account" ? <AccountPanel /> : null}
					{section === "terms" ? <TermsPanel /> : null}
					{section === "privacy" ? <PrivacyPanel /> : null}
				</main>
			</div>
		</div>
	);
}
