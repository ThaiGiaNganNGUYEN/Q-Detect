import { useMsal } from "@azure/msal-react";

// All logout behavior lives here. Components never talk to MSAL directly.
export function useLogout() {
  const { instance, inProgress } = useMsal();

  // Full logout: clears MSAL cache AND Microsoft's session cookie.
  const logout = () => {
    instance.logoutRedirect({
      account: instance.getActiveAccount(),
      postLogoutRedirectUri: "http://localhost:5173/",
    });
  };

  // Local-only logout: clears app session, keeps Microsoft cookie (SSO survives).
  // Never use on shared machines.
  const logoutLocalOnly = () => {
    instance.logoutRedirect({
      account: instance.getActiveAccount(),
      onRedirectNavigate: () => true,
    });
  };

  return { logout, logoutLocalOnly, isBusy: inProgress !== "none" };
}