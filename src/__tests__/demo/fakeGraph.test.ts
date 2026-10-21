import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { WorkloadState } from "@/types/workload.types";
import type { RoleDetailData } from "@/types/directoryRole.types";
import type { PimGroupData } from "@/types/pimGroup.types";
import { buildContosoTenant, PEOPLE, GROUPS, ROLE } from "@/demo/contoso/tenant";
import { createFakeGraph, type GraphRequest } from "@/demo/graph/server";
import { createDemoFetch } from "@/demo/runtime/fetch";
import { createGraphClient } from "@/utils/graphClient";
import { createWorkloadEngine } from "@/workloads/engine";
import { directoryRolesAdapter, INITIAL_ROLES_EXTRAS, type DirectoryRolesExtras } from "@/workloads/directoryRolesAdapter";
import { pimGroupsAdapter } from "@/workloads/pimGroupsAdapter";
import { fetchSecurityAlerts } from "@/utils/alertsApi";
import { fetchCustomExtensions } from "@/services/customExtensionService";
import { fetchGroupMembersAndOwners } from "@/services/groupMembershipService";
import { searchPrincipals, searchUsers } from "@/services/userSearchService";
import { fetchTenantDisplayName } from "@/services/tenantService";
import { fetchAdministrativeUnits, searchApplications } from "@/services/scopeOptionsService";
import type { WorkloadStore } from "@/workloads/types";
import { parseGraphPolicy } from "@/utils/policyParser";
import { completeRules } from "@/utils/policyView";
import { parseTotalHours } from "@/utils/durationUtils";
import { getMaxDurationBucket } from "@/utils/assignmentKinds";
import { getPrincipalKind } from "@/utils/principalUtils";
import { DEMO_ACCOUNT } from "@/demo/contoso/account";
import { fetchAdministrativeUnitGroups, fetchMyActiveRoles, fetchMyEligibleRoles, fetchMyGroupInstances, fetchMyOwnedGroups, fetchScopedGroup } from "@/services/writeAccessService";
import { deriveWriteAccess, groupsOutsideLoad } from "@/utils/writeAccess";
import bundledCatalog from "@/config/accessModel/eam-catalog.json";
import { CATALOG_URL, loadAccessModelCatalog } from "@/utils/accessModelCatalog";
import { fetchConditionalAccessPolicies } from "@/services/conditionalAccessService";
import { dryRunAssignments } from "@/services/assignmentDryRunService";
import { summarizeContextPolicies } from "@/utils/configurePreflight";
import { lookupPrincipals } from "@/services/principalLookupService";
import { readFileSync } from "node:fs";
import { readImportFile } from "@/utils/importDetect";
import { checkAssignmentRows, knownPrincipals, mergePrincipals, neededLookups } from "@/utils/importAssignments";
import { compareAccessModel, compareSettingsRows } from "@/utils/importSettings";
import { fetchBlueprintNames } from "@/services/agentBlueprintService";

/**
 * The demo runs the app's real loaders against the fake Graph. This test does the same: if the app starts a Graph call
 * the fake Graph does not serve, or reads a shape it does not return, the demo would show an error, and this fails.
 */

const now = new Date();
const tenant = buildContosoTenant(now);
const unhandled: GraphRequest[] = [];
const graph = createFakeGraph(tenant, { now: () => now, onUnhandled: (r) => unhandled.push(r) });
const client = () => createGraphClient("demo-token");

function memoryStore<T, X>(workload: "directoryRoles" | "pimGroups", extras: X) {
    let state: WorkloadState<T, X> = {
        workload,
        data: [],
        extras,
        loading: { phase: "idle", progress: { current: 0, total: 0 }, message: "" },
        consent: { consented: true },
        lastFetched: undefined,
    };
    const store: WorkloadStore<T, X> = { get: () => state, apply: (updater) => { state = updater(state); } };
    return { store, get: () => state };
}

