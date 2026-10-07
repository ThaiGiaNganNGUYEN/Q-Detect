import { useEffect, useState } from "react";
import { useMsal, useIsAuthenticated } from "@azure/msal-react";
import { EventType } from "@azure/msal-browser";
import { loginRequest } from "../auth/authConfig";
import { AuthShell } from "../components/Brand";

export default function LogPageMsal() {
  const { instance, inProgress, accounts } = useMsal();
  const isAuthenticated = useIsAuthenticated();
  const [loginError, setLoginError] = useState(null);

  // Already signed in → go to dashboard
  useEffect(() => {
    if (isAuthenticated) {
      window.location.hash = "#dashboard";
    }
  }, [isAuthenticated]);

  useEffect(() => {
    console.log("ACCOUNTS:", accounts, instance.getAllAccounts());
  }, [instance, accounts, isAuthenticated]);

  useEffect(() => {
    const id = instance.addEventCallback((event) => {
      if (event.eventType === EventType.LOGIN_FAILURE) {
        const message =
          event.error?.errorMessage || event.error?.message || "Sign-in failed.";
        setLoginError(message);
      }
    });
    return () => {
      if (id) instance.removeEventCallback(id);
    };
  }, [instance]);

  const handleLogin = () => {
    setLoginError(null);
    instance.loginRedirect(loginRequest).catch((error) => {
      if (error.errorCode === "user_cancelled") return;
      setLoginError(error.errorMessage || "Sign-in failed. Try again.");
    });
  };

  return (
    <AuthShell title="Welcome back" subtitle="Sign in with your organisation account to continue.">
      <div className="flex flex-col gap-4">
        <button
          type="button"
          onClick={handleLogin}
          disabled={inProgress !== "none"}
          className="flex h-12 w-full items-center justify-center gap-3 rounded-lg bg-ink text-sm font-semibold text-white shadow-sm transition-colors hover:bg-ink-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <MicrosoftIcon />
          {inProgress !== "none" ? "Signing in..." : "Sign in with Microsoft"}
        </button>

        {loginError && (
          <p
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm leading-snug text-red-700"
            role="alert"
          >
            {loginError}
          </p>
        )}

        <p className="flex items-center gap-2 text-xs text-zinc-500">
          <span className="h-2 w-2 rounded-full bg-brand" aria-hidden="true" />
          Secured with Microsoft Entra ID single sign-on
        </p>
      </div>
    </AuthShell>
  );
}

function MicrosoftIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}