import { useEffect, useState } from "react";
import qDetectLogo from "../assets/qdetect-logo.png";
import Settings from "./settings";

const GRAPHS = [
	{ id: "A", name: "Graph A", risk: 89, status: "Status" },
	{ id: "B", name: "Graph B", risk: 95, status: "Status" },
	{ id: "C", name: "Graph C", risk: 87, status: "Status" },
	{ id: "D", name: "Graph D", risk: 96, status: "Status" },
	{ id: "E", name: "Graph E", risk: 88, status: "Status" },
	{ id: "F", name: "Graph F", risk: 97, status: "Status" },
	{ id: "G", name: "Graph G", risk: 73, status: "Status" },
	{ id: "H", name: "Graph H", risk: 89, status: "Status" },
];

const SAMPLE_ROWS = [
	["1,001", "placeholder", "placeholder", "placeholder", "placeholder"],
	["1,002", "placeholder", "placeholder", "placeholder", "placeholder"],
	["1,003", "placeholder", "placeholder", "placeholder", "placeholder"],
	["1,003", "placeholder", "placeholder", "placeholder", "placeholder"],
	["1,004", "placeholder", "placeholder", "placeholder", "placeholder"],
	["1,005", "placeholder", "placeholder", "placeholder", "placeholder"],
	["1,006", "placeholder", "placeholder", "placeholder", "placeholder"],
	["1,007", "placeholder", "placeholder", "placeholder", "placeholder"],
	["1,008", "placeholder", "placeholder", "placeholder", "placeholder"],
	["1,009", "placeholder", "placeholder", "placeholder", "placeholder"],
	["1,010", "placeholder", "placeholder", "placeholder", "placeholder"],
	["1,011", "placeholder", "placeholder", "placeholder", "placeholder"],
	["1,012", "placeholder", "placeholder", "placeholder", "placeholder"],
	["1,013", "placeholder", "placeholder", "placeholder", "placeholder"],
	["1,014", "placeholder", "placeholder", "placeholder", "placeholder"],
	["1,015", "placeholder", "placeholder", "placeholder", "placeholder"],
];

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
	const [selectedGraphId, setSelectedGraphId] = useState("A");
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

	const selectedGraph = GRAPHS.find((graph) => graph.id === selectedGraphId) ?? GRAPHS[0];
	const isDark = resolvedTheme === "dark";

	const sidebar = (
		<div className="flex h-full flex-col">
			<div className="flex items-center gap-2 px-3 pt-5 pb-3">
				<span className="text-2xl font-semibold tracking-wide">Dashboard</span>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
				<table className="w-full text-left text-xs">
					<thead>
						<tr className="text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
							<th className="px-2 py-2 font-medium">Graph</th>
							<th className="px-2 py-2 font-medium">Risk %</th>
							<th className="px-2 py-2 font-medium">Status</th>
						</tr>
					</thead>
					<tbody>
						{GRAPHS.map((graph) => {
							const selected = graph.id === selectedGraphId;
							return (
								<tr
									key={graph.id}
									className={`cursor-pointer border-t border-zinc-200/70 dark:border-zinc-700/70 ${
										selected
											? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
											: "text-zinc-700 hover:bg-zinc-200/70 dark:text-zinc-300 dark:hover:bg-zinc-800"
									}`}
									onClick={() => setSelectedGraphId(graph.id)}
								>
									<td className="px-2 py-2 font-medium">{graph.name}</td>
									<td className="px-2 py-2">{graph.risk}%</td>
									<td className="px-2 py-2">{graph.status}</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
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
										className="flex w-full items-center gap-2 px-3 py-2.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
										onClick={() => setNavMenuOpen(false)}
									>
										<DoorIcon />
										Sign out
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

				<main className="min-w-0 flex-1 px-3 py-3 sm:w-2/3 lg:w-5/6">
					<div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 pb-2 dark:border-zinc-800">
						<h1 className="text-2xl font-semibold">Selected: {selectedGraph.name}</h1>
						<div className="flex flex-wrap items-center gap-2">
							<div className="inline-flex overflow-hidden rounded border border-zinc-300 dark:border-zinc-700">
								<button
									type="button"
									className="border-r border-zinc-300 px-2.5 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
								>
									Mark as Safe
								</button>
								<button
									type="button"
									className="px-2.5 py-1 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
								>
									Mark as Fraud
								</button>
							</div>
							<button
								type="button"
								className="inline-flex items-center gap-1 rounded border border-zinc-300 px-2.5 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
							>
								Risk Score
							</button>
						</div>
					</div>

					<div className="my-4 flex h-[240px] w-full items-center justify-center rounded border border-zinc-300 bg-zinc-50 text-sm text-zinc-500 md:h-[380px] dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
						Graph placeholder
					</div>

					<h2 className="mb-2 text-xl font-semibold">Transaction Details</h2>
					<div className="overflow-x-auto text-sm">
						<table className="w-full min-w-[640px] border-collapse">
							<thead>
								<tr className="border-b border-zinc-300 text-left dark:border-zinc-700">
									<th className="px-2 py-1.5 font-semibold">Transaction Reference</th>
									<th className="px-2 py-1.5 font-semibold">From</th>
									<th className="px-2 py-1.5 font-semibold">To</th>
									<th className="px-2 py-1.5 font-semibold">Amount</th>
									<th className="px-2 py-1.5 font-semibold">Type</th>
								</tr>
							</thead>
							<tbody>
								{SAMPLE_ROWS.map((row, index) => (
									<tr
										key={`${row[0]}-${index}`}
										className={
											index % 2 === 0
												? "bg-zinc-50 dark:bg-zinc-900/60"
												: "bg-white dark:bg-zinc-950"
										}
									>
										{row.map((cell, cellIndex) => (
											<td key={cellIndex} className="border-b border-zinc-200 px-2 py-1.5 dark:border-zinc-800">
												{cell}
											</td>
										))}
									</tr>
								))}
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