async function settle(get: () => WorkloadState<unknown, unknown>) {
    for (let i = 0; i < 600; i++) {
        const { phase, background } = get().loading;
        if ((phase === "complete" || phase === "error") && !background?.running) return;
        await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("Workload did not settle");
}

beforeAll(() => {
    vi.stubGlobal("fetch", createDemoFetch({ graph: async () => graph, realFetch: () => Promise.reject(new Error("network")) }));
});
afterAll(() => {
    vi.unstubAllGlobals();
});

describe("the app's loaders against the fake Graph", () => {
    let roles: RoleDetailData[] = [];
    let rolesState: WorkloadState<RoleDetailData, DirectoryRolesExtras>;
    let groups: PimGroupData[] = [];

    beforeAll(async () => {
        const r = memoryStore<RoleDetailData, DirectoryRolesExtras>("directoryRoles", INITIAL_ROLES_EXTRAS);
        const rolesEngine = createWorkloadEngine(directoryRolesAdapter, { store: r.store, getClient: async () => client(), onSynced: () => undefined });
        const g = memoryStore<PimGroupData, undefined>("pimGroups", undefined);
        const groupsEngine = createWorkloadEngine(pimGroupsAdapter, { store: g.store, getClient: async () => client(), onSynced: () => undefined });
        await Promise.all([rolesEngine.load(), groupsEngine.load()]);
        await Promise.all([settle(r.get as never), settle(g.get as never)]);
        // Approver names arrive after the policies; give the last patches a moment
        await new Promise((resolve) => setTimeout(resolve, 600));
        rolesState = r.get();
        roles = rolesState.data;
        groups = g.get().data;
        rolesEngine.dispose();
        groupsEngine.dispose();
    }, 60_000);

    it("serves every request the loaders make", () => {
        expect(unhandled.map((r) => `${r.method} ${r.url}`)).toEqual([]);
    });

    it("loads every role with its policy and no failure", () => {
        expect(rolesState.loading.phase).toBe("complete");
        expect(roles.length).toBe(tenant.roleDefinitions.length);
        expect(rolesState.extras.failedRoleIds).toEqual([]);
        expect(roles.every((role) => (role.policy?.details.rules?.length ?? 0) > 0)).toBe(true);
        expect(rolesState.extras.authenticationContexts.map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
    });

    it("reads assignments with scopes, user types and the activation through a group", () => {
        const securityAdmin = roles.find((r) => r.definition.id === ROLE.securityAdmin)!;
        expect(securityAdmin.assignments.active.some((a) => a.principalId === PEOPLE.lee.id && a.viaGroup)).toBe(true);
        const kim = securityAdmin.assignments.active.find((a) => a.principalId === PEOPLE.kim.id)!;
        expect(kim.principalUserType).toBe("Guest");
        const userAdmin = roles.find((r) => r.definition.id === ROLE.userAdmin)!;
        expect(new Set(userAdmin.assignments.eligible.map((a) => a.scopeInfo?.type))).toEqual(new Set(["administrative-unit", "rmau"]));
        const cloudApp = roles.find((r) => r.definition.id === ROLE.cloudAppAdmin)!;
        expect(cloudApp.assignments.eligible[0].scopeInfo?.type).toBe("specific-object");
    });

    it("answers agents like Graph does", async () => {
        const exchangeRecipientAdmin = roles.find((r) => r.definition.id === ROLE.exchangeRecipientAdmin)!;
        const hrSchedule = exchangeRecipientAdmin.assignments.active.find((a) => a.principalId === tenant.servicePrincipals.find((sp) => sp.displayName === "Contoso HR Assistant")?.id)!;
        expect(hrSchedule.principal?.["@odata.type"]).toBe("#microsoft.graph.agentIdentity");
        expect(hrSchedule.principal?.agentIdentityBlueprintId).toBe("25664c89-cea5-4ab6-b924-a54fd8a19ae0");

        const hrPermanent = exchangeRecipientAdmin.assignments.permanent.find((a) => a.principalId === hrSchedule.principalId)!;
        expect(hrPermanent.principal?.["@odata.type"]).toBe("#microsoft.graph.servicePrincipal");
        expect(hrPermanent.principal?.servicePrincipalType).toBe("ServiceIdentity");
        expect(hrPermanent.principal?.agentIdentityBlueprintId).toBeUndefined();
        expect(getPrincipalKind(hrPermanent.principal)).toBe("agentIdentity");

        const finance = groups.find((g) => g.group.id === GROUPS.finance.id)!;
        expect(finance.assignments.some((a) => a.principalId === PEOPLE.opsAgentUser.id && a.principal?.["@odata.type"] === "#microsoft.graph.agentUser")).toBe(true);

        const opsBlueprint = tenant.servicePrincipals.find((sp) => sp.displayName === "Contoso Ops Agent Blueprint")!;
        const result = await client().api("/servicePrincipals")
            .filter(`appId eq '${opsBlueprint.appId}'`)
            .select("id,appId,displayName")
            .get();
        expect(result.value).toHaveLength(1);
        expect(result.value[0].displayName).toBe("Contoso Ops Agent Blueprint");
    });

    it("reads an agent blueprint name and ignores a blueprint that is not in the tenant", async () => {
        const opsBlueprint = tenant.servicePrincipals.find((sp) => sp.displayName === "Contoso Ops Agent Blueprint")!;
        const names = await fetchBlueprintNames(client(), [opsBlueprint.appId, "00000000-0000-0000-0000-000000000000"]);
        expect(names).toEqual(new Map([[opsBlueprint.appId, "Contoso Ops Agent Blueprint"]]));
        expect(unhandled).toEqual([]);
    });

    it("resolves the approvers of a policy to names", () => {
        const globalAdmin = roles.find((r) => r.definition.id === ROLE.globalAdmin)!;
        expect(globalAdmin.policy?.approvers.map((a) => a.displayName).sort()).toEqual(["Patti Fernandez", "Security Leads"]);
    });

    it("loads the groups under PIM with policies and the role-assignable groups outside PIM", () => {
        const managed = groups.filter((g) => g.isManaged !== false);
        const unmanaged = groups.filter((g) => g.isManaged === false);
        expect(managed.map((g) => g.group.displayName).sort()).toEqual(tenant.groups.filter((g) => g.isPimManaged).map((g) => g.displayName).sort());
        expect(unmanaged.map((g) => g.group.displayName).sort()).toEqual(["Legacy Intune Admins", "SharePoint Site Admins", "Teams Rollout Team"]);
        expect(managed.every((g) => g.policies?.member && g.policies?.owner)).toBe(true);
        expect(unmanaged.find((g) => g.group.id === GROUPS.legacyIntune.id)?.memberCount).toBe(4);
        const tier0 = managed.find((g) => g.group.id === GROUPS.tier0.id)!;
        expect(tier0.assignments.some((a) => a.assignmentType === "active" && a.assignmentOrigin === "activated")).toBe(true);
    });

    it("serves the side reads: alerts, custom extensions, members, user search, tenant name", async () => {
        const alerts = await fetchSecurityAlerts("demo-token");
        expect(alerts.length).toBe(7);
        expect(alerts[0].alertDefinition?.severityLevel).toBe("high");
        expect((await fetchCustomExtensions(client())).length).toBe(3);
        const membership = await fetchGroupMembersAndOwners(client(), GROUPS.legacyIntune.id);
        expect(membership.members.length).toBe(4);
        expect(membership.owners.map((o) => o.displayName)).toEqual(["Alex Wilber"]);
        expect((await searchUsers(client(), "adele")).map((u) => u.displayName)).toContain("Adele Vance");
        const principals = await searchPrincipals(client(), "adele");
        expect(principals.find((p) => p.displayName === "Adele Vance")?.kind).toBe("user");
        const firstGroup = tenant.groups[0].displayName.split(" ")[0];
        expect((await searchPrincipals(client(), firstGroup)).some((p) => p.kind === "group")).toBe(true);
        expect(await fetchTenantDisplayName(client(), tenant.id)).toBe("Contoso");
        // Add people: the scopes of a role (NG-67)
        expect((await fetchAdministrativeUnits(client())).length).toBe(tenant.administrativeUnits.length);
        const firstApp = String(tenant.applications[0].displayName).split(" ")[0];
        expect((await searchApplications(client(), firstApp)).length).toBeGreaterThan(0);
        expect(unhandled).toEqual([]);
    });

    it("knows the principal of every assignment", () => {
        const all = roles.flatMap((r) => [...r.assignments.eligible, ...r.assignments.active, ...r.assignments.permanent]);
        const unnamed = all.filter((a) => !(a as { principal?: { displayName?: string } }).principal?.displayName);
        expect(unnamed.map((a) => a.principalId)).toEqual([]);
    });

    it("serves the reads of Configure: scopes, principal pickers, existing assignments, conflicts", async () => {
        const c = client();
        expect((await c.api("/directory/administrativeUnits?$select=id,displayName,description&$top=100").get()).value.length).toBe(3);
        expect((await c.api(`/roleManagement/directory/roleDefinitions/${ROLE.globalAdmin}`).select("id,displayName").get()).displayName).toBe("Global Administrator");
        expect((await c.api("/roleManagement/directory/roleEligibilitySchedules").filter(`roleDefinitionId eq '${ROLE.globalAdmin}'`).expand("principal").get()).value.length).toBe(2);
        expect((await c.api("/roleManagement/directory/roleAssignmentSchedules").filter(`roleDefinitionId eq '${ROLE.globalAdmin}'`).expand("principal").get()).value.length).toBe(4);
        expect((await c.api("/identityGovernance/privilegedAccess/group/eligibilityScheduleInstances").filter(`groupId eq '${GROUPS.tier0.id}'`).expand("principal").get()).value.length).toBe(4);
        expect((await c.api("/users").select("id,displayName,mail").top(10).filter("startswith(displayName,'me') or startswith(mail,'me')").get()).value.map((u: { displayName: string }) => u.displayName)).toEqual(["Megan Bowen"]);
        expect((await c.api("/groups").select("id,displayName,isAssignableToRole").top(25).filter("isAssignableToRole eq true and startswith(displayName,'t')").get()).value.map((g: { displayName: string }) => g.displayName).sort()).toEqual(["Teams Rollout Team", "Tier 0 Identity Admins"]);
        expect((await c.api("/users").filter("userPrincipalName eq 'AdeleV@contoso.com'").select("id").get()).value[0].id).toBe(PEOPLE.adele.id);
        expect(unhandled).toEqual([]);
    });

    it("serves the people lookup of Import: users by UPN and id, groups and applications by id", async () => {
        const sp = tenant.servicePrincipals[0];
        const found = await lookupPrincipals(client(), {
            ids: [PEOPLE.adele.id, GROUPS.tier0.id, sp.id, "00000000-0000-0000-0000-000000000000"],
            upns: ["AdeleV@contoso.com", PEOPLE.alex.userPrincipalName, "nobody@contoso.com"],
        });
        expect(found.byUpn.get("adelev@contoso.com")).toMatchObject({ id: PEOPLE.adele.id, kind: "user", displayName: "Adele Vance" });
        expect(found.byUpn.get(PEOPLE.alex.userPrincipalName.toLowerCase())?.id).toBe(PEOPLE.alex.id);
        expect(found.byUpn.has("nobody@contoso.com")).toBe(false);
        expect(found.byId.get(GROUPS.tier0.id.toLowerCase())).toMatchObject({ kind: "group", displayName: "Tier 0 Identity Admins" });
        expect(found.byId.get(sp.id.toLowerCase())?.kind).toBe("servicePrincipal");
        expect(found.byId.has("00000000-0000-0000-0000-000000000000")).toBe(false);
        expect(unhandled).toEqual([]);
    });

    it("checks the bundled import examples against Contoso with the real services", async () => {
        const check = async (fileName: string, kind: "role" | "group") => {
            const file = readImportFile(readFileSync(`public/examples/${fileName}`, "utf8"), fileName);
            expect(file.kind).toBe(kind === "role" ? "roleAssignments" : "groupAssignments");
            const known = knownPrincipals(roles, groups);
            const found = await lookupPrincipals(client(), neededLookups(file.csv!.rows, known));
            return checkAssignmentRows({
                kind, rows: file.csv!.rows, rowNumbers: file.csv!.rowNumbers, errors: file.csv!.errors, isOlderRemoval: false, fileName, roles, groups, access: null,
                principals: mergePrincipals(known, found), administrativeUnits: null, tenantName: "Contoso", now,
            });
        };
        const roleRows = await check("pim-bulk-role-assignments.csv", "role");
        expect(roleRows.map((r) => r.result === "error" ? r.message : r.result)).toEqual(expect.arrayContaining(["Nobody with this UPN in Contoso."]));
        expect(roleRows.filter((r) => r.result === "error")).toHaveLength(1);
        expect(roleRows.some((r) => r.result === "new")).toBe(true);
        const groupRows = await check("pim-bulk-group-assignments.csv", "group");
        expect(groupRows.filter((r) => r.result === "error").map((r) => r.message)).toEqual([]);
        expect(groupRows.length).toBe(3);
        expect(unhandled).toEqual([]);
    });

    it("compares the bundled settings and access model examples with Contoso", () => {
        const base = {
            roles, groups, access: null, tenantName: "Contoso", loading: { isRolesLoading: false, isGroupsLoading: false },
            contexts: rolesState.extras.authenticationContexts, words: { contexts: rolesState.extras.authenticationContexts, extensions: null },
            otherBasket: { changes: [] }, names: new Map<string, string>(),
        };
        for (const [fileName, kind] of [["pim-bulk-role-policies.csv", "role"], ["pim-bulk-group-policies.csv", "group"]] as const) {
            const file = readImportFile(readFileSync(`public/examples/${fileName}`, "utf8"), fileName);
            expect(file.kind).toBe(kind === "role" ? "rolePolicies" : "groupPolicies");
            const result = compareSettingsRows({ ...base, fileName, kind, rows: file.csv!.rows, rowNumbers: file.csv!.rowNumbers, errors: file.csv!.errors, headers: file.csv!.headers });
            expect(result.problems.filter((p) => p.kind === "fix"), fileName).toEqual([]);
            // Fixed numbers: a change of the Contoso policies or of the examples shows here
            expect([result.differs, result.matches], fileName).toEqual(kind === "role" ? [7, 6] : [5, 3]);
        }
        const model = readImportFile(readFileSync("public/examples/pim-access-model.json", "utf8"), "pim-access-model.json");
        expect(model.kind).toBe("accessModel");
        const result = compareAccessModel(model.json, { ...base, fileName: "pim-access-model.json", resolveContext: () => null, templateOf: () => undefined, placementOf: () => null });
        expect(result.problems.filter((p) => p.kind === "fix")).toEqual([]);
        expect([result.differs, result.matches]).toEqual([4, 7]);
    });

    it("serves the access check of Configure and opens it for the signed-in admin", async () => {
        const c = client();
        const [activeRoles, eligibleRoles, ownedGroups, groupActive, groupEligible, auGroups] = await Promise.all([
            fetchMyActiveRoles(c), fetchMyEligibleRoles(c), fetchMyOwnedGroups(c),
            fetchMyGroupInstances(c, "assignment"), fetchMyGroupInstances(c, "eligibility"),
            fetchAdministrativeUnitGroups(c, tenant.administrativeUnits.find((a) => a.displayName === "Contoso Netherlands")!.id),
        ]);
        expect(await fetchScopedGroup(c, GROUPS.platform.id)).toMatchObject({ id: GROUPS.platform.id, displayName: GROUPS.platform.displayName });
        expect(activeRoles.map((r) => r.roleDefinitionId)).toContain(ROLE.globalAdmin);
        expect(eligibleRoles.map((r) => r.roleDefinitionId)).toContain(ROLE.privilegedRoleAdmin);
        expect(ownedGroups.map((g) => g.id).sort()).toEqual([GROUPS.helpdesk.id, GROUPS.legacyIntune.id, GROUPS.platform.id, GROUPS.tier0.id].sort());
        expect(groupActive.every((i) => i.accessId === "owner" && i.memberType === "direct")).toBe(true);
        expect(groupEligible).toEqual([]);
        expect(auGroups.map((g) => g.id).sort()).toEqual([GROUPS.platform.id, GROUPS.salesDynamic.id, GROUPS.onPremAdmins.id].sort());
        const access = deriveWriteAccess({
            activeRoles, eligibleRoles, ownedGroups, groupActive, groupEligible,
            administrativeUnitGroups: { [tenant.administrativeUnits.find((a) => a.displayName === "Contoso Netherlands")!.id]: auGroups },
            appPermission: { directoryRoles: "granted", pimGroups: "granted" },
            roleDefinitions: tenant.roleDefinitions,
            // What the app loads: groups under PIM and role-assignable groups outside it
            groups: tenant.groups.filter((g) => g.isPimManaged || g.isAssignableToRole).map((g) => ({ id: g.id, displayName: g.displayName, isAssignableToRole: g.isAssignableToRole, membershipRule: g.membershipRule, isUnderPim: g.isPimManaged })),
        });
        // A group of the unit outside PIM is added from the unit read
        expect(access.groups[GROUPS.platform.id]).toMatchObject({ state: "open", isUnderPim: false });
        // An owned group that is neither role-assignable nor under PIM is not loaded by the app: Edit lists it from the check (FIX-14)
        const outside = groupsOutsideLoad(access, tenant.groups.filter((g) => g.isPimManaged || g.isAssignableToRole).map((g) => ({ group: { id: g.id } })));
        expect(outside.map((g) => g.group.id)).toContain(GROUPS.platform.id);
        expect(outside.every((g) => g.isManaged === false)).toBe(true);
        expect(access.overall).toBe("open");
        expect(access.headline).toMatchObject({ kind: "open", via: { kind: "role", role: { name: "Global Administrator" } } });
        expect(access.groups[GROUPS.legacyIntune.id]).toMatchObject({ state: "open", owner: true, isUnderPim: false });
        // A dynamic group and a synced group cannot come under PIM, whatever the admin holds (spec 3.2, 19)
        expect(access.groups[GROUPS.salesDynamic.id]).toMatchObject({ state: "locked" });
        expect(access.groups[GROUPS.onPremAdmins.id]).toMatchObject({ state: "locked" });
        expect(unhandled).toEqual([]);
    });

    it("answers the access model catalog with the bundled copy and never reaches pimmonitor.com", async () => {
        const realFetch = vi.fn(() => Promise.reject(new Error("network")));
        const demoFetch = createDemoFetch({ graph: async () => createFakeGraph(buildContosoTenant()), realFetch, catalog: async () => bundledCatalog });
        const loaded = await loadAccessModelCatalog({ fetchImpl: demoFetch, loadBundled: async () => bundledCatalog });
        expect(loaded.origin).toBe("live");
        expect(loaded.catalog.catalogVersion).toBe(bundledCatalog.catalogVersion);
        expect(realFetch).not.toHaveBeenCalled();
        expect(CATALOG_URL.startsWith("https://pimmonitor.com/")).toBe(true);
    });

    it("serves the Conditional Access check and accepts a dry run, which writes nothing", async () => {
        const c = client();
        const policies = await fetchConditionalAccessPolicies(c);
        const summary = summarizeContextPolicies(policies, ["c1", "c2", "c3", "c9"]);
        expect(Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, v.state]))).toEqual({ c1: "enabled", c2: "reportOnly", c3: "off", c9: "none" });
        expect(summary.c1).toMatchObject({ signInFrequencyEveryTime: true, authenticationStrengthIds: ["00000000-0000-0000-0000-000000000004"] });
        const results = await dryRunAssignments(c, [
            { id: "role", change: { kind: "add", target: { kind: "role", id: ROLE.globalAdmin }, principal: { id: PEOPLE.adele.id, kind: "user", displayName: "Adele" }, type: "eligible", scope: "/", start: null, end: null, justification: "demo", source: { from: "edit" } } },
            { id: "group", change: { kind: "add", target: { kind: "group", id: GROUPS.tier0.id, access: "owner" }, principal: { id: PEOPLE.adele.id, kind: "user", displayName: "Adele" }, type: "active", scope: "/", start: null, end: null, justification: "demo", source: { from: "edit" } } },
        ]);
        expect(results).toEqual({ role: { ok: true }, group: { ok: true } });
        // Without isValidationOnly it is still a write, and still refused
        await expect(c.api("/roleManagement/directory/roleEligibilityScheduleRequests").post({ action: "adminAssign" })).rejects.toMatchObject({ statusCode: 403 });
        expect(unhandled).toEqual([]);
    });

    it("refuses every write", async () => {
        await expect(client().api("/roleManagement/directory/roleEligibilityScheduleRequests").post({})).rejects.toMatchObject({ statusCode: 403, code: "DemoEnvironment" });
    });
});

