import qDetectLogo from "../assets/qdetect-logo.png";

export default function LogIn() {
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
					style={{ fontFamily: '"Wallpoet", sans-serif' }}
				>
					Q-Detect
				</h1>

				<section className="w-full rounded-[12px] border border-[#E3E3E3] bg-white px-3 py-3">
					<form className="flex flex-col gap-3" onSubmit={(event) => event.preventDefault()}>
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

						<button
							type="submit"
							className="h-6 w-full rounded-[4px] bg-[#2F2F2F] text-[11px] font-normal text-white transition-colors hover:bg-[#1f1f1f]"
						>
							Log In
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