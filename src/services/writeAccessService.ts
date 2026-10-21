import type { Client } from "@microsoft/microsoft-graph-client";
import { withRetry } from "@/utils/retryUtils";
import { getErrorStatusCode } from "@/utils/errorUtils";
import type { MyGroupInstance, MyRoleInstance, OwnedGroupRead } from "@/utils/writeAccess";

/**
 * The reads of the access check (NG-56, spec 3.1), all with scopes the app already has:
 * - active and eligible roles of the signed-in admin: `filterByCurrentUser(on='principal')` (RoleAssignmentSchedule and
 *   RoleEligibilitySchedule read scopes);
 * - groups the admin owns: `/me/ownedObjects/microsoft.graph.group` (`User.Read`);
 * - PIM group ownership and membership, eligible and active: the group `filterByCurrentUser` functions
 *   (`PrivilegedAccess.Read.AzureADGroup`, tenant test T2b), only with PIM for Groups consent;
 * - groups in an administrative unit, only for units a group role of the admin is scoped to (`AdministrativeUnit.Read.All`),
 *   and a group a group role is scoped to on its own (`Group.Read.All`), with the fields that decide whether it is locked.
 *
 * Every list is paged. A failed read throws: the access check must never decide on half the data.
 */

const MAX_PAGES = 20;
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const GROUP_FIELDS = "id,displayName,isAssignableToRole,membershipRule,onPremisesSyncEnabled,isManagementRestricted";

interface Page<T> {
    value?: T[];
    "@odata.nextLink"?: string;
}

async function readAll<T>(client: Client, first: () => Promise<Page<T>>, label: string): Promise<T[]> {
    const items: T[] = [];
    let page = await withRetry(first, 3, 1000, label);
    for (let i = 0; ; i++) {
        items.push(...(page.value ?? []));
        const next = page["@odata.nextLink"];
        if (!next) return items;
        // Never decide on half the data
        if (i + 1 >= MAX_PAGES) throw new Error(`${label}: more than ${MAX_PAGES} pages`);
        await delay(100); // Small pause between pages, as directoryRoleService does
        page = await withRetry(() => client.api(next).get() as Promise<Page<T>>, 3, 1000, label);
    }
}

export async function fetchMyActiveRoles(client: Client): Promise<MyRoleInstance[]> {
    return readAll<MyRoleInstance>(client, () => client
        .api("/roleManagement/directory/roleAssignmentScheduleInstances/filterByCurrentUser(on='principal')")
        .version("v1.0")
        .select("roleDefinitionId,directoryScopeId,memberType,assignmentType,endDateTime")
        .get(), "writeAccess activeRoles");
}

export async function fetchMyEligibleRoles(client: Client): Promise<MyRoleInstance[]> {
    return readAll<MyRoleInstance>(client, () => client
        .api("/roleManagement/directory/roleEligibilityScheduleInstances/filterByCurrentUser(on='principal')")
        .version("v1.0")
        .select("roleDefinitionId,directoryScopeId,memberType,endDateTime")
        .get(), "writeAccess eligibleRoles");
}

export async function fetchMyOwnedGroups(client: Client): Promise<OwnedGroupRead[]> {
    return readAll<OwnedGroupRead>(client, () => client
        .api("/me/ownedObjects/microsoft.graph.group")
        .version("v1.0")
        .select(GROUP_FIELDS)
        .get(), "writeAccess ownedGroups");
}

/** Learn names no `$select` for these functions (T2b ran without one) */
export async function fetchMyGroupInstances(client: Client, kind: "eligibility" | "assignment"): Promise<MyGroupInstance[]> {
    return readAll<MyGroupInstance>(client, () => client
        .api(`/identityGovernance/privilegedAccess/group/${kind}ScheduleInstances/filterByCurrentUser(on='principal')`)
        .version("v1.0")
        .get(), `writeAccess group ${kind}`);
}

/** The groups of a unit with the fields of the decision (the app does not load groups outside PIM that are not role-assignable) */
export async function fetchAdministrativeUnitGroups(client: Client, unitId: string): Promise<OwnedGroupRead[]> {
    try {
        return await readAll<OwnedGroupRead>(client, () => client
            .api(`/directory/administrativeUnits/${encodeURIComponent(unitId)}/members/microsoft.graph.group`)
            .version("v1.0")
            .select(GROUP_FIELDS)
            .get(), "writeAccess auGroups");
    } catch (error: unknown) {
        // A unit that is gone has no groups to open
        if (getErrorStatusCode(error) === 404) return [];
        throw error;
    }
}

/** One group a role is scoped to; null when it is gone */
export async function fetchScopedGroup(client: Client, groupId: string): Promise<OwnedGroupRead | null> {
    try {
        return await withRetry(() => client
            .api(`/groups/${encodeURIComponent(groupId)}`)
            .version("v1.0")
            .select(GROUP_FIELDS)
            .get() as Promise<OwnedGroupRead>, 3, 1000, "writeAccess scopedGroup");
    } catch (error: unknown) {
        if (getErrorStatusCode(error) === 404) return null;
        throw error;
    }
}
