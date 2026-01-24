import { Client } from "@microsoft/microsoft-graph-client";
import { ScopeType, ScopeInfo } from "@/types/directoryRole.types";

/**
 * Detects the scope type based on directoryScopeId and appScopeId
 */
export function detectScopeType(directoryScopeId: string, appScopeId?: string): ScopeType {
    // Tenant-wide scope
    if (directoryScopeId === "/") {
        return "tenant-wide";
    }

    // Application-scoped
    if (appScopeId && appScopeId !== "/") {
        return "application";
    }

    // Administrative Unit (including RMAU)
    if (directoryScopeId.startsWith("/administrativeUnits/")) {
        // Will be determined as RMAU later when we fetch AU details
        return "administrative-unit";
    }

    // Specific object scope (e.g., /applications/{id}, /servicePrincipals/{id}, /users/{id})
    if (directoryScopeId !== "/" && !directoryScopeId.startsWith("/administrativeUnits/")) {
        return "specific-object";
    }

    return "unknown";
}

/**
 * Enriches scope information by fetching additional details from Graph API
 * Handles errors gracefully and returns basic info if fetch fails
 */
export async function enrichScopeInfo(
    client: Client,
    assignment: {
        directoryScopeId: string;
        appScopeId?: string;
        directoryScope?: any;
    }
): Promise<ScopeInfo> {
    const { directoryScopeId, appScopeId, directoryScope } = assignment;
    const baseType = detectScopeType(directoryScopeId, appScopeId);

    // Tenant-wide - no enrichment needed
    if (baseType === "tenant-wide") {
        return {
            type: "tenant-wide",
            displayName: "Tenant-wide",
            id: "/"
        };
    }

    // If directoryScope is already expanded, use it
    if (directoryScope?.displayName) {
        // Check if it's an RMAU by fetching AU details
        if (baseType === "administrative-unit") {
            try {
                const auId = directoryScopeId.replace("/administrativeUnits/", "");
                const au = await client
                    .api(`/directory/administrativeUnits/${auId}`)
                    .select("id,displayName,isMemberManagementRestricted")
                    .get();

                return {
                    type: au.isMemberManagementRestricted ? "rmau" : "administrative-unit",
                    displayName: au.displayName,
                    id: auId,
                    isRestricted: au.isMemberManagementRestricted
                };
            } catch (error) {
                console.warn(`Failed to fetch AU details for ${directoryScopeId}:`, error);
                return {
                    type: "administrative-unit",
                    displayName: directoryScope.displayName,
                    id: directoryScopeId
                };
            }
        }

        return {
            type: baseType,
            displayName: directoryScope.displayName,
            id: directoryScopeId
        };
    }

    // Application-scoped - fetch application details
    if (baseType === "application") {
        try {
            const appId = appScopeId?.replace("/", "") || "";

            // Try to parse as application or service principal
            if (directoryScopeId.startsWith("/applications/")) {
                const objectId = directoryScopeId.replace("/applications/", "");
                const app = await client
                    .api(`/applications/${objectId}`)
                    .select("id,displayName,appId")
                    .get();

                return {
                    type: "application",
                    displayName: app.displayName,
                    id: objectId
                };
            } else if (directoryScopeId.startsWith("/servicePrincipals/")) {
                const objectId = directoryScopeId.replace("/servicePrincipals/", "");
                const sp = await client
                    .api(`/servicePrincipals/${objectId}`)
                    .select("id,displayName,appId")
                    .get();

                return {
                    type: "application",
                    displayName: sp.displayName,
                    id: objectId
                };
            } else {
                // Generic object ID
                const objectId = directoryScopeId.replace("/", "");
                return {
                    type: "application",
                    displayName: `Application (${objectId.substring(0, 8)}...)`,
                    id: objectId
                };
            }
        } catch (error) {
            console.warn(`Failed to fetch application details for ${directoryScopeId}:`, error);
            return {
                type: "application",
                displayName: `Application (${directoryScopeId})`,
                id: directoryScopeId
            };
        }
    }

    // Administrative Unit - fetch AU details
    if (baseType === "administrative-unit") {
        try {
            const auId = directoryScopeId.replace("/administrativeUnits/", "");
            const au = await client
                .api(`/directory/administrativeUnits/${auId}`)
                .select("id,displayName,isMemberManagementRestricted")
                .get();

            return {
                type: au.isMemberManagementRestricted ? "rmau" : "administrative-unit",
                displayName: au.displayName,
                id: auId,
                isRestricted: au.isMemberManagementRestricted
            };
        } catch (error) {
            console.warn(`Failed to fetch AU details for ${directoryScopeId}:`, error);
            return {
                type: "administrative-unit",
                displayName: `Administrative Unit (${directoryScopeId})`,
                id: directoryScopeId
            };
        }
    }

    // Specific object - try to fetch details
    if (baseType === "specific-object") {
        const objectId = directoryScopeId.replace("/", "");
        return {
            type: "specific-object",
            displayName: `Object (${objectId.substring(0, 8)}...)`,
            id: objectId
        };
    }

    // Unknown
    return {
        type: "unknown",
        displayName: directoryScopeId,
        id: directoryScopeId
    };
}

/**
 * Returns a human-readable scope display name
 */
export function getScopeDisplayName(scopeInfo: ScopeInfo): string {
    if (!scopeInfo) return "Unknown";

    switch (scopeInfo.type) {
        case "tenant-wide":
            return "Tenant-wide";
        case "application":
            return `Application: ${scopeInfo.displayName || "Unknown"}`;
        case "administrative-unit":
            return `Administrative Unit: ${scopeInfo.displayName || "Unknown"}`;
        case "rmau":
            return `RMAU: ${scopeInfo.displayName || "Unknown"}`;
        case "specific-object":
            return `Object: ${scopeInfo.displayName || "Unknown"}`;
        default:
            return scopeInfo.displayName || "Unknown";
    }
}

/**
 * Returns color class for scope type badge
 */
export function getScopeColorClass(scopeType: ScopeType): string {
    switch (scopeType) {
        case "tenant-wide":
            return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
        case "application":
            return "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400";
        case "administrative-unit":
            return "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400";
        case "rmau":
            return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
        case "specific-object":
            return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
        default:
            return "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-400";
    }
}
