import { Configuration, PopupRequest } from "@azure/msal-browser";

// Ensure required environment variables are set
if (!process.env.NEXT_PUBLIC_CLIENT_ID) {
    throw new Error(
        "CRITICAL: NEXT_PUBLIC_CLIENT_ID environment variable is required. " +
        "Please configure this in your .env.local file. See README.md for setup instructions."
    );
}

export const msalConfig: Configuration = {
    auth: {
        clientId: process.env.NEXT_PUBLIC_CLIENT_ID,
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
