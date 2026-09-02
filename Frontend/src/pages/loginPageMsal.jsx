import { useEffect, useState } from "react";
import { useMsal, useIsAuthenticated } from "@azure/msal-react";
import { loginRequest } from "../auth/authConfig";
import qDetectLogo from "../assets/qdetect-logo.png";

export default function LogPageMsal() {
  const { instance, inProgress } = useMsal();
  const isAuthenticated = useIsAuthenticated();
  const [loginError, setLoginError] = useState(null);

  // Already signed in → go to dashboard
  useEffect(() => {
    if (isAuthenticated) {
      window.location.hash = "#dashboard";
    }
  }, [isAuthenticated]);

  // Debug: shows in console whether an account is actually stored
  useEffect(() => {
    console.log("ACCOUNTS:", instance.getAllAccounts());
  }, [instance, isAuthenticated]);

  const handleLogin = () => {
  setLoginError(null);
  console.log("LOGIN CLICKED");

  // ---- MSAL DIAGNOSTICS ----------------------------------------
  const authConfig = instance.getConfiguration().auth;

  // JSON.stringify exposes hidden chars (\r, quotes, trailing spaces)
  console.log("AUTHORITY (raw):", JSON.stringify(authConfig.authority));
  console.log("KNOWN AUTHORITIES:", JSON.stringify(authConfig.knownAuthorities));
  console.log("CLIENT ID:", JSON.stringify(authConfig.clientId));
  console.log("REDIRECT URI:", JSON.stringify(authConfig.redirectUri));

  // The exact URL MSAL must fetch to resolve endpoints — try this in a browser tab
  const base = authConfig.authority.endsWith("/")
    ? authConfig.authority
    : authConfig.authority + "/";
  console.log("EXPECTED DISCOVERY URL:", `${base}v2.0/.well-known/openid-configuration`);

  console.log("ENV VALUES:", {
    clientId: JSON.stringify(import.meta.env.VITE_MSAL_CLIENT_ID),
    tenantId: JSON.stringify(import.meta.env.VITE_MSAL_TENANT_ID),
    redirectUri: JSON.stringify(import.meta.env.VITE_MSAL_REDIRECT_URI),
  });
  // ---------------------------------------------------------------

  instance
    .loginPopup(loginRequest)
    .then((response) => {
      console.log("LOGIN SUCCESS:", response.account?.username);
      console.log("TOKEN AUTHORITY USED:", response.authority);
      window.location.hash = "#dashboard";
    })
    .catch((error) => {
      if (error.errorCode === "user_cancelled") return;

      // Full error anatomy — errorMessage often truncates the useful part
      console.log("LOGIN ERROR CODE:", error.errorCode);
      console.log("LOGIN ERROR MESSAGE:", error.errorMessage);
      console.log("LOGIN ERROR NAME:", error.name);           // ClientConfigurationError vs ClientAuthError vs ServerError
      console.log("LOGIN ERROR SUBERROR:", error.subError);
      console.log("LOGIN ERROR FULL:", error);                 // expand in console for stack + everything else
      setLoginError(error.errorMessage || "Sign-in failed. Try again.");
    });
};

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
          style={{ fontFamily: '"Inter", sans-serif' }}
        >
          Q-Detect
        </h1>

        <section className="w-full rounded-[12px] border border-[#E3E3E3] bg-white px-3 py-3">
          <div className="flex flex-col gap-3">
            <p className="text-[11px] text-[#555555]">
              Sign in with your organisation account 
            </p>

            <button
              type="button"
              onClick={handleLogin}
              disabled={inProgress !== "none"}
              className="h-6 w-full rounded-[4px] bg-[#2F2F2F] text-[11px] font-normal text-white transition-colors hover:bg-[#1f1f1f] disabled:opacity-50"
            >
              {inProgress !== "none" ? "Signing in..." : "Sign in with Microsoft"}
            </button>

            {loginError && (
              <p className="text-[11px] leading-snug text-[#B91C1C]">
                {loginError}
              </p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}