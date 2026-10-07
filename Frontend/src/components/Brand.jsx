import qDetectLogo from "../assets/qdetect-logo.png";

export function Wordmark({ className = "", logo = true, logoClassName = "h-9 w-9" }) {
	return (
		<span className={`inline-flex items-center gap-2.5 font-bold tracking-tight ${className}`}>
			{logo ? <img src={qDetectLogo} alt="" className={`${logoClassName} rounded-full object-cover`} /> : null}
			<span>Q-Detect</span>
		</span>
	);
}

export function AuthShell({ title, subtitle, children }) {
	return (
		<main className="relative flex min-h-screen flex-col overflow-hidden bg-ink text-ink">
			<div
				className="pointer-events-none absolute -right-48 -bottom-48 h-[48rem] w-[48rem] rounded-full bg-brand/20 blur-3xl"
				aria-hidden="true"
			/>
			<div
				className="pointer-events-none absolute -top-64 -left-64 h-[36rem] w-[36rem] rounded-full bg-brand-800/25 blur-3xl"
				aria-hidden="true"
			/>

			<section className="relative flex flex-1 flex-col items-center justify-center px-6 py-12">
				<Wordmark className="mb-10 text-5xl text-white" logoClassName="h-20 w-20" />

				<div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-2xl sm:p-10">
					<h1 className="text-3xl font-bold tracking-tight">{title}</h1>
					{subtitle ? <p className="mt-2 text-sm text-zinc-500">{subtitle}</p> : null}
					<div className="mt-8 text-left">{children}</div>
				</div>
			</section>

			<footer className="relative pb-6 text-center text-xs text-zinc-500">
				© {new Date().getFullYear()} Q-Detect
			</footer>
		</main>
	);
}
