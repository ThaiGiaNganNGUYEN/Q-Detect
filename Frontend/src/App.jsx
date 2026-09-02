import { useEffect, useState } from "react";
import { useMsal, MsalProvider } from "@azure/msal-react";
import { useIsAuthenticated } from "@azure/msal-react"; // 🟦 Microsoft
import LogPageMsal from "./pages/loginPageMsal";
import Register from "./pages/register";
import Home from "./pages/home";

export default function App() {
    // 🟦 Microsoft: true once MSAL has a signed-in account
    const isAuthenticated = useIsAuthenticated();

    // 🟦 Microsoft: inProgress tells us if MSAL is still starting up /
    // processing a login. Prevents a "flash" of the login page on refresh.
    const { inProgress } = useMsal();

    // ⚛️ React: hash-based routing state (your original pattern)
    const [view, setView] = useState(() => window.location.hash || "#login");

    useEffect(() => {
        const handleHashChange = () => {
            setView(window.location.hash || "#login");
        };
        handleHashChange();
        window.addEventListener("hashchange", handleHashChange);
        return () => window.removeEventListener("hashchange", handleHashChange);
    }, []);

    // 1️⃣ Wait for MSAL to finish initializing (checking cache, handling redirects).
    // Without this, a signed-in user briefly sees the login page on every refresh.
    if (inProgress === "startup" || inProgress === "handleRedirect") {
        return (
            <main className="min-h-screen flex items-center justify-center">
                <p className="text-sm text-[#555555]">Loading…</p>
            </main>
        );
    }

    // 2️⃣ Auth guard: signed-out users can ONLY see login or register.
    // Typing #dashboard in the URL no longer bypasses authentication.
    if (!isAuthenticated) {
        if (view === "#register") return <Register />;
        return <LogPageMsal />;
    }

    // 3️⃣ Signed-in routing.
    if (view === "#home" || view === "#dashboard" || view === "#settings") {
        return <Home />;
    }

    // Signed in but sitting on #login/#register/unknown → send to dashboard.
    // ⚛️ React rule: side effects (changing the URL) shouldn't happen during
    // render, so we do it once here and render Home directly.
    window.location.hash = "#dashboard";
    return <Home />;
}