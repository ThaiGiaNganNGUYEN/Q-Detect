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
import { getAccessToken } from "./auth/getAccessToken";


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
            <UnauthenticatedTemplate>
                {view === "#register" ? <Register /> : <LogPageMsal />}
            </UnauthenticatedTemplate>

            <AuthenticatedTemplate>
                <WarmAccessToken />
                <SignedInRouter view={view} />
            </AuthenticatedTemplate>
        </>
    );
}

function WarmAccessToken() {
    useEffect(() => {
        getAccessToken()
            .then((token) => {
                if (!import.meta.env.DEV || !token) return;
                const payload = token.split(".")[1];
                const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
                const claims = JSON.parse(json);
                console.info("API JWT ready", { aud: claims.aud, scp: claims.scp, exp: claims.exp });
            })
            .catch((error) => {
                console.error("API JWT failed", error.message || error);
            });
    }, []);
    return null;
}

function SignedInRouter({ view }) {
    useEffect(() => {
        if (view !== "#home" && view !== "#dashboard" && view !== "#settings") {
            window.location.hash = "#dashboard";
        }
    }, [view]);
    return <Home />;
}