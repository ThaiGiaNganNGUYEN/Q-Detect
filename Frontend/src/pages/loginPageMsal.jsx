import { useEffect, useState } from "react";
import { useMsal, useIsAuthenticated } from "@azure/msal-react";
import { EventType } from "@azure/msal-browser";
import { loginRequest } from "../auth/authConfig";
import qDetectLogo from "../assets/qdetect-logo.png";

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