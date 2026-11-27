import { getEntraGroupUrl } from "@/utils/groupsOutsidePim";

/** Links from a report to the Entra admin center and the Azure portal. Pure: the callers decide when a link is shown. */

export function getEntraUserUrl(userId: string): string {
    return `https://entra.microsoft.com/#view/Microsoft_AAD_UsersAndTenants/UserProfileMenuBlade/~/overview/userId/${encodeURIComponent(userId)}`;
}

/** An application (service principal of type Application). The portal shows an error without the appId. */
export function getEntraAppUrl(objectId: string, appId: string): string {
    return `https://entra.microsoft.com/#view/Microsoft_AAD_IAM/ManagedAppMenuBlade/~/Overview/objectId/${encodeURIComponent(objectId)}/appId/${encodeURIComponent(appId)}`;
}

/** null for "/" or an empty id. The slashes of the ARM scope id stay; each segment is encoded. */
export function getAzureScopeUrl(scopeId: string): string | null {
    if (!scopeId || scopeId === "/") return null;
    const path = scopeId.split("/").map((segment) => encodeURIComponent(segment)).join("/");
    return `https://portal.azure.com/#@/resource${path}`;
}

/** The Entra link of a principal from a report row, or null when there is none (managed identities, agent objects, foreign groups, unknown principals). */
export function getPrincipalUrl(principal: { kind: "user" | "guest" | "group" | "app" | string; id: string; appId?: string | null }): string | null {
    if (!principal.id) return null;
    switch (principal.kind) {
        case "user":
        case "guest":
            return getEntraUserUrl(principal.id);
        case "group":
            return getEntraGroupUrl(principal.id);
        case "app":
            return principal.appId ? getEntraAppUrl(principal.id, principal.appId) : null;
        default:
            return null;
    }
}

/**
 * The Entra link of an Azure assignment's principal. Service principals link only when the read says they are
 * Application objects and their appId is known. The maps are keyed by lowercase object id.
 */
export function getAzurePrincipalUrl(principalType: string, principalId: string, spTypes?: ReadonlyMap<string, string> | null, spAppIds?: ReadonlyMap<string, string> | null): string | null {
    if (!principalId) return null;
    switch (principalType) {
        case "User":
            return getEntraUserUrl(principalId);
        case "Group":
            return getEntraGroupUrl(principalId);
        case "ServicePrincipal": {
            const key = principalId.toLowerCase();
            if (spTypes?.get(key) !== "Application") return null;
            const appId = spAppIds?.get(key);
            return appId ? getEntraAppUrl(principalId, appId) : null;
        }
        default:
            return null;
    }
}
