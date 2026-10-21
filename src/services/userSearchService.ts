import { Client } from "@microsoft/microsoft-graph-client";
import { withRetry } from "@/utils/retryUtils";
import { escapeODataString } from "@/utils/odataUtils";

export interface FoundUser {
    id: string;
    displayName: string;
    userPrincipalName: string;
}

interface GraphUser {
    id: string;
    displayName?: string;
    userPrincipalName?: string;
}

const TOP = 5;

/** The term inside a quoted `$search` expression: quotes and backslashes would end the string. */
export function escapeSearchTerm(term: string): string {
    return term.replace(/["\\]/g, " ").trim();
}

function toFoundUsers(response: { value?: GraphUser[] }): FoundUser[] {
    return (response.value ?? []).map((u) => ({ id: u.id, displayName: u.displayName ?? u.userPrincipalName ?? u.id, userPrincipalName: u.userPrincipalName ?? "" }));
}

/**
 * Users whose name or sign-in name matches the term: `GET /v1.0/users?$search=` with `ConsistencyLevel: eventual`
 * (required for `$search` on directory objects), top 5. If that query is rejected the answer falls back to
 * `startswith` filters. `User.Read.All` is in the login scopes.
 */
export async function searchUsers(client: Client, term: string): Promise<FoundUser[]> {
    const search = escapeSearchTerm(term);
    if (!search) return [];
    // The SDK does not encode $search or $filter: a & # % in the term would cut the URL short, so the term is encoded
    const encoded = encodeURIComponent(search);
    try {
        const response = await withRetry(
            () =>
                client
                    .api("/users")
                    .header("ConsistencyLevel", "eventual")
                    .search(`"displayName:${encoded}" OR "userPrincipalName:${encoded}"`)
                    .select("id,displayName,userPrincipalName")
                    .top(TOP)
                    .get(),
            3, 1000, "searchUsers $search"
        );
        return toFoundUsers(response);
    } catch {
        const escaped = encodeURIComponent(escapeODataString(term.trim()));
        const response = await withRetry(
            () =>
                client
                    .api("/users")
                    .filter(`startswith(displayName,'${escaped}') or startswith(userPrincipalName,'${escaped}')`)
                    .select("id,displayName,userPrincipalName")
                    .top(TOP)
                    .get(),
            3, 1000, "searchUsers $filter"
        );
        return toFoundUsers(response);
    }
}

export interface FoundPrincipal {
    id: string;
    kind: "user" | "group";
    displayName: string;
    /** Users: the sign-in name; groups: empty */
    userPrincipalName: string;
    isAssignableToRole?: boolean;
}

interface GraphGroup {
    id: string;
    displayName?: string;
    isAssignableToRole?: boolean | null;
}

/**
 * Users and groups whose name matches the term (Configure approvers, spec 5.5; Add people, spec 5.7): the user search
 * above and `GET /v1.0/groups?$search="displayName:..."` with `ConsistencyLevel: eventual`, top 5 each, users first.
 * `onlyRoleAssignableGroups` leaves out groups that cannot hold a directory role. `Group.Read.All` is in the login scopes.
 */
export async function searchPrincipals(client: Client, term: string, options: { onlyRoleAssignableGroups?: boolean } = {}): Promise<FoundPrincipal[]> {
    const search = escapeSearchTerm(term);
    if (!search) return [];
    const encoded = encodeURIComponent(search);
    const [users, groups] = await Promise.all([
        searchUsers(client, term),
        // A failed group search still answers with the users
        withRetry(
            () =>
                client
                    .api("/groups")
                    .header("ConsistencyLevel", "eventual")
                    .search(`"displayName:${encoded}"`)
                    .select("id,displayName,isAssignableToRole")
                    .top(TOP)
                    .get() as Promise<{ value?: GraphGroup[] }>,
            3, 1000, "searchGroups $search"
        ).catch((): { value?: GraphGroup[] } => ({ value: [] })),
    ]);
    const foundGroups: FoundPrincipal[] = (groups.value ?? [])
        .filter((g) => !options.onlyRoleAssignableGroups || g.isAssignableToRole === true)
        .map((g) => ({ id: g.id, kind: "group", displayName: g.displayName ?? g.id, userPrincipalName: "", isAssignableToRole: g.isAssignableToRole === true }));
    return [...users.map((u): FoundPrincipal => ({ ...u, kind: "user" })), ...foundGroups];
}
