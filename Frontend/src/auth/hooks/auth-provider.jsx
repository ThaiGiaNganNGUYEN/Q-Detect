import { MsalProvider } from '@azure/msal-react';
import { PublicClientApplication, EventType } from '@azure/msal-browser';
import { msalConfig } from '../authConfig';

/**
 * One PublicClientApplication for the whole app. Module scope, not inside
 * the component — a new instance on every render would drop the token cache.
 */
export const msalInstance = new PublicClientApplication(msalConfig);

if (!msalInstance.getActiveAccount() && msalInstance.getAllAccounts().length > 0) {
    msalInstance.setActiveAccount(msalInstance.getAllAccounts()[0]);
}

msalInstance.addEventCallback((event) => {
    if (event.eventType === EventType.LOGIN_SUCCESS && event.payload.account) {
        msalInstance.setActiveAccount(event.payload.account);
    }
});

export const AuthProvider = ({ children }) => {
    return <MsalProvider instance={msalInstance}>
                {children}
            </MsalProvider>;
}

export function useAuthProvider() {
    return { AuthProvider };
}
