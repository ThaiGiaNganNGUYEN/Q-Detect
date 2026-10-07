import { useEffect, useState } from "react";
import { Wordmark } from "../components/Brand";
import MarkGraphStatus from "../components/MarkGraphStatus";
import MuleNetworkGraph from "../components/MuleNetworkGraph";
import { logout } from "../api/auth";
import { getErrorMessage, isApiConfigured } from "../api/client";
import { getClusters } from "../api/clusters";
import { updateGraphStatus } from "../api/graphs";
import { toRawClusterList } from "../data/adaptBackendCluster";
import { adaptClustersResponse, sampleMuleNetworks } from "../data/sampleMuleNetworks";
import { downloadBlob, toCsv, toFileSlug } from "../utils/download";
import Settings from "./settings";

import { useLogout } from "../auth/hooks/logout-utils";

function formatAmount(amount) {
	return Number(amount).toLocaleString("en-US", {
		minimumFractionDigits: 0,
		maximumFractionDigits: 2,
	});
}

// Undefined for the sample-data fallback (it predates these fields) --
// every formatter below renders "—" instead of "undefined"/"NaN" in that case.
function formatBoolean(value) {
	if (value === undefined || value === null) {
		return "—";
	}
	return value ? "Yes" : "No";
}

function formatHours(hours) {
	if (typeof hours !== "number" || Number.isNaN(hours)) {
		return "—";
	}
	return `${hours.toFixed(1)}h`;
}

function formatRiskScore(score) {
	if (typeof score !== "number" || Number.isNaN(score)) {
		return "—";
	}
	return `${Math.round(score * 100)}%`;
}

const RISK_TONES = {
	high: {
		label: "High",
		bar: "bg-red-500",
		chip: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30",
	},
	medium: {
		label: "Medium",
		bar: "bg-amber-500",
		chip: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30",
	},
	low: {
		label: "Low",
		bar: "bg-emerald-500",
		chip: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30",
	},
};

function riskTone(percent) {
	if (percent >= 80) {
		return RISK_TONES.high;
	}
	if (percent >= 50) {
		return RISK_TONES.medium;
	}
	return RISK_TONES.low;
}

const STATUS_STYLES = {
	Safe: {
		chip: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30",
		dot: "bg-emerald-500",
	},
	Fraud: {
		chip: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30",
		dot: "bg-red-500",
	},
	Pending: {
		chip: "bg-zinc-100 text-zinc-600 ring-zinc-200 dark:bg-ink-700 dark:text-zinc-300 dark:ring-ink-600",
		dot: "bg-zinc-400",
	},
};

function StatusBadge({ status }) {
	const style = STATUS_STYLES[status] ?? STATUS_STYLES.Pending;
	return (
		<span
			className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${style.chip}`}
		>
			<span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} aria-hidden="true" />
			{status}
		</span>
	);
}

function RiskChip({ percent }) {
	const tone = riskTone(percent);
	return (
		<span
			className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ring-1 ring-inset ${tone.chip}`}
		>
			{percent}%
		</span>
	);
}

const RING_STROKES = {
	High: "stroke-red-500",
	Medium: "stroke-amber-500",
	Low: "stroke-emerald-500",
};

function RiskRing({ percent, size = 44, strokeWidth = 4, className = "", textClassName = "text-[11px]" }) {
	const tone = riskTone(percent);
	const radius = (size - strokeWidth) / 2;
	const circumference = 2 * Math.PI * radius;
	const clamped = Math.min(100, Math.max(0, Number(percent) || 0));
	return (
		<div
			className={`relative inline-flex shrink-0 items-center justify-center ${className}`}
			style={{ width: size, height: size }}
			role="img"
			aria-label={`Risk score ${percent}% (${tone.label})`}
		>
			<svg className="-rotate-90" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
				<circle
					cx={size / 2}
					cy={size / 2}
					r={radius}
					fill="none"
					strokeWidth={strokeWidth}
					className="stroke-zinc-200 dark:stroke-ink-700"
				/>
				<circle
					cx={size / 2}
					cy={size / 2}
					r={radius}
					fill="none"
					strokeWidth={strokeWidth}
					strokeLinecap="round"
					strokeDasharray={circumference}
					strokeDashoffset={circumference * (1 - clamped / 100)}
					className={RING_STROKES[tone.label]}
				/>
			</svg>
			<span className={`absolute font-bold tabular-nums ${textClassName}`}>{percent}%</span>
		</div>
	);
}

