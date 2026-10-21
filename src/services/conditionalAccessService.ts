import type { Client } from "@microsoft/microsoft-graph-client";
import type { ConditionalAccessPolicyLike } from "@/utils/accessModelCatalog";
import { withRetry } from "@/utils/retryUtils";

/**
 * The optional Conditional Access read of Configure (spec 12.5, NG-57): every policy with the parts the context
 * check needs. Needs `Policy.Read.All` and an active role that may read Conditional Access (T7: Privileged Role
 * Administrator alone answers 403 `AccessDenied`). Paged; a failure throws and the caller decides (a 403 is "Not
 * checked", never "Passed").
 */

export interface ConditionalAccessPolicy extends ConditionalAccessPolicyLike {
    id: string;
    displayName?: string;
}

const MAX_PAGES = 20;
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function fetchConditionalAccessPolicies(client: Client): Promise<ConditionalAccessPolicy[]> {
    const policies: ConditionalAccessPolicy[] = [];
    let page = await withRetry(() => client
        .api("/identity/conditionalAccess/policies")
        .version("v1.0")
        .select("id,displayName,state,conditions,grantControls,sessionControls")
        .get() as Promise<{ value?: ConditionalAccessPolicy[]; "@odata.nextLink"?: string }>, 3, 1000, "conditionalAccess policies");
    for (let i = 0; ; i++) {
        policies.push(...(page.value ?? []));
        const next = page["@odata.nextLink"];
        if (!next) return policies;
        if (i + 1 >= MAX_PAGES) throw new Error(`conditionalAccess policies: more than ${MAX_PAGES} pages`);
        await delay(100); // Small pause between pages, as directoryRoleService does
        page = await withRetry(() => client.api(next).get() as Promise<{ value?: ConditionalAccessPolicy[]; "@odata.nextLink"?: string }>, 3, 1000, "conditionalAccess policies");
    }
}