/**
 * Joël's rule for the demo (2026-10-02): every option the app can show is in the Contoso data. These checks run on the data
 * as the app loaded it; a new option in the app belongs in the demo tenant and in this list.
 */
describe("the demo tenant covers every option", () => {
    let roles: RoleDetailData[] = [];
    let groups: PimGroupData[] = [];

    beforeAll(async () => {
        const r = memoryStore<RoleDetailData, DirectoryRolesExtras>("directoryRoles", INITIAL_ROLES_EXTRAS);
        const g = memoryStore<PimGroupData, undefined>("pimGroups", undefined);
        const rolesEngine = createWorkloadEngine(directoryRolesAdapter, { store: r.store, getClient: async () => client(), onSynced: () => undefined });
        const groupsEngine = createWorkloadEngine(pimGroupsAdapter, { store: g.store, getClient: async () => client(), onSynced: () => undefined });
        await Promise.all([rolesEngine.load(), groupsEngine.load()]);
        await Promise.all([settle(r.get as never), settle(g.get as never)]);
        roles = r.get().data;
        groups = g.get().data;
        rolesEngine.dispose();
        groupsEngine.dispose();
    }, 60_000);

    type Row = { principalId: string; principal?: { "@odata.type"?: string }; principalUserType?: string; scopeInfo?: { type: string }; scheduleInfo?: { startDateTime?: string; expiration?: { type?: string } }; assignmentType?: string; viaGroup?: boolean };
    const eligible = () => roles.flatMap((r) => r.assignments.eligible as unknown as Row[]);
    const active = () => roles.flatMap((r) => r.assignments.active as unknown as Row[]);
    const settings = () => roles.map((r) => parseGraphPolicy({ rules: completeRules(r.policy?.details.rules ?? []) }));
    const groupSettings = () => groups.flatMap((g) => [g.policies?.member, g.policies?.owner]).filter(Boolean).map((p) => parseGraphPolicy({ rules: completeRules(p!.rules) }));

    it("every scope type", () => {
        const types = new Set([...eligible(), ...active()].map((a) => a.scopeInfo?.type));
        for (const type of ["tenant-wide", "administrative-unit", "rmau", "specific-object"]) expect(types).toContain(type);
    });

    it("every principal kind", () => {
        const all = [...eligible(), ...active()];
        const kinds = new Set(all.map((a) => a.principal?.["@odata.type"]));
        for (const kind of [
            "#microsoft.graph.user",
            "#microsoft.graph.group",
            "#microsoft.graph.servicePrincipal",
            "#microsoft.graph.agentIdentity",
            "#microsoft.graph.agentIdentityBlueprintPrincipal",
        ]) expect(kinds).toContain(kind);
        expect(all.some((a) => a.principalUserType === "Guest")).toBe(true);
        expect(all.some((a) => a.principalUserType === "Member")).toBe(true);
    });

    it("every kind of role assignment", () => {
        const now = Date.now();
        expect(eligible().some((a) => a.scheduleInfo?.expiration?.type === "noExpiration")).toBe(true);
        expect(eligible().some((a) => a.scheduleInfo?.expiration?.type === "afterDateTime")).toBe(true);
        expect(eligible().some((a) => Date.parse(a.scheduleInfo?.startDateTime ?? "") > now)).toBe(true);
        expect(active().some((a) => a.assignmentType === "Assigned" && a.scheduleInfo?.expiration?.type === "noExpiration")).toBe(true);
        expect(active().some((a) => a.assignmentType === "Assigned" && a.scheduleInfo?.expiration?.type === "afterDateTime")).toBe(true);
        expect(active().some((a) => a.assignmentType === "Activated" && !a.viaGroup)).toBe(true);
        expect(active().some((a) => a.viaGroup)).toBe(true);
    });

    it("privileged, ordinary and custom roles, with and without assignments", () => {
        const holds = (r: RoleDetailData) => r.assignments.eligible.length + r.assignments.active.length > 0;
        expect(roles.some((r) => r.definition.isPrivileged && holds(r))).toBe(true);
        expect(roles.some((r) => !r.definition.isPrivileged && r.definition.isBuiltIn && holds(r))).toBe(true);
        expect(roles.some((r) => !r.definition.isBuiltIn && holds(r))).toBe(true);
        expect(roles.some((r) => !r.definition.isBuiltIn && !holds(r))).toBe(true);
        expect(roles.some((r) => r.definition.isPrivileged && r.assignments.eligible.length === 0 && r.assignments.active.length > 0)).toBe(true);
        const ga = roles.find((r) => r.definition.id === ROLE.globalAdmin)!;
        expect(ga.assignments.active.filter((a) => tenant.emergencyAccountIds.includes(a.principalId)).length).toBe(2);
    });

    it("every activation setting", () => {
        const all = [...settings(), ...groupSettings()];
        const buckets = new Set(all.map((s) => getMaxDurationBucket(parseTotalHours(s.maxActivationDuration))));
        expect(buckets.size).toBe(5);
        for (const requirement of ["none", "mfa", "authenticationContext"]) expect(all.some((s) => s.activationRequirement === requirement)).toBe(true);
        expect(all.some((s) => s.requireJustificationOnActivation)).toBe(true);
        expect(all.some((s) => !s.requireJustificationOnActivation)).toBe(true);
        expect(all.some((s) => s.requireTicketInfo)).toBe(true);
        expect(all.some((s) => s.requireApproval)).toBe(true);
        const approverTypes = new Set(roles.flatMap((r) => r.policy?.approvers.map((a) => a.type) ?? []));
        for (const type of ["user", "group", "manager"]) expect(approverTypes).toContain(type);
    });

    it("every assignment and notification setting", () => {
        const all = [...settings(), ...groupSettings()];
        expect(all.some((s) => s.allowPermanentActive)).toBe(true);
        expect(all.some((s) => !s.allowPermanentActive)).toBe(true);
        expect(all.some((s) => s.allowPermanentEligible)).toBe(true);
        expect(all.some((s) => !s.allowPermanentEligible)).toBe(true);
        expect(all.some((s) => !s.requireMfaOnActiveAssignment)).toBe(true);
        expect(all.some((s) => s.activationNotification && !s.activationNotification.isDefaultRecipientsEnabled && s.activationNotification.notificationRecipients.length === 0)).toBe(true);
        expect(all.some((s) => (s.activationNotification?.notificationRecipients.length ?? 0) > 0)).toBe(true);
        expect(all.some((s) => s.notifications.activation.requestor.criticalOnly)).toBe(true);
        expect(all.some((s) => s.notifications.eligibleAssignment.assignee.additionalRecipients !== "")).toBe(true);
    });

    it("custom extensions before and after approval, and a link to an extension that is gone", () => {
        const slots = roles.map((r) => parseGraphPolicy({ rules: completeRules(r.policy?.details.rules ?? []) }).customExtensions);
        const ids = new Set(tenant.customExtensions.map((e) => e.id));
        expect(slots.some((s) => s?.preApproval?.customExtensionId && ids.has(s.preApproval.customExtensionId))).toBe(true);
        expect(slots.some((s) => s?.postApproval?.customExtensionId)).toBe(true);
        expect(slots.some((s) => s?.preApproval?.customExtensionId && !ids.has(s.preApproval.customExtensionId))).toBe(true);
        expect(tenant.authenticationContexts.some((c) => !c.isAvailable)).toBe(true);
    });

    it("every kind of group and group assignment", () => {
        const managed = groups.filter((g) => g.isManaged !== false);
        const unmanaged = groups.filter((g) => g.isManaged === false);
        for (const type of ["security", "m365", "mailEnabled"]) expect(managed.some((g) => g.group.groupType === type)).toBe(true);
        expect(managed.some((g) => g.group.isAssignableToRole)).toBe(true);
        expect(managed.some((g) => !g.group.isAssignableToRole)).toBe(true);
        expect(unmanaged.some((g) => g.memberCount === 0)).toBe(true);
        expect(unmanaged.some((g) => (g.memberCount ?? 0) > 0)).toBe(true);
        const assignments = managed.flatMap((g) => g.assignments);
        for (const access of ["member", "owner"] as const) {
            for (const type of ["eligible", "active", "permanent"]) expect(assignments.some((a) => a.accessType === access && a.assignmentType === type)).toBe(true);
        }
        expect(assignments.some((a) => a.assignmentOrigin === "activated")).toBe(true);
        expect(assignments.some((a) => a.principal?.["@odata.type"] === "#microsoft.graph.group")).toBe(true);
        expect(assignments.some((a) => a.principalUserType === "Guest")).toBe(true);
        // Groups that hold roles: under PIM and outside it, eligible and active
        const roleHolders = new Set([...eligible(), ...active()].filter((a) => a.principal?.["@odata.type"] === "#microsoft.graph.group").map((a) => a.principalId));
        expect(managed.some((g) => roleHolders.has(g.group.id))).toBe(true);
        expect(unmanaged.some((g) => roleHolders.has(g.group.id))).toBe(true);
    });

    it("open and passed alerts of every severity, and the signed-in account", () => {
        const open = tenant.alerts.filter((a) => a.isActive);
        for (const severity of ["high", "medium", "low"]) expect(open.some((a) => a.alertDefinition.severityLevel === severity)).toBe(true);
        expect(tenant.alerts.some((a) => !a.isActive)).toBe(true);
        expect(tenant.signedInUserId).toBe(DEMO_ACCOUNT.id);
        expect(tenant.id).toBe(DEMO_ACCOUNT.tenantId);
    });
});


