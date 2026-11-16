import React from "react";
import ReactDOM from "react-dom/client";
import { AuthProvider, initializeMsal } from "./auth/hooks/auth-provider";
import App from "./App";
import "./index.css";

async function bootstrap() {
    try {
        await initializeMsal();
    } catch (error) {
        const text = error?.errorMessage || error?.message || String(error);
        sessionStorage.setItem("qdetect.apiTokenError", text);
        console.error("MSAL redirect failed:", text);
    }

    ReactDOM.createRoot(document.getElementById("root")).render(
        <React.StrictMode>
            <AuthProvider>
                <App />
            </AuthProvider>
        </React.StrictMode>
    );
}

bootstrap();
