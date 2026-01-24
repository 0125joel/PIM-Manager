import { Logger } from "@/utils/logger";
import { Client } from "@microsoft/microsoft-graph-client";
import { RoleDetailData } from "@/types/directoryRole.types";

/**
 * Service to handle Microsoft Graph Delta Queries for PIM resources.
 * Supports:
 * - Directory Roles (active assignments/enablement)
 * - Assignments (schedule instances) - *Planned for future*
 */

const STORAGE_DELTA_LINK_KEY = "pim_directory_roles_delta_link";

export interface DirectoryRoleDeltaChange {
    id: string;
    "@odata.type": string;
    isDeleted?: boolean;
    // Other properties depending on what changed (e.g., role assignments)
}

const STORAGE_GROUP_DELTA_LINK_KEY = "pim_groups_delta_link";

export interface GroupDeltaChange {
    id: string;
    displayName?: string;
    description?: string;
    isDeleted?: boolean;
    "@odata.type": string;
}

export interface DeltaResponse<T> {
    value: T[];
    "@odata.deltaLink"?: string;
    "@odata.nextLink"?: string;
}

/**
 * Gets the stored delta link from session storage.
 */
export const getStoredDeltaLink = (): string | null => {
    return sessionStorage.getItem(STORAGE_DELTA_LINK_KEY);
};

/**
 * Saves the delta link to session storage.
 */
export const saveDeltaLink = (deltaLink: string) => {
    sessionStorage.setItem(STORAGE_DELTA_LINK_KEY, deltaLink);
};

/**
 * Clears the stored delta link.
 */
export const clearDeltaLink = () => {
    sessionStorage.removeItem(STORAGE_DELTA_LINK_KEY);
};

/**
 * Fetches changes for Directory Roles using Delta Query.
 *
 * @param client Microsoft Graph Client
 * @param existingDeltaLink The delta link from the previous sync (optional)
 * @returns Object containing changes and the new delta link, or null if full sync needed.
 */
export const fetchDirectoryRoleDeltas = async (
    client: Client,
    existingDeltaLink?: string
): Promise<{ changes: DirectoryRoleDeltaChange[], newDeltaLink: string } | null> => {

    let currentLink = existingDeltaLink || "/directoryRoles/delta";
    let allChanges: DirectoryRoleDeltaChange[] = [];
    let newDeltaLink: string | undefined;

    // Sanity check: If passing a stored link, ensure it's a full URL.
    // If it's just the relative path "/directoryRoles/delta", Graph client handles it,
    // but stored links are usually absolute URLs.

    try {
        let hasMore = true;
        while (hasMore) {
            Logger.debug("DeltaService", `Fetching delta: ${currentLink.substring(0, 50)}...`);

            const response: DeltaResponse<DirectoryRoleDeltaChange> = await client
                .api(currentLink)
                .version("beta")
                // Note: Delta endpoint only supports limited properties. isBuiltIn/isPrivileged cause 400 errors.
                // We only need the ID to know which roles changed.
                .select("id,displayName,description")
                .get();

            if (response.value) {
                allChanges = [...allChanges, ...response.value];
            }

            if (response["@odata.nextLink"]) {
                currentLink = response["@odata.nextLink"];
            } else if (response["@odata.deltaLink"]) {
                newDeltaLink = response["@odata.deltaLink"];
                hasMore = false;
            } else {
                Logger.warn("DeltaService", "Graph response contained neither nextLink nor deltaLink. Stopping.");
                hasMore = false;
            }
        }

        if (newDeltaLink) {
            saveDeltaLink(newDeltaLink);
            return { changes: allChanges, newDeltaLink };
        }

        return null;
    } catch (error: unknown) {
        Logger.warn("DeltaService", "Delta Query failed:", error);

        // 410 Gone means the delta token expired or is invalid -> Full Sync Required
        const errorCode = (error as any).statusCode || (error as any).code;
        if (errorCode === 410 || errorCode === "ResyncRequired") {
            Logger.debug("DeltaService", "Delta token expired (410). Requiring full sync.");
            clearDeltaLink();
            return null; // Signal caller to do full sync
        }

        throw error;
    }
};

/**
 * Gets the stored group delta link.
 */
export const getStoredGroupDeltaLink = (): string | null => {
    return sessionStorage.getItem(STORAGE_GROUP_DELTA_LINK_KEY);
};

/**
 * Saves the group delta link.
 */
export const saveGroupDeltaLink = (deltaLink: string) => {
    sessionStorage.setItem(STORAGE_GROUP_DELTA_LINK_KEY, deltaLink);
};

/**
 * Clears the stored group delta link.
 */
export const clearGroupDeltaLink = () => {
    sessionStorage.removeItem(STORAGE_GROUP_DELTA_LINK_KEY);
};

/**
 * Fetches changes for Groups using Delta Query (/groups/delta).
 * Used to detect Renames and Deletions efficiently.
 */
export const fetchGroupDeltas = async (
    client: Client,
    existingDeltaLink?: string
): Promise<{ changes: GroupDeltaChange[], newDeltaLink: string } | null> => {
    let currentLink = existingDeltaLink || "/groups/delta";

    // If starting fresh, we might want to select only relevant fields to keep payload small
    // But delta often ignores select on initial sync or returns minimal set.
    // We strictly need: id, displayName, description, isDeleted
    if (!existingDeltaLink) {
        currentLink += "?$select=id,displayName,description";
    }

    let allChanges: GroupDeltaChange[] = [];
    let newDeltaLink: string | undefined;

    try {
        let hasMore = true;
        while (hasMore) {
            Logger.debug("DeltaService", `Fetching group delta: ${currentLink.substring(0, 50)}...`);

            const response: DeltaResponse<GroupDeltaChange> = await client
                .api(currentLink)
                .version("v1.0") // Groups delta is v1.0 GA
                .header("Prefer", "return-minimal") // Optional: optimization
                .get();

            if (response.value) {
                allChanges = [...allChanges, ...response.value];
            }

            if (response["@odata.nextLink"]) {
                currentLink = response["@odata.nextLink"];
            } else if (response["@odata.deltaLink"]) {
                newDeltaLink = response["@odata.deltaLink"];
                hasMore = false;
            } else {
                hasMore = false;
            }
        }

        if (newDeltaLink) {
            saveGroupDeltaLink(newDeltaLink);
            return { changes: allChanges, newDeltaLink };
        }

        return null;

    } catch (error: unknown) {
        Logger.warn("DeltaService", "Group Delta Query failed:", error);

        const errorCode = (error as any).statusCode || (error as any).code;
        if (errorCode === 410 || errorCode === "ResyncRequired") {
            Logger.debug("DeltaService", "Group Delta token expired. Requiring full sync.");
            clearGroupDeltaLink();
            return null;
        }
        throw error;
    }
};

/**
 * Identifies which Role IDs were affected by the delta changes.
 * This determines which policies need to be re-fetched.
 */
export const getAffectedRoleIds = (changes: DirectoryRoleDeltaChange[]): string[] => {
    const ids = new Set<string>();
    changes.forEach(change => {
        if (change.id) {
            ids.add(change.id);
        }
    });
    return Array.from(ids);
};
