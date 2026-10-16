import { useEffect, useState } from "react";
import qDetectLogo from "../assets/qdetect-logo.png";
import MarkGraphStatus from "../components/MarkGraphStatus";
import MuleNetworkGraph from "../components/MuleNetworkGraph";
import { logout } from "../api/auth";
import { ApiError, getApiBaseUrl, getErrorMessage, isApiConfigured } from "../api/client";
import { getClusters } from "../api/clusters";
import { updateGraphStatus } from "../api/graphs";
import { toRawClusterList } from "../data/adaptBackendCluster";
import { adaptClustersResponse, sampleMuleNetworks } from "../data/sampleMuleNetworks";
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

function statusClass(status, selected) {
	if (selected) {
		return "";
	}
	if (status === "Safe") {
		return "text-emerald-600 dark:text-emerald-400";
	}
	if (status === "Fraud") {
		return "text-red-600 dark:text-red-400";
	}
	return "text-zinc-500 dark:text-zinc-400";
}

function HamburgerIcon({ className = "h-5 w-5" }) {
	return (
		<svg className={className} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
			<path
				fillRule="evenodd"
				d="M2.5 12a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5z"
			/>
		</svg>
	);
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

// Where the dashboard's networks come from. Everything except "live" shows the
// sample data, and DataSourceBanner says why.
//   unconfigured -- VITE_API_BASE_URL isn't set
//   loading      -- /api/clusters request in flight
//   live         -- showing the backend's clusters
//   empty        -- backend answered, but it has no clusters yet
//   unreachable  -- no response at all (backend not running, or wrong URL)
//   error        -- backend answered with an error
function DataSourceBanner({ source, error, onRetry }) {
	if (source === "live" || source === "loading") {
		return null;
	}

	const messages = {
		unconfigured: (
			<>
				<strong>Not connected to a backend.</strong> Set <code>VITE_API_BASE_URL</code> in{" "}
				<code>Frontend/.env</code> and restart the dev server.
			</>
		),
		unreachable: (
			<>
				<strong>Can't reach the backend</strong> at <code>{getApiBaseUrl()}</code>. Is it running?
			</>
		),
		error: (
			<>
				<strong>The backend returned an error:</strong> {error}
			</>
		),
		empty: (
			<>
				<strong>Connected to the backend, but there are no clusters yet.</strong> They appear once the
				transaction poller has scored a batch (<code>POST /api/util/jobs/start</code>).
			</>
		),
	};
	const isProblem = source === "unreachable" || source === "error";

	return (
		<div
			role="status"
			className={`mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm ${
				isProblem
					? "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200"
					: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100"
			}`}
		>
			<p>
				{messages[source]} Showing <strong>sample data</strong>.
			</p>
			{source !== "unconfigured" ? (
				<button
					type="button"
					className="rounded border border-current px-2 py-1 text-xs font-semibold hover:bg-black/5 dark:hover:bg-white/10"
					onClick={onRetry}
				>
					Check again
				</button>
			) : null}
		</div>
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
	const [dataSource, setDataSource] = useState(() => (isApiConfigured() ? "loading" : "unconfigured"));
	const [dataSourceError, setDataSourceError] = useState(null);
	const [reloadKey, setReloadKey] = useState(0); // bumped by "Check again" to re-fetch
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
		setDataSource("loading");
		setDataSourceError(null);

		const showNetworks = (networks) => {
			setMuleNetworks(networks);
			setGraphStatuses(
				Object.fromEntries(networks.map((graph) => [graph.id, graph.status ?? "Pending"])),
			);
			setSelectedGraphId(networks[0].id);
		};

		getClusters()
			.then((response) => {
				if (cancelled) {
					return;
				}
				const { clusters } = adaptClustersResponse(toRawClusterList(response));
				if (clusters.length === 0) {
					showNetworks(sampleMuleNetworks);
					setDataSource("empty");
					return;
				}
				showNetworks(clusters);
				setDataSource("live");
			})
			.catch((error) => {
				if (cancelled) {
					return;
				}
				showNetworks(sampleMuleNetworks);
				// ApiError = the backend answered with an error status; anything else
				// (fetch's TypeError) means the request never got a response.
				if (error instanceof ApiError && error.status > 0) {
					setDataSource("error");
					setDataSourceError(getErrorMessage(error));
				} else {
					setDataSource("unreachable");
				}
			});

		return () => {
			cancelled = true;
		};
	}, [reloadKey]);

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
		<div className={`min-h-screen ${isDark ? "bg-zinc-950 text-zinc-100" : "bg-white text-zinc-900"}`}>
			<header className="sticky top-0 z-40 flex items-center bg-zinc-900 px-2 py-1 text-white shadow">
				<div className="relative">
					<button
						type="button"
						className="inline-flex items-center justify-center px-3 py-3 text-white hover:bg-zinc-800"
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
							<ul className="absolute top-full left-0 z-50 mt-1 w-44 overflow-hidden rounded-md border border-zinc-200 bg-white py-1 text-sm text-zinc-800 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
								<li>
									<button
										type="button"
										className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
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
										<a
											href="#login"
											//className="flex w-full items-center gap-2 px-3 py-2.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
											><button
												type="button"
												disabled={isBusy}
												onClick={() => {
												setNavMenuOpen(false);
												logout();
												}}
												className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
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

				<a
					href="#dashboard"
					className="flex items-center gap-3 px-3 py-2 text-2xl font-semibold text-white"
				>
					<img src={qDetectLogo} alt="" className="h-10 w-10 rounded-full object-cover" />
					Q-Detect
				</a>
			</header>

			<div className="flex">
				<aside className="sticky top-[64px] h-[calc(100vh-64px)] w-[42%] shrink-0 border-r border-zinc-200 bg-zinc-100 sm:w-1/3 lg:w-1/6 dark:border-zinc-800 dark:bg-zinc-900">
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
					</div>

					<MuleNetworkGraph
						key={selectedGraph.id}
						graphId={selectedGraph.id}
						graphName={selectedGraph.name}
						nodes={selectedGraph.nodes}
						links={selectedGraph.links}
						risk={selectedGraph.risk}
						isDark={isDark}
						className="my-4"
						transactions={selectedGraph.transactions}
						selection={graphSelection}
						onSelect={setGraphSelection}
					/>

					<h2 className="mb-2 text-xl font-semibold">Transaction Details</h2>
					<div className="overflow-x-auto text-sm">
						<table className="w-full min-w-[960px] border-collapse">
							<thead>
								<tr className="border-b border-zinc-300 text-left dark:border-zinc-700">
									<th className="px-2 py-1.5 font-semibold">Transaction ID</th>
									<th className="px-2 py-1.5 font-semibold">Timestamp</th>
									<th className="px-2 py-1.5 font-semibold">Sender</th>
									<th className="px-2 py-1.5 font-semibold">Receiver</th>
									<th className="px-2 py-1.5 font-semibold">Amount</th>
									<th className="px-2 py-1.5 font-semibold">Currency</th>
									<th className="px-2 py-1.5 font-semibold">Transaction Format</th>
									<th className="px-2 py-1.5 font-semibold">Hours From Start</th>
									<th className="px-2 py-1.5 font-semibold">Cross-Bank</th>
									<th className="px-2 py-1.5 font-semibold">Cross-Currency</th>
									<th className="px-2 py-1.5 font-semibold">Self-Transfer</th>
									<th className="px-2 py-1.5 font-semibold">Fraud Risk</th>
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
										className={`cursor-pointer ${
											selected || connectedToNode
												? "bg-sky-100 ring-1 ring-inset ring-sky-400 dark:bg-sky-900/50 dark:ring-sky-400"
												: index % 2 === 0
													? "bg-zinc-50 hover:bg-sky-50 dark:bg-zinc-900/60 dark:hover:bg-sky-950/40"
													: "bg-white hover:bg-sky-50 dark:bg-zinc-950 dark:hover:bg-sky-950/40"
										}`}
										onClick={() =>
											setGraphSelection((current) =>
												current?.type === "transaction" && String(current.id) === String(tx.id)
													? null
													: { type: "transaction", id: tx.id },
											)
										}
									>
										<td className="border-b border-zinc-200 px-2 py-1.5 dark:border-zinc-800">{tx.id}</td>
										<td className="border-b border-zinc-200 px-2 py-1.5 whitespace-nowrap dark:border-zinc-800">
											{tx.timestamp}
										</td>
										<td className="border-b border-zinc-200 px-2 py-1.5 dark:border-zinc-800">{tx.fromLabel}</td>
										<td className="border-b border-zinc-200 px-2 py-1.5 dark:border-zinc-800">{tx.toLabel}</td>
										<td className="border-b border-zinc-200 px-2 py-1.5 dark:border-zinc-800">
											{formatAmount(tx.amount)}
										</td>
										<td className="border-b border-zinc-200 px-2 py-1.5 dark:border-zinc-800">
											{tx.currency ?? "—"}
										</td>
										<td className="border-b border-zinc-200 px-2 py-1.5 dark:border-zinc-800">
											{tx.payment_format}
										</td>
										<td className="border-b border-zinc-200 px-2 py-1.5 dark:border-zinc-800">
											{formatHours(tx.hours_from_start)}
										</td>
										<td className="border-b border-zinc-200 px-2 py-1.5 dark:border-zinc-800">
											{formatBoolean(tx.is_cross_bank)}
										</td>
										<td className="border-b border-zinc-200 px-2 py-1.5 dark:border-zinc-800">
											{formatBoolean(tx.is_cross_currency)}
										</td>
										<td className="border-b border-zinc-200 px-2 py-1.5 dark:border-zinc-800">
											{formatBoolean(tx.is_self_transfer)}
										</td>
										<td className="border-b border-zinc-200 px-2 py-1.5 dark:border-zinc-800">
											{formatRiskScore(tx.fraud_risk_score)}
										</td>
									</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				</main>
			</div>

			<div className="fixed right-4 bottom-4 z-50">
				<div className="relative">
					<button
						type="button"
						className="flex items-center gap-2 rounded-md bg-[#712cf9] px-3 py-2 text-sm font-semibold text-white shadow"
						aria-expanded={themeMenuOpen}
						aria-label={`Toggle theme (${theme})`}
						onClick={() => setThemeMenuOpen((open) => !open)}
					>
						{theme === "light" ? <SunIcon /> : null}
						{theme === "dark" ? <MoonIcon /> : null}
						{theme === "auto" ? <HalfCircleIcon /> : null}
					</button>
					{themeMenuOpen ? (
						<ul className="absolute right-0 bottom-full mb-2 w-36 overflow-hidden rounded-md border border-zinc-200 bg-white py-1 text-sm text-zinc-800 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
							{[
								{ value: "light", label: "Light", icon: <SunIcon /> },
								{ value: "dark", label: "Dark", icon: <MoonIcon /> },
								{ value: "auto", label: "Auto", icon: <HalfCircleIcon /> },
							].map((option) => (
								<li key={option.value}>
									<button
										type="button"
										className={`flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
											theme === option.value ? "font-semibold" : ""
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
					) : null}
				</div>
			</div>

			<Settings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
		</div>
	);
}