function HamburgerIcon({ className = "h-5 w-5" }) {
	return (
		<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
			<path d="M4 7h16M4 12h16M4 17h16" />
		</svg>
	);
}

function DownloadIcon({ className = "h-4 w-4" }) {
	return (
		<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<path d="M12 4v11" />
			<path d="M7 10l5 5 5-5" />
			<path d="M5 20h14" />
		</svg>
	);
}

const CSV_COLUMNS = [
	["Transaction ID", (tx) => tx.id],
	["Timestamp", (tx) => tx.timestamp],
	["Sender", (tx) => tx.fromLabel],
	["Receiver", (tx) => tx.toLabel],
	["Amount", (tx) => tx.amount],
	["Currency", (tx) => tx.currency ?? ""],
	["Transaction Format", (tx) => tx.payment_format],
	["Hours From Start", (tx) => (typeof tx.hours_from_start === "number" ? tx.hours_from_start : "")],
	["Cross-Bank", (tx) => csvBoolean(tx.is_cross_bank)],
	["Cross-Currency", (tx) => csvBoolean(tx.is_cross_currency)],
	["Self-Transfer", (tx) => csvBoolean(tx.is_self_transfer)],
	["Fraud Risk", (tx) => (typeof tx.fraud_risk_score === "number" ? formatRiskScore(tx.fraud_risk_score) : "")],
];

function csvBoolean(value) {
	return value === undefined || value === null ? "" : formatBoolean(value);
}

function CalendarIcon({ className = "h-4 w-4" }) {
	return (
		<svg className={className} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
			<path d="M14 0H2a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2zM1 3.857C1 3.384 1.448 3 2 3h12c.552 0 1 .384 1 .857v10.286c0 .473-.448.857-1 .857H2c-.552 0-1-.384-1-.857V3.857z" />
			<path d="M6.5 7a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm3 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm3 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm-9 3a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm3 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm3 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm3 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm-9 3a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm3 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm3 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" />
		</svg>
	);
}

function GearIcon({ className = "h-4 w-4" }) {
	return (
		<svg className={className} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
			<path d="M7.068.727c.243-.97 1.62-.97 1.864 0l.071.286a.96.96 0 0 0 1.622.434l.205-.211c.695-.719 1.888-.03 1.613.931l-.08.284a.96.96 0 0 0 1.187 1.187l.283-.081c.96-.275 1.65.918.931 1.613l-.211.205a.96.96 0 0 0 .434 1.622l.286.071c.97.243.97 1.62 0 1.864l-.286.071a.96.96 0 0 0-.434 1.622l.211.205c.719.695.03 1.888-.931 1.613l-.284-.08a.96.96 0 0 0-1.187 1.187l.081.283c.275.96-.918 1.65-1.613.931l-.205-.211a.96.96 0 0 0-1.622.434l-.071.286c-.243.97-1.62.97-1.864 0l-.071-.286a.96.96 0 0 0-1.622-.434l-.205.211c-.695.719-1.888.03-1.613-.931l.08-.284a.96.96 0 0 0-1.186-1.187l-.284.081c-.96.275-1.65-.918-.931-1.613l.211-.205a.96.96 0 0 0-.434-1.622l-.286-.071c-.97-.243-.97-1.62 0-1.864l.286-.071a.96.96 0 0 0 .434-1.622l-.211-.205c-.719-.695-.03-1.888.931-1.613l.284.08a.96.96 0 0 0 1.187-1.186l-.081-.284c-.275-.96.918-1.65 1.613-.931l.205.211a.96.96 0 0 0 1.622-.434l.071-.286z" />
		</svg>
	);
}

function DoorIcon({ className = "h-4 w-4" }) {
	return (
		<svg className={className} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
			<path d="M3 2a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v13h1.5a.5.5 0 0 1 0 1h-13a.5.5 0 0 1 0-1H3V2zm1 13h8V2H4v13z" />
			<path d="M9 9a1 1 0 1 0 2 0 1 1 0 0 0-2 0z" />
		</svg>
	);
}

