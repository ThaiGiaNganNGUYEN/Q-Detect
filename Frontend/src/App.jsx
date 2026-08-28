import { useEffect, useState } from "react";
import LogIn from "./pages/login";
import Register from "./pages/register";
import Home from "./pages/home";

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

	if (view === "#home" || view === "#dashboard" || view === "#settings") {
		return <Home />;
	}

	return <LogIn />;
}
