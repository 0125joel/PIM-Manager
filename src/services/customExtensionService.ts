/**
 * PIM Custom Extensions (Preview)
 *
 * Manages the roleManagementCustomCalloutExtension objects a tenant registered
 * for PIM. Linking an extension to a role or group policy is a policy rule
 * write and lives in the Configure apply engine (`buildRuleUpdates`, `runApply`).
 *
 * Endpoint (beta only): /identityGovernance/privilegedAccess/customExtensions
 * Permission: PrivilegedAccess-CustomExt.Read.All (list). The app does not create extensions.
 * Licence: Microsoft Entra ID Governance or Entra Suite, on top of P2. A tenant
 * without it answers 403, which callers treat as PERMISSION_DENIED.
 */

import { Client } from "@microsoft/microsoft-graph-client";
import { PIM_URLS } from "@/config/constants";
import { Logger } from "@/utils/logger";
import { withRetry } from "@/utils/retryUtils";
import { getErrorStatusCode } from "@/utils/errorUtils";

// Types live in @/types/customExtension.types, re-exported here for existing importers
export type { CustomExtensionResourceType, PimCustomExtension } from "@/types/customExtension.types";
import type { PimCustomExtension } from "@/types/customExtension.types";

interface GraphCustomExtension {
    id?: string;
    displayName?: string;
    description?: string | null;
    resourceType?: string;
    customAttributes?: string[] | null;
    endpointConfiguration?: { targetUrl?: string } | null;
    clientConfiguration?: { timeoutInMilliseconds?: number; maximumRetries?: number } | null;
    authenticationConfiguration?: { resourceId?: string } | null;
}

export const CUSTOM_EXTENSION_PERMISSION_DENIED = "PERMISSION_DENIED";

function mapCustomExtension(raw: GraphCustomExtension): PimCustomExtension {
    return {
        id: raw.id ?? "",
        displayName: raw.displayName ?? raw.id ?? "",
        description: raw.description ?? "",
        resourceType: raw.resourceType ?? "",
        targetUrl: raw.endpointConfiguration?.targetUrl ?? "",
        timeoutInMilliseconds: raw.clientConfiguration?.timeoutInMilliseconds,
        maximumRetries: raw.clientConfiguration?.maximumRetries,
        resourceId: raw.authenticationConfiguration?.resourceId,
        customAttributes: Array.isArray(raw.customAttributes) ? raw.customAttributes : [],
    };
}

function rethrowPermissionDenied(error: unknown): never {
    if (getErrorStatusCode(error) === 403) {
        throw new Error(CUSTOM_EXTENSION_PERMISSION_DENIED);
    }
    throw error;
}

export function isCustomExtensionPermissionError(error: unknown): boolean {
    return error instanceof Error && error.message === CUSTOM_EXTENSION_PERMISSION_DENIED;
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Lists every custom extension registered in the tenant, all resource types.
 * Throws Error("PERMISSION_DENIED") on 403 (missing consent or licence).
 */
export async function fetchCustomExtensions(client: Client): Promise<PimCustomExtension[]> {
    try {
        const extensions: PimCustomExtension[] = [];
        let url: string | undefined = PIM_URLS.customExtensions;
        while (url) {
            const page: { value?: GraphCustomExtension[]; "@odata.nextLink"?: string } = await withRetry(
                // beta: custom extension objects have no v1.0 endpoint yet (Preview)
                () => client.api(url as string).version("beta").get(),
                3, 1000, "fetchCustomExtensions"
            );
            extensions.push(...(page.value ?? []).map(mapCustomExtension));
            url = page["@odata.nextLink"];
            if (url) await delay(100); // Small pause between pages, as directoryRoleService does
        }
        Logger.debug("customExtensionService", `Loaded ${extensions.length} custom extensions`);
        return extensions;
    } catch (error: unknown) {
        rethrowPermissionDenied(error);
    }
}
