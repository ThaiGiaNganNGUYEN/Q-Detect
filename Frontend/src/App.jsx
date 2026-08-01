import { useEffect, useState } from "react";
import LogIn from "./pages/login";
import Register from "./pages/register";

export default function App() {
	const [view, setView] = useState(() => window.location.hash || "#login");

	useEffect(() => {
		const handleHashChange = () => {
			setView(window.location.hash || "#login");
		};

		handleHashChange();
		window.addEventListener("hashchange", handleHashChange);

		return () => window.removeEventListener("hashchange", handleHashChange);
	}, []);

	if (view === "#register") {
		return <Register />;
	}

	return <LogIn />;
}