function SunIcon({ className = "h-4 w-4" }) {
	return (
		<svg className={className} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
			<path d="M8 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM8 0a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 0zm0 13a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 13zm8-5a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2a.5.5 0 0 1 .5.5zM3 8a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2A.5.5 0 0 1 3 8zm10.657-5.657a.5.5 0 0 1 0 .707l-1.414 1.415a.5.5 0 1 1-.707-.708l1.414-1.414a.5.5 0 0 1 .707 0zm-9.193 9.193a.5.5 0 0 1 0 .707L3.05 13.657a.5.5 0 0 1-.707-.707l1.414-1.414a.5.5 0 0 1 .707 0zm9.193 2.121a.5.5 0 0 1-.707 0l-1.414-1.414a.5.5 0 0 1 .707-.707l1.414 1.414a.5.5 0 0 1 0 .707zM4.464 4.465a.5.5 0 0 1-.707 0L2.343 3.05a.5.5 0 1 1 .707-.707l1.414 1.414a.5.5 0 0 1 0 .708z" />
		</svg>
	);
}

function MoonIcon({ className = "h-4 w-4" }) {
	return (
		<svg className={className} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
			<path d="M6 .278a.768.768 0 0 1 .08.858 7.208 7.208 0 0 0-.878 3.46c0 4.021 3.278 7.277 7.318 7.277.527 0 1.04-.055 1.533-.16a.787.787 0 0 1 .81.316.733.733 0 0 1-.031.893A8.349 8.349 0 0 1 8.344 16C3.734 16 0 12.286 0 7.71 0 4.266 2.114 1.312 5.124.06A.752.752 0 0 1 6 .278z" />
		</svg>
	);
}

function HalfCircleIcon({ className = "h-4 w-4" }) {
	return (
		<svg className={className} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
			<path d="M8 15A7 7 0 1 0 8 1v14zm0 1A8 8 0 1 1 8 0a8 8 0 0 1 0 16z" />
		</svg>
	);
}

function getPreferredTheme() {
	const stored = localStorage.getItem("qdetect-theme");
	if (stored === "light" || stored === "dark" || stored === "auto") {
		return stored;
	}
	return "auto";
}

function resolveTheme(theme) {
	if (theme === "auto") {
		return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
	}
	return theme;
}

