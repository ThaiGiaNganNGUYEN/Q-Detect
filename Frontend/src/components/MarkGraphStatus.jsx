function CheckIcon() {
	return (
		<svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
			<path
				fillRule="evenodd"
				d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.6l7.3-7.3a1 1 0 0 1 1.4 0z"
			/>
		</svg>
	);
}

function FlagIcon() {
	return (
		<svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
			<path d="M4 2a1 1 0 0 1 1 1v.3l2.4-.6a6 6 0 0 1 3.6.2l.4.2a4 4 0 0 0 2.4.1l2-.5A1 1 0 0 1 17 3.7v8a1 1 0 0 1-.8 1l-2.4.6a6 6 0 0 1-3.6-.2l-.4-.2a4 4 0 0 0-2.4-.1L5 13.4V17a1 1 0 1 1-2 0V3a1 1 0 0 1 1-1z" />
		</svg>
	);
}

export default function MarkGraphStatus({ status = "Pending", onMarkSafe, onMarkFraud }) {
	const isSafe = status === "Safe";
	const isFraud = status === "Fraud";

	return (
		<div
			className="inline-flex gap-1 rounded-lg border border-zinc-200 bg-zinc-100 p-1 dark:border-ink-700 dark:bg-ink-800"
			role="group"
			aria-label="Case decision"
		>
			<button
				type="button"
				aria-pressed={isSafe}
				className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${
					isSafe
						? "bg-emerald-600 text-white shadow-sm"
						: "text-zinc-600 hover:bg-white hover:text-emerald-700 dark:text-zinc-300 dark:hover:bg-ink-700 dark:hover:text-emerald-400"
				}`}
				onClick={onMarkSafe}
			>
				<CheckIcon />
				Mark as Safe
			</button>
			<button
				type="button"
				aria-pressed={isFraud}
				className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${
					isFraud
						? "bg-red-600 text-white shadow-sm"
						: "text-zinc-600 hover:bg-white hover:text-red-700 dark:text-zinc-300 dark:hover:bg-ink-700 dark:hover:text-red-400"
				}`}
				onClick={onMarkFraud}
			>
				<FlagIcon />
				Mark as Fraud
			</button>
		</div>
	);
}
