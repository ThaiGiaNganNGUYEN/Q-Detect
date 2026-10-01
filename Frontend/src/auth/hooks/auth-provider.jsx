import { MsalProvider } from '@azure/msal-react';
import { PublicClientApplication, EventType } from '@azure/msal-browser';
import { msalConfig } from '../authConfig';

/**
 * One PublicClientApplication for the whole app. Module scope, not inside
 * the component — a new instance on every render would drop the token cache.
 */
export const msalInstance = new PublicClientApplication(msalConfig);

msalInstance.addEventCallback((event) => {
    if (event.eventType === EventType.LOGIN_SUCCESS && event.payload.account) {
        msalInstance.setActiveAccount(event.payload.account);
    }
});

/**
 * MSAL v3+ must initialize() before getAllAccounts / handleRedirectPromise.
 * Entra returns to /redirect with ?code= — this call exchanges it and stores the account.
 */
export async function initializeMsal() {
    await msalInstance.initialize();

    const result = await msalInstance.handleRedirectPromise();
    if (result?.account) {
        msalInstance.setActiveAccount(result.account);
    } else if (!msalInstance.getActiveAccount()) {
        const accounts = msalInstance.getAllAccounts();
        if (accounts.length > 0) {
            msalInstance.setActiveAccount(accounts[0]);
        }
    }

    if (window.location.pathname === '/redirect') {
        const hash = msalInstance.getActiveAccount() ? '#dashboard' : '#login';
        window.history.replaceState({}, document.title, `/${hash}`);
    }
}

export const AuthProvider = ({ children }) => {
    return <MsalProvider instance={msalInstance}>
                {children}
            </MsalProvider>;
}
