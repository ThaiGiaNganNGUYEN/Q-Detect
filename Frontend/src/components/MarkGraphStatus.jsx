export default function MarkGraphStatus({ status = "Pending", onMarkSafe, onMarkFraud }) {
	const isSafe = status === "Safe";
	const isFraud = status === "Fraud";

	return (
		<div className="inline-flex overflow-hidden rounded border border-zinc-300 dark:border-zinc-700">
			<button
				type="button"
				aria-pressed={isSafe}
				className={`border-r border-zinc-300 px-2.5 py-1 text-xs dark:border-zinc-700 ${
					isSafe
						? "bg-emerald-600 text-white"
						: "hover:bg-zinc-100 dark:hover:bg-zinc-800"
				}`}
				onClick={onMarkSafe}
			>
				Mark as Safe
			</button>
			<button
				type="button"
				aria-pressed={isFraud}
				className={`px-2.5 py-1 text-xs ${
					isFraud
						? "bg-red-600 text-white"
						: "hover:bg-zinc-100 dark:hover:bg-zinc-800"
				}`}
				onClick={onMarkFraud}
			>
				Mark as Fraud
			</button>
		</div>
	);
}