export default function Home() {
	// Starts as the static sample data so the dashboard renders immediately;
	// swapped for live backend clusters by the effect below once they load.
	const [muleNetworks, setMuleNetworks] = useState(sampleMuleNetworks);
	const [graphsLoading, setGraphsLoading] = useState(false);
	const [graphsError, setGraphsError] = useState(null);
	const [selectedGraphId, setSelectedGraphId] = useState(() => sampleMuleNetworks[0]?.id ?? "0");
	const [graphSelection, setGraphSelection] = useState(null);
	const [graphStatuses, setGraphStatuses] = useState(() =>
		Object.fromEntries(sampleMuleNetworks.map((graph) => [graph.id, graph.status ?? "Pending"])),
	);
	const [navMenuOpen, setNavMenuOpen] = useState(false);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [theme, setTheme] = useState(getPreferredTheme);
	const [themeMenuOpen, setThemeMenuOpen] = useState(false);
	const [resolvedTheme, setResolvedTheme] = useState(() => resolveTheme(getPreferredTheme()));

	useEffect(() => {
		const applied = resolveTheme(theme);
		setResolvedTheme(applied);
		document.documentElement.classList.toggle("dark", applied === "dark");
		localStorage.setItem("qdetect-theme", theme);

		if (theme !== "auto") {
			return undefined;
		}

		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const onChange = () => {
			const next = resolveTheme("auto");
			setResolvedTheme(next);
			document.documentElement.classList.toggle("dark", next === "dark");
		};
		media.addEventListener("change", onChange);
		return () => media.removeEventListener("change", onChange);
	}, [theme]);

	useEffect(() => {
		if (!isApiConfigured()) {
			return undefined;
		}

		let cancelled = false;
		setGraphsLoading(true);
		setGraphsError(null);

		getClusters()
			.then((response) => {
				if (cancelled) {
					return;
				}
				const { clusters } = adaptClustersResponse(toRawClusterList(response));
				if (clusters.length === 0) {
					return;
				}
				setMuleNetworks(clusters);
				setGraphStatuses(
					Object.fromEntries(clusters.map((graph) => [graph.id, graph.status ?? "Pending"])),
				);
				setSelectedGraphId(clusters[0].id);
			})
			.catch((error) => {
				if (!cancelled) {
					setGraphsError(getErrorMessage(error));
				}
			})
			.finally(() => {
				if (!cancelled) {
					setGraphsLoading(false);
				}
			});

		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		setGraphSelection(null);
	}, [selectedGraphId]);

	const selectedGraph =
		muleNetworks.find((graph) => String(graph.id) === String(selectedGraphId)) ?? muleNetworks[0];
	const selectedStatus = graphStatuses[selectedGraph.id] ?? "Pending";
	const isDark = resolvedTheme === "dark";

	const markGraph = (status) => {
		const graphId = selectedGraph.id;
		const previous = graphStatuses[graphId] ?? "Pending";
		const next = previous === status ? "Pending" : status;
		setGraphStatuses((current) => ({
			...current,
			[graphId]: next,
		}));

		if (!isApiConfigured()) {
			return;
		}

		updateGraphStatus(graphId, next).catch(() => {
			setGraphStatuses((current) => ({
				...current,
				[graphId]: previous,
			}));
		});
	};
	const { logout, isBusy } = useLogout();
	const cell = "border-b border-zinc-100 px-3 py-2.5 dark:border-ink-700";

	const exportTransactionsCsv = () => {
		const csv = toCsv(
			CSV_COLUMNS.map(([heading]) => heading),
			selectedGraph.transactions.map((tx) => CSV_COLUMNS.map(([, value]) => value(tx))),
		);
		downloadBlob(
			new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }),
			`${toFileSlug(selectedGraph.name)}-transactions.csv`,
		);
	};

	const sidebar = (
		<div className="flex h-full flex-col">
			<h2 className="flex items-center justify-between gap-2 border-b border-zinc-200 px-4 pt-5 pb-3 text-sm font-bold tracking-tight dark:border-ink-700">
				<span>Graph</span>
				{/* Shown only while the live /api/clusters fetch is in flight. */}
				{graphsLoading ? (
					<span className="inline-flex items-center gap-1.5 text-xs font-normal text-zinc-500 dark:text-zinc-400">
						<span
							className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-300 border-t-brand"
							aria-hidden="true"
						/>
						Loading…
					</span>
				) : (
					<span>Risk Score</span>
				)}
			</h2>

			{/* Fetch failed -- muleNetworks already fell back to sampleMuleNetworks, this just says so. */}
			{graphsError ? (
				<p className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
					Couldn't load live graphs ({graphsError}). Showing sample data.
				</p>
			) : null}

			<ul className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
				{muleNetworks.map((graph) => {
					const selected = graph.id === selectedGraphId;
					const status = graphStatuses[graph.id] ?? "Pending";
					return (
						<li key={graph.id}>
							<button
								type="button"
								aria-current={selected ? "true" : undefined}
								className={`group w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${
									selected
										? "border-brand bg-brand-50 shadow-[inset_3px_0_0_var(--color-brand)] dark:border-brand/60 dark:bg-brand/10"
										: "border-transparent hover:border-zinc-200 hover:bg-white dark:hover:border-ink-700 dark:hover:bg-ink-800"
								}`}
								onClick={() => {
									setSelectedGraphId(graph.id);
									setGraphSelection(null);
								}}
							>
								<div className="flex items-center justify-between gap-3">
									<div className="min-w-0">
										<span className="block truncate text-sm font-semibold">{graph.name}</span>
										<span className="mt-1.5 block">
											<StatusBadge status={status} />
										</span>
									</div>
									<RiskRing percent={graph.risk} />
								</div>
							</button>
						</li>
					);
				})}
			</ul>
		</div>
	);

	return (
		<div className={`min-h-screen ${isDark ? "bg-ink text-zinc-100" : "bg-zinc-50 text-ink"}`}>
			<header className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b-2 border-brand bg-ink px-4 text-white sm:px-6">
				<a href="#dashboard" className="flex items-center rounded-md">
					<Wordmark
						className="text-xl text-white"
						logoClassName="h-9 w-9"
					/>
				</a>
				<div className="ml-auto flex items-center gap-1">
					<div className="relative">
						<button
							type="button"
							className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
							aria-expanded={themeMenuOpen}
							aria-label={`Toggle theme (${theme})`}
							title="Theme"
							onClick={() => setThemeMenuOpen((open) => !open)}
						>
							{theme === "light" ? <SunIcon /> : null}
							{theme === "dark" ? <MoonIcon /> : null}
							{theme === "auto" ? <HalfCircleIcon /> : null}
						</button>
						{themeMenuOpen ? (
							<>
								<button
									type="button"
									className="fixed inset-0 z-40 cursor-default"
									aria-label="Close theme menu"
									onClick={() => setThemeMenuOpen(false)}
								/>
								<ul className="absolute top-full right-0 z-50 mt-2 w-40 overflow-hidden rounded-lg border border-zinc-200 bg-white p-1 text-sm text-ink shadow-xl dark:border-ink-700 dark:bg-ink-800 dark:text-zinc-100">
									{[
										{ value: "light", label: "Light", icon: <SunIcon /> },
										{ value: "dark", label: "Dark", icon: <MoonIcon /> },
										{ value: "auto", label: "Auto", icon: <HalfCircleIcon /> },
									].map((option) => (
										<li key={option.value}>
											<button
												type="button"
												className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left transition-colors ${
													theme === option.value
														? "bg-brand-50 font-semibold text-brand-800 dark:bg-brand/15 dark:text-brand"
														: "hover:bg-zinc-100 dark:hover:bg-ink-700"
												}`}
												onClick={() => {
													setTheme(option.value);
													setThemeMenuOpen(false);
												}}
											>
												{option.icon}
												{option.label}
											</button>
										</li>
									))}
								</ul>
							</>
						) : null}
					</div>

					<div className="relative">
						<button
							type="button"
							className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
							aria-label="Open menu"
							aria-expanded={navMenuOpen}
							onClick={() => setNavMenuOpen((open) => !open)}
						>
							<HamburgerIcon className="h-6 w-6" />
						</button>
						{navMenuOpen ? (
							<>
								<button
									type="button"
									className="fixed inset-0 z-40 cursor-default"
									aria-label="Close menu"
									onClick={() => setNavMenuOpen(false)}
								/>
								<ul className="absolute top-full right-0 z-50 mt-2 w-48 overflow-hidden rounded-lg border border-zinc-200 bg-white p-1 text-sm text-ink shadow-xl dark:border-ink-700 dark:bg-ink-800 dark:text-zinc-100">
									<li>
										<button
											type="button"
											className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left transition-colors hover:bg-zinc-100 dark:hover:bg-ink-700"
											onClick={() => {
												setNavMenuOpen(false);
												setSettingsOpen(true);
											}}
										>
											<GearIcon />
											Settings
										</button>
									</li>
									<li>
										<a href="#login" className="block rounded-md">
											<button
												type="button"
												disabled={isBusy}
												onClick={() => {
													setNavMenuOpen(false);
													logout();
												}}
												className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-500/10"
											>
												<DoorIcon />
												{isBusy ? "Signing out…" : "Sign out"}
											</button>
										</a>
									</li>
								</ul>
							</>
						) : null}
					</div>
				</div>
			</header>

			<div className="flex">
				<aside className="sticky top-16 h-[calc(100vh-4rem)] w-60 shrink-0 border-r border-zinc-200 bg-zinc-100/70 sm:w-72 lg:w-80 dark:border-ink-700 dark:bg-ink-900">
					{sidebar}
				</aside>

				<main className="min-w-0 flex-1 space-y-5 p-4 sm:p-6">
					<section className="card flex flex-wrap items-center justify-between gap-4 p-5">
						<div className="flex min-w-0 items-center gap-4">
							<RiskRing percent={selectedGraph.risk} size={64} strokeWidth={6} textClassName="text-sm" />
							<div className="min-w-0">
								<p className="text-xs font-semibold tracking-wider text-brand-700 uppercase dark:text-brand">
									Selected case
								</p>
								<h1 className="mt-0.5 truncate text-2xl font-bold tracking-tight">{selectedGraph.name}</h1>
								<div className="mt-1.5">
									<StatusBadge status={selectedStatus} />
								</div>
							</div>
						</div>
						<MarkGraphStatus
							status={selectedStatus}
							onMarkSafe={() => markGraph("Safe")}
							onMarkFraud={() => markGraph("Fraud")}
						/>
					</section>

					<MuleNetworkGraph
						key={selectedGraph.id}
						graphId={selectedGraph.id}
						graphName={selectedGraph.name}
						nodes={selectedGraph.nodes}
						links={selectedGraph.links}
						isDark={isDark}
						className=""
						transactions={selectedGraph.transactions}
						selection={graphSelection}
						onSelect={setGraphSelection}
					/>

					<section className="card overflow-hidden">
						<div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-5 py-4 dark:border-ink-700">
							<h2 className="text-base font-bold">Transaction details</h2>
							<button
								type="button"
								className="btn-primary px-3 py-1.5"
								disabled={selectedGraph.transactions.length === 0}
								onClick={exportTransactionsCsv}
							>
								<DownloadIcon />
								Export CSV
							</button>
						</div>
					<div className="overflow-x-auto text-sm">
						<table className="w-full min-w-[960px] border-collapse">
							<thead>
								<tr className="bg-zinc-50 text-left text-[11px] tracking-wide text-zinc-500 uppercase dark:bg-ink-800 dark:text-zinc-400">
									{[
										"Transaction ID",
										"Timestamp",
										"Sender",
										"Receiver",
										"Amount",
										"Currency",
										"Transaction Format",
										"Hours From Start",
										"Cross-Bank",
										"Cross-Currency",
										"Self-Transfer",
										"Fraud Risk",
									].map((heading) => (
										<th
											key={heading}
											className="border-b border-zinc-200 px-3 py-2.5 font-semibold whitespace-nowrap dark:border-ink-700"
										>
											{heading}
										</th>
									))}
								</tr>
							</thead>
							<tbody>
								{selectedGraph.transactions.map((tx, index) => {
									const selected =
										graphSelection?.type === "transaction" && String(tx.id) === String(graphSelection.id);
									const connectedToNode =
										graphSelection?.type === "node" &&
										!tx.isCashOut &&
										(String(tx.sender?.id) === String(graphSelection.id) ||
											String(tx.receiver?.id) === String(graphSelection.id));
									return (
									<tr
										key={tx.id}
										data-tx-row={tx.id}
										className={`cursor-pointer transition-colors ${
											selected || connectedToNode
												? "bg-brand-50 shadow-[inset_3px_0_0_var(--color-brand)] dark:bg-brand/10"
												: index % 2 === 0
													? "bg-white hover:bg-brand-50/60 dark:bg-ink-900 dark:hover:bg-brand/5"
													: "bg-zinc-50/60 hover:bg-brand-50/60 dark:bg-ink-800/60 dark:hover:bg-brand/5"
										}`}
										onClick={() =>
											setGraphSelection((current) =>
												current?.type === "transaction" && String(current.id) === String(tx.id)
													? null
													: { type: "transaction", id: tx.id },
											)
										}
									>
										<td className={`${cell} font-mono text-xs font-semibold`}>{tx.id}</td>
										<td className={`${cell} whitespace-nowrap text-zinc-600 dark:text-zinc-300`}>
											{tx.timestamp}
										</td>
										<td className={`${cell} font-medium`}>{tx.fromLabel}</td>
										<td className={`${cell} font-medium`}>{tx.toLabel}</td>
										<td className={`${cell} text-right font-semibold tabular-nums`}>
											{formatAmount(tx.amount)}
										</td>
										<td className={cell}>{tx.currency ?? "—"}</td>
										<td className={cell}>{tx.payment_format}</td>
										<td className={`${cell} tabular-nums`}>{formatHours(tx.hours_from_start)}</td>
										<td className={cell}>{formatBoolean(tx.is_cross_bank)}</td>
										<td className={cell}>{formatBoolean(tx.is_cross_currency)}</td>
										<td className={cell}>{formatBoolean(tx.is_self_transfer)}</td>
										<td className={cell}>
											{typeof tx.fraud_risk_score === "number" && !Number.isNaN(tx.fraud_risk_score) ? (
												<RiskChip percent={Math.round(tx.fraud_risk_score * 100)} />
											) : (
												formatRiskScore(tx.fraud_risk_score)
											)}
										</td>
									</tr>
									);
								})}
							</tbody>
						</table>
					</div>
					</section>
				</main>
			</div>

			<Settings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
		</div>
	);
}
