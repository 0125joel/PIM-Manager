import type { Client } from "@microsoft/microsoft-graph-client";
import { escapeODataString } from "@/utils/odataUtils";
import { runWorkerPool } from "@/utils/workerPool";
import { graphRateLimiter } from "@/utils/rateLimiter";
import { withRetry } from "@/utils/retryUtils";
import { Logger } from "@/utils/logger";

/**
 * The display name of each agent identity blueprint, from its blueprint principal in this tenant:
 * GET /v1.0/servicePrincipals?$filter=appId eq '{appId}'&$select=id,appId,displayName (Application.Read.All, in the login
 * scopes). Never select publisherName: the blueprint principal type lacks it and Graph answers 400 (tenant test 2026-10-11).
 * A blueprint that is not found or fails is left out; nothing throws except an abort.
 */
export async function fetchBlueprintNames(client: Client, appIds: readonly string[], signal?: AbortSignal): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    if (appIds.length === 0) return names;
    await runWorkerPool<string, { value?: { appId?: string; displayName?: string }[] }>({
        items: [...appIds],
        workerCount: 4,
        delayMs: 300,
        signal,
        rateLimiter: graphRateLimiter,
        processor: (appId) =>
            withRetry(
                () => client.api("/servicePrincipals").version("v1.0").filter(`appId eq '${escapeODataString(appId)}'`).select("id,appId,displayName").get(),
                3, 1000, "agent blueprint name"
            ),
        onItemComplete: (appId, response) => {
            const name = response?.value?.[0]?.displayName;
            if (name) names.set(appId.toLowerCase(), name);
        },
        onItemError: (appId, error) => Logger.warn("agentBlueprint", `Could not read the blueprint ${appId}: ${error}`),
    });
    return names;
}
