import { useEffect, useState } from "react";
import { logout, updateAccount } from "../api/auth";
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

	return (
		<div className="mx-auto w-full max-w-xl space-y-8">
			<section>
				<h2 className="mb-1 text-lg font-bold tracking-tight">Account details</h2>
				<p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
					Update the profile information associated with your Q-Detect account.
				</p>
				<form
					className="card space-y-4 p-5"
					onSubmit={onSaveAccount}
				>
					<label className="field-label block text-left">
						Username
						<input
							type="text"
							name="username"
							defaultValue={storedUser?.username ?? "user"}
							className="field-input mt-1.5"
						/>
					</label>
					<label className="field-label block text-left">
						Email address
						<input
							type="email"
							name="email"
							defaultValue={storedUser?.email ?? "abc123@example.com"}
							className="field-input mt-1.5"
						/>
					</label>
					<label className="field-label block text-left">
						Display name
						<input
							type="text"
							name="displayName"
							defaultValue={storedUser?.displayName ?? "Test User"}
							className="field-input mt-1.5"
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
						className="btn-primary"
					>
						{accountPending ? "Saving…" : "Save changes"}
					</button>
				</form>
			</section>

			<section>
				<h2 className="mb-1 text-lg font-bold tracking-tight">Log out</h2>
				<p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
					End your current Q-Detect session on this device.
				</p>
				<a
					href="#login"
					className="inline-flex rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50 dark:border-red-500/40 dark:bg-transparent dark:text-red-300 dark:hover:bg-red-500/10"
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
			<h2 className="text-xl font-semibold text-ink dark:text-zinc-100">Terms and Conditions</h2>
			<p className="text-zinc-500 dark:text-zinc-400">Last updated: August 19, 2026</p>
			<p>
				Welcome to Q-Detect, a hybrid quantum-classical fraud detection platform that uses Quantum
				Graph Neural Networks (QGNN) to identify high-risk transactional clusters. By accessing or
				using Q-Detect, you agree to these Terms and Conditions.
			</p>
			<h3 className="pt-2 text-base font-semibold text-ink dark:text-zinc-100">1. Permitted use</h3>
			<p>
				You may use Q-Detect only for lawful fraud monitoring, investigation, and risk review within
				your organization. You must not attempt to reverse engineer model outputs for unauthorized
				purposes, disrupt service availability, or access another user’s cases without permission.
			</p>
			<h3 className="pt-2 text-base font-semibold text-ink dark:text-zinc-100">2. Risk scores and decisions</h3>
			<p>
				Risk percentages, cluster labels (such as Fraud, Pending, Safe, or Flagged), and related
				insights are decision-support outputs. They do not automatically freeze funds or initiate
				legal action. Final account actions remain the responsibility of authorized human reviewers.
			</p>
			<h3 className="pt-2 text-base font-semibold text-ink dark:text-zinc-100">3. Data accuracy</h3>
			<p>
				You are responsible for ensuring transaction graphs and supporting records submitted to
				Q-Detect are accurate and complete. Incomplete or corrupted graph data may reduce detection
				quality.
			</p>
			<h3 className="pt-2 text-base font-semibold text-ink dark:text-zinc-100">4. Confidentiality</h3>
			<p>
				Investigation workspaces, flagged clusters, and reviewer notes are confidential. Do not share
				exports or screenshots outside approved channels.
			</p>
			<h3 className="pt-2 text-base font-semibold text-ink dark:text-zinc-100">5. Service changes</h3>
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
			<h2 className="text-xl font-semibold text-ink dark:text-zinc-100">Privacy Policy</h2>
			<p className="text-zinc-500 dark:text-zinc-400">Last updated: August 19, 2026</p>
			<p>
				This Privacy Policy describes how Q-Detect handles personal and transactional information
				when you use our quantum-assisted fraud detection services.
			</p>
			<h3 className="pt-2 text-base font-semibold text-ink dark:text-zinc-100">1. Information we process</h3>
			<p>
				We process account credentials (such as username and email), authentication logs, and
				transaction graph data needed to run QGNN risk analysis. Graph data may include account
				identifiers, transfer amounts, timestamps, and relationship edges between entities.
			</p>
			<h3 className="pt-2 text-base font-semibold text-ink dark:text-zinc-100">2. How we use information</h3>
			<p>
				Data is used to authenticate users, compute risk scores, present investigation dashboards,
				and improve model reliability. We do not sell personal data to third-party advertisers.
			</p>
			<h3 className="pt-2 text-base font-semibold text-ink dark:text-zinc-100">3. Retention</h3>
			<p>
				Investigation records and model outputs are retained for as long as required by your
				organization’s compliance policies and applicable financial-crime regulations, then deleted
				or anonymized according to those rules.
			</p>
			<h3 className="pt-2 text-base font-semibold text-ink dark:text-zinc-100">4. Access controls</h3>
			<p>
				Access to dashboards and case details is limited to authenticated users with appropriate
				roles. Password changes and logout help protect your session on shared devices.
			</p>
			<h3 className="pt-2 text-base font-semibold text-ink dark:text-zinc-100">5. Your choices</h3>
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
				className="absolute inset-0 bg-ink/60 backdrop-blur-sm"
				aria-label="Close settings"
				onClick={onClose}
			/>

			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby="settings-title"
				className="relative z-10 flex h-[min(88vh,820px)] w-full max-w-5xl overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50 text-ink shadow-2xl dark:border-ink-700 dark:bg-ink dark:text-zinc-100"
			>
				<button
					type="button"
					className="absolute top-3 right-3 z-20 flex h-10 w-10 items-center justify-center rounded-lg text-2xl leading-none text-zinc-500 transition-colors hover:bg-zinc-200/80 hover:text-ink dark:text-zinc-400 dark:hover:bg-ink-700 dark:hover:text-zinc-100"
					aria-label="Close settings"
					onClick={onClose}
				>
					×
				</button>

				<aside className="flex w-44 shrink-0 flex-col bg-ink text-white sm:w-60">
					<div className="border-b-2 border-brand px-4 py-4">
						<h2 id="settings-title" className="text-lg font-bold tracking-tight">
							Settings
						</h2>
						<p className="mt-0.5 text-xs text-zinc-400">Manage your workspace</p>
					</div>
					<nav className="flex flex-col gap-1 p-3">
						{SECTIONS.map((item) => {
							const active = section === item.id;
							return (
								<button
									key={item.id}
									type="button"
									aria-current={active ? "page" : undefined}
									className={`rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
										active
											? "bg-brand font-semibold text-ink"
											: "text-zinc-300 hover:bg-white/10 hover:text-white"
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
