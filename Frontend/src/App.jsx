import { useEffect, useState } from "react";
import { Button } from "react-bootstrap";
import { AuthenticatedTemplate, UnauthenticatedTemplate } from "@azure/msal-react";
import { InteractionStatus } from "@azure/msal-browser";
import { loginRequest } from "./auth/authConfig";
import { useMsal, MsalProvider } from "@azure/msal-react";
import { useIsAuthenticated } from "@azure/msal-react"; // 🟦 Microsoft
import LogPageMsal from "./pages/loginPageMsal";
import Register from "./pages/register";
import Home from "./pages/home";

// Dev-only login bypass. import.meta.env.DEV is false in production builds,
// so this can never skip login on a deployed site.
const DEV_BYPASS_AUTH =
    import.meta.env.DEV && import.meta.env.VITE_DEV_BYPASS_AUTH === "true";

export default function App() {
    const { inProgress } = useMsal();
    const [view, setView] = useState(() => window.location.hash || "#login");

    useEffect(() => {
        const handleHashChange = () => setView(window.location.hash || "#login");
        handleHashChange();
        window.addEventListener("hashchange", handleHashChange);
        return () => window.removeEventListener("hashchange", handleHashChange);
    }, []);

    if (DEV_BYPASS_AUTH) {
        return <SignedInRouter view={view} />;
    }

    // 1️⃣ Keep this — templates hide content during startup, but render
    // nothing. You want "Loading…", not a blank screen.
    if (inProgress === InteractionStatus.Startup || inProgress === InteractionStatus.HandleRedirect) {
        return (
            <main className="min-h-screen flex items-center justify-center">
                <p className="text-sm text-[#555555]">Loading…</p>
            </main>
        );
    }

    return (
        <>
            <UnauthenticatedTemplate>
                {view === "#register" ? <Register /> : <LogPageMsal />}
            </UnauthenticatedTemplate>

            <AuthenticatedTemplate>
                <SignedInRouter view={view} />
            </AuthenticatedTemplate>
        </>
    );
}

function SignedInRouter({ view }) {
    if (view === "#home" || view === "#dashboard" || view === "#settings") {
        return <Home />;
    }
    useEffect(() => {
        window.location.hash = "#dashboard";
    }, []);
    return <Home />;
}