describe("the demo's Last applies", () => {
    it("is one entry the history store accepts, with its undo planner working on the Contoso data", async () => {
        const { buildDemoHistoryEntry, demoHistorySeed } = await import("@/demo/contoso/history");
        const { listHistory, HISTORY_STORAGE_PREFIX } = await import("@/utils/configureHistory");
        const { DEMO_ACCOUNT } = await import("@/demo/contoso/account");
        const seed = demoHistorySeed(new Date());
        const store = { getItem: (k: string) => seed[k] ?? null, setItem: () => undefined };
        const entries = listHistory(store, DEMO_ACCOUNT.tenantId);
        expect(Object.keys(seed)).toEqual([HISTORY_STORAGE_PREFIX + DEMO_ACCOUNT.tenantId]);
        expect(entries).toHaveLength(1);
        expect(entries[0].changes.map((c) => c.kind)).toEqual(["setting", "add", "remove"]);
        expect(Object.values(buildDemoHistoryEntry(new Date()).results).every((r) => r.status === "done")).toBe(true);
    });

    it("is in step with the Contoso data, so Undo opens a review with three changes", async () => {
        const { buildDemoHistoryEntry, HISTORY_ROLE } = await import("@/demo/contoso/history");
        const { basketFromSnapshot } = await import("@/utils/configureHistory");
        const { PEOPLE, ROLE } = await import("@/demo/contoso/tenant");
        expect(HISTORY_ROLE).toEqual({ exchangeAdmin: ROLE.exchangeAdmin, reportsReader: ROLE.reportsReader });
        const now = new Date();
        const { changes, warnings } = basketFromSnapshot(buildDemoHistoryEntry(now), {
            // Contoso as it is: Exchange Administrator at the default 8 hours, Allan eligible on it
            settings: () => ({ maxActivationDuration: "PT8H" }) as import("@/types/wizard.types").PolicySettings,
            assignments: () => [{ principalId: PEOPLE.allan.id, type: "eligible", scope: "/", start: null, end: null }],
        }, now);
        expect(warnings).toEqual([]);
        expect(changes.map((c) => c.kind).sort()).toEqual(["add", "remove", "setting"]);
    });
});
