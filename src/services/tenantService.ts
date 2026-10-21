import { Client } from "@microsoft/microsoft-graph-client";
import { withRetry } from "@/utils/retryUtils";
import { parseOrganizationResponse } from "@/utils/shellNavigation";

/**
 * Display name of the signed-in tenant: GET /v1.0/organization?$select=id,displayName.
 * Delegated `User.Read` is enough (offline Graph reference, endpoint /organization), no extra consent.
 * Null when the call fails or the answer has no usable name; the shell then shows the tenant id prefix.
 */
export async function fetchTenantDisplayName(client: Client, tenantId: string): Promise<string | null> {
    try {
        const response = await withRetry(
            () => client.api("/organization").version("v1.0").select("id,displayName").get(),
            2, 1000, "fetchTenantDisplayName"
        );
        return parseOrganizationResponse(response, tenantId);
    } catch {
        return null;
    }
}
