import { Client } from "@microsoft/microsoft-graph-client";
import { escapeSearchTerm } from "@/services/userSearchService";
import { withRetry } from "@/utils/retryUtils";

/**
 * The scopes a role can be assigned at in Add people (spec 5.7, NG-67): the tenant's administrative units and the app
 * registrations found by name. `AdministrativeUnit.Read.All` and `Application.Read.All` are in the login scopes.
 */

export interface ScopeObject {
    id: string;
    displayName: string;
}

interface Page<T> {
    value?: T[];
    "@odata.nextLink"?: string;
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Every administrative unit (`GET /v1.0/directory/administrativeUnits`), paged */
export async function fetchAdministrativeUnits(client: Client): Promise<ScopeObject[]> {
    const units: ScopeObject[] = [];
    let page = await withRetry(
        () => client.api("/directory/administrativeUnits").select("id,displayName").top(999).get() as Promise<Page<{ id: string; displayName?: string }>>,
        3, 1000, "fetchAdministrativeUnits"
    );
    for (;;) {
        for (const u of page.value ?? []) units.push({ id: u.id, displayName: u.displayName ?? u.id });
        const next = page["@odata.nextLink"];
        if (!next) break;
        await delay(100); // Small pause between pages, as directoryRoleService does
        page = await withRetry(() => client.api(next).get() as Promise<Page<{ id: string; displayName?: string }>>, 3, 1000, "fetchAdministrativeUnits next");
    }
    return units.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/**
 * App registrations whose name matches (`GET /v1.0/applications?$search="displayName:..."` with `ConsistencyLevel:
 * eventual`), top 10. The scope of one application is `/{object id of the application}` (Microsoft Learn).
 */
export async function searchApplications(client: Client, term: string): Promise<ScopeObject[]> {
    const search = escapeSearchTerm(term);
    if (!search) return [];
    // The SDK does not encode $search: a & # % in the term would cut the URL short
    const page = await withRetry(
        () => client.api("/applications").header("ConsistencyLevel", "eventual").search(`"displayName:${encodeURIComponent(search)}"`).select("id,displayName").top(10).get() as Promise<Page<{ id: string; displayName?: string }>>,
        3, 1000, "searchApplications $search"
    );
    return (page.value ?? []).map((a) => ({ id: a.id, displayName: a.displayName ?? a.id }));
}
