import { InteractionRequiredAuthError } from "@azure/msal-browser";
import { apiScope, apiTokenRequest } from "./authConfig";
import { msalInstance } from "./hooks/auth-provider";

/** Set before acquireTokenRedirect so a failed consent does not redirect forever. */
const API_TOKEN_REDIRECT_KEY = "qdetect.apiTokenRedirect";
/** Entra's own message from the last failure. Survives the redirect. */
const API_TOKEN_ERROR_KEY = "qdetect.apiTokenError";

/** One in-flight request. Strict Mode mounts effects twice; both must share this. */
let pending = null;

/**
 * Ask Entra for an access token whose audience is the Q-Detect API.
 * Login stores the account. This call is what returns the API JWT.
 *
 * Silent first (cache, then refresh). If Entra rejects the refresh token,
 * redirect — same flow as Sign in. acquireTokenPopup from useEffect is blocked
 * and throws popup_window_error, because it is not a click.
 */
export function getAccessToken() {
  if (pending) return pending;
  pending = acquireApiToken().finally(() => {
    pending = null;
  });
  return pending;
}

async function acquireApiToken() {
  if (!apiScope) {
    throw new Error(
      "Set VITE_QDETECT_API_CLIENT_ID in Frontend/.env to your API app's client ID."
    );
  }

  const account =
    msalInstance.getActiveAccount() ?? msalInstance.getAllAccounts()[0];

  if (!account) {
    return null;
  }

  const request = { ...apiTokenRequest, account };

  try {
    const response = await acquireSilent(request);
    sessionStorage.removeItem(API_TOKEN_REDIRECT_KEY);
    sessionStorage.removeItem(API_TOKEN_ERROR_KEY);
    return response.accessToken;
  } catch (error) {
    if (needsInteraction(error)) {
      if (error instanceof InteractionRequiredAuthError) {
        rememberMsalError(error);
      }
      return redirectForApiToken(request);
    }
    if (error?.errorCode === "interaction_in_progress") {
      return null;
    }
    throw error;
  }
}

/** Hidden-frame failures. These are not InteractionRequiredAuthError, but the
 *  token still is not in the cache, so the user has to sign in again. */
const SILENT_FRAME_ERRORS = new Set([
  "timed_out",
  "monitor_window_timeout",
  "block_iframe_reload",
  "iframe_closed",
]);

function needsInteraction(error) {
  return (
    error instanceof InteractionRequiredAuthError ||
    SILENT_FRAME_ERRORS.has(error?.errorCode)
  );
}

function acquireSilent(request) {
  return msalInstance.acquireTokenSilent(request);
}

function rememberMsalError(error) {
  const text = error?.errorMessage || error?.message;
  if (text) sessionStorage.setItem(API_TOKEN_ERROR_KEY, text);
}

async function redirectForApiToken(request) {
  if (sessionStorage.getItem(API_TOKEN_REDIRECT_KEY) === "1") {
    sessionStorage.removeItem(API_TOKEN_REDIRECT_KEY);
    const entra = sessionStorage.getItem(API_TOKEN_ERROR_KEY);
    throw new Error(
      entra
        ? `Entra rejected the API token: ${entra}`
        : `Entra did not issue ${apiScope}. On the API app, Expose an API must define access_as_user, and this SPA must be granted that permission.`
    );
  }

  sessionStorage.setItem(API_TOKEN_REDIRECT_KEY, "1");
  try {
    await msalInstance.acquireTokenRedirect(request);
  } catch (error) {
    sessionStorage.removeItem(API_TOKEN_REDIRECT_KEY);
    if (error?.errorCode === "interaction_in_progress") return null;
    throw error;
  }
  // The browser is leaving for Entra. Keep this promise pending so the
  // dashboard does not flash the sample-data error during the redirect.
  return new Promise(() => {});
}
