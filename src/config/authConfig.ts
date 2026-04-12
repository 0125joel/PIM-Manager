import { Configuration, PopupRequest } from "@azure/msal-browser";

// Resolve Client ID at runtime.
// Priority: runtime config (self-hosted via Azure) → build-time env var (SaaS / local dev)
// During static export build (SSR context, typeof window === "undefined"), no Client ID is
// available — return a placeholder so the build succeeds. The real Client ID is always
// resolved in the browser before MSAL initialises.
function getClientId(): string {
    if (typeof window !== "undefined") {
        const runtimeClientId = (window as Window & { __PIM_CONFIG__?: { clientId?: string } }).__PIM_CONFIG__?.clientId;
        if (runtimeClientId) return runtimeClientId;
        const envClientId = process.env.NEXT_PUBLIC_CLIENT_ID;
        if (envClientId) return envClientId;
        throw new Error(
            "CRITICAL: Client ID not configured. " +
            "Self-hosted: ensure env-config.js contains a valid clientId. " +
            "Local dev: set NEXT_PUBLIC_CLIENT_ID in .env.local."
        );
    }
    return process.env.NEXT_PUBLIC_CLIENT_ID ?? "00000000-0000-0000-0000-000000000000";
}

export const msalConfig: Configuration = {
    auth: {
        clientId: getClientId(),
        authority: "https://login.microsoftonline.com/organizations",
        redirectUri: typeof window !== "undefined" ? window.location.origin : (process.env.NEXT_PUBLIC_REDIRECT_URI || "http://localhost:3000"),
    },
    cache: {
        cacheLocation: "sessionStorage", // This configures where your cache will be stored
        storeAuthStateInCookie: false, // Set this to "true" if you are having issues on IE11 or Edge
    },
};

// Scopes for initial login - Read-only permissions for Report functionality
// Following least privilege principle with granular permissions
export const loginRequest: PopupRequest = {
    scopes: [
        // User profile
        "User.Read",

        // Role Management
        "RoleManagement.Read.Directory",
        "RoleAssignmentSchedule.Read.Directory",
        "RoleEligibilitySchedule.Read.Directory",

        // PIM Policies (granular instead of Policy.Read.All)
        "RoleManagementPolicy.Read.Directory",

        // Authentication Contexts for CA policies
        "Policy.Read.ConditionalAccess",

        // Directory objects (granular instead of Directory.Read.All)
        "User.Read.All",
        "Group.Read.All",
        "AdministrativeUnit.Read.All",
        "Application.Read.All"
    ],
};

export const graphConfig = {
    graphMeEndpoint: "https://graph.microsoft.com/v1.0/me",
};
