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


export default function App() {
    const { inProgress } = useMsal();
    const [view, setView] = useState(() => window.location.hash || "#login");

    useEffect(() => {
        const handleHashChange = () => setView(window.location.hash || "#login");
        handleHashChange();
        window.addEventListener("hashchange", handleHashChange);
        return () => window.removeEventListener("hashchange", handleHashChange);
    }, []);

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
            {/* 2️⃣ replaced: was `if (!isAuthenticated)` */}
            <UnauthenticatedTemplate>
                {view === "#register" ? <Register /> : <LogPageMsal />}
            </UnauthenticatedTemplate>

            {/* 2️⃣ + 3️⃣: signed-in world */}
            <AuthenticatedTemplate>
                <SignedInRouter view={view} />
            </AuthenticatedTemplate>
        </>
    );
}

// 3️⃣ unchanged — routing logic, extracted for clarity
function SignedInRouter({ view }) {
    if (view === "#home" || view === "#dashboard" || view === "#settings") {
        return <Home />;
    }
    // Signed in but on #login/#register/unknown → normalize the URL.
    // Now safe to do properly: this component only mounts when authenticated.
    useEffect(() => {
        window.location.hash = "#dashboard";
    }, []);
    return <Home />;
}