import React from "react";
import ReactDOM from "react-dom/client";
import { PublicClientApplication } from "@azure/msal-browser"; // 🟦 Microsoft
import { MsalProvider } from "@azure/msal-react";              // 🟦 Microsoft
import { msalConfig } from "./auth/authConfig";
import { AuthProvider, useAuthProvider} from "./auth/hooks/auth-provider";
import App from "./App";
import "./index.css";

// 🟦 Create ONE instance for the whole app — never inside a component,
// or it would be recreated on every render.
const authprovider = useAuthProvider();

// 🟦 initialize() is required in MSAL v3+ before any other MSAL call
// await msalInstance.initialize();

ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
        <AuthProvider>
            <App />
        </AuthProvider>
    </React.StrictMode>
);