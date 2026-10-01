import { InteractionRequiredAuthError } from "@azure/msal-browser";
import { apiScope, apiTokenRequest } from "./authConfig";
import { msalInstance } from "./hooks/auth-provider";

/**
 * Ask Entra for an access token whose audience is the Q-Detect API.
 * Login stores the account. This call is what returns the API JWT.
 */
export async function getAccessToken() {
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
    const response = await msalInstance.acquireTokenSilent(request);
    return response.accessToken;
  } catch (error) {
    if (error instanceof InteractionRequiredAuthError) {
      const response = await msalInstance.acquireTokenPopup(request);
      return response.accessToken;
    }
    throw error;
  }
}
