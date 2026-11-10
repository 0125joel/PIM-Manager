import { describe, expect, it } from "vitest";
import type { ArmRoleScheduleInstance, ArmSubscription } from "@/types/azureResource.types";
import { buildScopeTree, isCurrentSchedule, isRootScope, levelFromScopeId, toAssignment, topReadableScopes } from "@/utils/azureScopes";
import ownerFixture from "@/__tests__/fixtures/azure/owner-subscription-instances.json";
import readerFixture from "@/__tests__/fixtures/azure/reader-subscription-instances.json";

const OWNER = ownerFixture.value as unknown as ArmRoleScheduleInstance[];
const READER = readerFixture.value as unknown as ArmRoleScheduleInstance[];

const MG = "/providers/Microsoft.Management/managementGroups";

function sub(subscriptionId: string, displayName: string, tenantId: string): ArmSubscription {
    return { id: `/subscriptions/${subscriptionId}`, subscriptionId, displayName, state: "Enabled", tenantId };
}

function item(scope: string, memberType: "Direct" | "Inherited" | "Group", scopeName?: string): ArmRoleScheduleInstance {
    return {
        id: `${scope === "/" ? "" : scope}/providers/Microsoft.Authorization/roleAssignmentScheduleInstances/x`,
        name: "x",
        type: "Microsoft.Authorization/roleAssignmentScheduleInstances",
        properties: {
            scope,
            roleDefinitionId: "/providers/Microsoft.Authorization/roleDefinitions/8e3af657-a8ff-443c-a75c-2fe8c4bcb635",
            principalId: "p1",
            principalType: "User",
            memberType,
            status: "Provisioned",
            ...(scopeName ? { expandedProperties: { scope: { id: scope, displayName: scopeName, type: "x" } } } : {}),
        },
    };
}

describe("isRootScope", () => {
    it("is true only for the root scope /", () => {
        expect(isRootScope("/")).toBe(true);
        expect(isRootScope("/subscriptions/00000000-0000-0000-0000-000000000003")).toBe(false);
        expect(isRootScope("/providers/Microsoft.Management/managementGroups/contoso-platform")).toBe(false);
        expect(isRootScope("")).toBe(false);
    });
});

describe("levelFromScopeId", () => {
    it.each([
        ["/", "root"],
        ["/providers/Microsoft.Management/managementGroups/contoso-platform", "managementGroup"],
        ["/providers/microsoft.management/managementgroups/contoso-platform", "managementGroup"],
        ["/subscriptions/00000000-0000-0000-0000-000000000003", "subscription"],
        ["/subscriptions/00000000-0000-0000-0000-000000000003/resourceGroups/rg-contoso-app", "resourceGroup"],
        ["/subscriptions/s1/resourcegroups/RG-WEB", "resourceGroup"],
        ["/subscriptions/s1/resourceGroups/rg-web/providers/Microsoft.KeyVault/vaults/kv-contoso-web", "resource"],
        ["/subscriptions/s1/resourceGroups/rg-data/providers/Microsoft.Sql/servers/sql1/databases/db1", "resource"],
        ["", null],
        ["/subscriptions", null],
        ["/providers/Microsoft.Management/managementGroups", null],
        ["/subscriptions/s1/providers/Microsoft.Security/pricings/default", null],
        ["/subscriptions/s1/resourceGroups/rg-web/providers/Microsoft.KeyVault/vaults", null],
    ])("%s gives %s", (id, expected) => {
        expect(levelFromScopeId(id)).toBe(expected);
    });
});

describe("buildScopeTree", () => {
    it("builds the Owner fixture tree, with the subscription under the Tenant Root Group", () => {
        const tree = buildScopeTree(
            [sub("00000000-0000-0000-0000-000000000003", "Contoso displayName 2", "00000000-0000-0000-0000-000000000001")],
            { "00000000-0000-0000-0000-000000000003": OWNER },
        );
        expect(tree).toEqual([
            { id: "/", name: "Contoso displayName 12", level: "root", parentId: null },
            { id: `${MG}/00000000-0000-0000-0000-000000000001`, name: "Contoso displayName 1", level: "managementGroup", parentId: "/" },
            { id: "/subscriptions/00000000-0000-0000-0000-000000000003", name: "Contoso displayName 2", level: "subscription", parentId: `${MG}/00000000-0000-0000-0000-000000000001`, tenantId: "00000000-0000-0000-0000-000000000001" },
            { id: "/subscriptions/00000000-0000-0000-0000-000000000003/resourceGroups/rg-contoso-app", name: "rg-contoso-app", level: "resourceGroup", parentId: "/subscriptions/00000000-0000-0000-0000-000000000003" },
        ]);
    });

    it("builds the Reader fixture tree, with the subscription under the only management group", () => {
        const tree = buildScopeTree(
            [sub("00000000-0000-0000-0000-000000000001", "Contoso user", "00000000-0000-0000-0000-000000000099")],
            { "00000000-0000-0000-0000-000000000001": READER },
        );
        expect(tree).toEqual([
            { id: "/", name: "Contoso user", level: "root", parentId: null },
            { id: `${MG}/00000000-0000-0000-0000-000000000011`, name: "Contoso user", level: "managementGroup", parentId: "/" },
            { id: "/subscriptions/00000000-0000-0000-0000-000000000001", name: "Contoso user", level: "subscription", parentId: `${MG}/00000000-0000-0000-0000-000000000011`, tenantId: "00000000-0000-0000-0000-000000000099" },
            { id: "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-tenantassesment", name: "rg-tenantassesment", level: "resourceGroup", parentId: "/subscriptions/00000000-0000-0000-0000-000000000001" },
        ]);
    });

    it("nests management groups and places a resource without its own resource group item", () => {
        const T1 = "11111111-1111-1111-1111-111111111111";
        const PROD = "/subscriptions/aaaaaaaa-0000-0000-0000-000000000001";
        const TEST = "/subscriptions/aaaaaaaa-0000-0000-0000-000000000002";
        const tree = buildScopeTree(
            [sub("aaaaaaaa-0000-0000-0000-000000000001", "Contoso Production", T1), sub("aaaaaaaa-0000-0000-0000-000000000002", "Contoso Test", T1)],
            {
                "aaaaaaaa-0000-0000-0000-000000000001": [
                    item("/", "Inherited", "Root"),
                    item(`${MG}/${T1}`, "Inherited", "Tenant Root Group"),
                    item(`${MG}/contoso-platform`, "Inherited", "Contoso Platform"),
                    item(PROD, "Direct", "Contoso Production"),
                    item(`${PROD}/resourceGroups/rg-web/providers/Microsoft.KeyVault/vaults/kv-contoso-web`, "Direct", "kv-contoso-web"),
                    item(`${PROD}/resourceGroups/rg-data`, "Direct", "rg-data"),
                ],
                "aaaaaaaa-0000-0000-0000-000000000002": [
                    item(`${MG}/contoso-platform`, "Inherited", "Contoso Platform"),
                    item(`${TEST}/resourceGroups/rg-sandbox`, "Direct", "rg-sandbox"),
                ],
            },
        );
        expect(tree).toEqual([
            { id: "/", name: "Root", level: "root", parentId: null },
            { id: `${MG}/contoso-platform`, name: "Contoso Platform", level: "managementGroup", parentId: `${MG}/${T1}` },
            { id: `${MG}/${T1}`, name: "Tenant Root Group", level: "managementGroup", parentId: "/" },
            { id: PROD, name: "Contoso Production", level: "subscription", parentId: `${MG}/contoso-platform`, tenantId: "11111111-1111-1111-1111-111111111111" },
            { id: TEST, name: "Contoso Test", level: "subscription", parentId: `${MG}/contoso-platform`, tenantId: "11111111-1111-1111-1111-111111111111" },
            { id: `${PROD}/resourceGroups/rg-data`, name: "rg-data", level: "resourceGroup", parentId: PROD },
            { id: `${TEST}/resourceGroups/rg-sandbox`, name: "rg-sandbox", level: "resourceGroup", parentId: TEST },
            { id: `${PROD}/resourceGroups/rg-web`, name: "rg-web", level: "resourceGroup", parentId: PROD },
            { id: `${PROD}/resourceGroups/rg-web/providers/Microsoft.KeyVault/vaults/kv-contoso-web`, name: "kv-contoso-web", level: "resource", parentId: `${PROD}/resourceGroups/rg-web`, resourceType: "Microsoft.KeyVault/vaults" },
        ]);

        for (const scope of tree) {
            if (scope.level !== "resource") expect("resourceType" in scope).toBe(false);
        }
    });

    it("places two management groups besides the Tenant Root Group under the Tenant Root Group", () => {
        const tree = buildScopeTree(
            [sub("s1", "Sub one", "t1")],
            { s1: [item(`${MG}/t1`, "Inherited", "Tenant Root Group"), item(`${MG}/mg-a`, "Inherited", "A"), item(`${MG}/mg-b`, "Inherited", "B")] },
        );
        expect(tree).toEqual([
            { id: `${MG}/mg-a`, name: "A", level: "managementGroup", parentId: `${MG}/t1` },
            { id: `${MG}/mg-b`, name: "B", level: "managementGroup", parentId: `${MG}/t1` },
            { id: `${MG}/t1`, name: "Tenant Root Group", level: "managementGroup", parentId: null },
            { id: "/subscriptions/s1", name: "Sub one", level: "subscription", parentId: `${MG}/t1`, tenantId: "t1" },
        ]);
    });

    it("leaves a delegated subscription out of the home tenant's tree", () => {
        const HOME = "11111111-1111-1111-1111-111111111111";
        const OTHER = "22222222-2222-2222-2222-222222222222";
        const tree = buildScopeTree(
            [sub("s1", "Home one", HOME), sub("s2", "Home two", HOME), sub("s3", "Delegated", OTHER)],
            {
                s1: [item("/", "Inherited", "Root"), item(`${MG}/${HOME}`, "Inherited", "Tenant Root Group")],
                s2: [item("/", "Inherited", "Root"), item(`${MG}/${HOME}`, "Inherited", "Tenant Root Group")],
                s3: [item("/", "Inherited", "Root")],
            },
        );
        const parentOf = (id: string) => tree.find((s) => s.id === id)?.parentId;
        expect(parentOf("/subscriptions/s3")).toBeNull();
        expect(parentOf("/subscriptions/s1")).toBe(`${MG}/${HOME}`);
        expect(parentOf("/subscriptions/s2")).toBe(`${MG}/${HOME}`);
        expect(parentOf(`${MG}/${HOME}`)).toBe("/");
    });

    it("gives the subscription alone when there are no items", () => {
        expect(buildScopeTree([sub("s1", "Sub one", "t1")], {})).toEqual([
            { id: "/subscriptions/s1", name: "Sub one", level: "subscription", parentId: null, tenantId: "t1" },
        ]);
    });

    it("handles casing, an unknown subscription, a nested resource and a missing expanded name", () => {
        const tree = buildScopeTree(
            [sub("s1", "Sub one", "t1")],
            {
                s1: [
                    item("/subscriptions/s1/resourceGroups/rg-web", "Direct"),
                    item("/subscriptions/S1/resourcegroups/RG-WEB/providers/Microsoft.Web/sites/app1", "Direct"),
                    item("/subscriptions/other/resourceGroups/rg-x", "Direct"),
                    item("/subscriptions/s1/resourceGroups/rg-data/providers/Microsoft.Sql/servers/sql1/databases/db1", "Direct"),
                    item(`${MG}/mg-a`, "Inherited"),
                ],
            },
        );
        expect(tree).toEqual([
            { id: `${MG}/mg-a`, name: "mg-a", level: "managementGroup", parentId: null },
            { id: "/subscriptions/s1", name: "Sub one", level: "subscription", parentId: `${MG}/mg-a`, tenantId: "t1" },
            { id: "/subscriptions/s1/resourceGroups/rg-data", name: "rg-data", level: "resourceGroup", parentId: "/subscriptions/s1" },
            { id: "/subscriptions/s1/resourceGroups/rg-web", name: "rg-web", level: "resourceGroup", parentId: "/subscriptions/s1" },
            { id: "/subscriptions/S1/resourcegroups/RG-WEB/providers/Microsoft.Web/sites/app1", name: "app1", level: "resource", parentId: "/subscriptions/s1/resourceGroups/rg-web", resourceType: "Microsoft.Web/sites" },
            { id: "/subscriptions/s1/resourceGroups/rg-data/providers/Microsoft.Sql/servers/sql1/databases/db1", name: "db1", level: "resource", parentId: "/subscriptions/s1/resourceGroups/rg-data", resourceType: "Microsoft.Sql/servers/databases" },
        ]);
    });

    it("uses the stored id of a management group spelled with other casing", () => {
        const tree = buildScopeTree(
            [sub("s1", "Sub one", "t1"), sub("s2", "Sub two", "t1")],
            {
                s1: [item(`${MG}/contoso-platform`, "Inherited", "Contoso Platform")],
                s2: [item("/PROVIDERS/Microsoft.Management/managementGroups/CONTOSO-PLATFORM", "Inherited", "Contoso Platform")],
            },
        );
        expect(tree).toEqual([
            { id: `${MG}/contoso-platform`, name: "Contoso Platform", level: "managementGroup", parentId: null },
            { id: "/subscriptions/s1", name: "Sub one", level: "subscription", parentId: `${MG}/contoso-platform`, tenantId: "t1" },
            { id: "/subscriptions/s2", name: "Sub two", level: "subscription", parentId: `${MG}/contoso-platform`, tenantId: "t1" },
        ]);
    });
});

describe("toAssignment", () => {
    it("maps the first Owner item", () => {
        expect(toAssignment(OWNER[0])).toEqual({
            id: "/subscriptions/00000000-0000-0000-0000-000000000003/resourceGroups/rg-contoso-app/providers/Microsoft.Authorization/roleAssignmentScheduleInstances/00000000-0000-0000-0000-000000000004",
            scopeId: "/subscriptions/00000000-0000-0000-0000-000000000003/resourceGroups/rg-contoso-app",
            principalId: "00000000-0000-0000-0000-000000000006",
            principalName: "Contoso displayName 3",
            principalType: "ServicePrincipal",
            roleDefinitionId: "b24988ac-6180-42a0-ab88-20f7382dd24c",
            roleName: "Contoso displayName 4",
            state: "active",
            memberType: "direct",
            startDateTime: "2026-02-13T09:42:30.0176247Z",
            endDateTime: null,
        });
    });

    it("maps the Owner item at the root", () => {
        const root = OWNER.find((i) => i.name === "00000000-0000-0000-0000-000000000013")!;
        expect(toAssignment(root)).toEqual({
            id: "/providers/Microsoft.Authorization/roleAssignmentScheduleInstances/00000000-0000-0000-0000-000000000013",
            scopeId: "/",
            principalId: "00000000-0000-0000-0000-000000000008",
            principalName: "Contoso displayName 6",
            principalType: "User",
            roleDefinitionId: "18d7d88d-d35e-4fb5-a5c3-7773c20a72d9",
            roleName: "Contoso displayName 11",
            state: "active",
            memberType: "inherited",
            startDateTime: "2022-11-08T19:30:42.225294Z",
            endDateTime: null,
            principalUpn: "user11@contoso.com",
        });
    });

    it("maps an eligible item without expanded properties", () => {
        expect(toAssignment({
            id: "/subscriptions/s1/providers/Microsoft.Authorization/roleEligibilityScheduleInstances/e1",
            name: "e1",
            type: "Microsoft.Authorization/roleEligibilityScheduleInstances",
            properties: {
                scope: "/subscriptions/s1",
                roleDefinitionId: "/subscriptions/s1/providers/Microsoft.Authorization/roleDefinitions/b24988ac-6180-42a0-ab88-20f7382dd24c",
                principalId: "p2",
                principalType: "Group",
                memberType: "Group",
                status: "Provisioned",
                endDateTime: "2027-01-01T00:00:00Z",
            },
        })).toEqual({
            id: "/subscriptions/s1/providers/Microsoft.Authorization/roleEligibilityScheduleInstances/e1",
            scopeId: "/subscriptions/s1",
            principalId: "p2",
            principalName: "p2",
            principalType: "Group",
            roleDefinitionId: "b24988ac-6180-42a0-ab88-20f7382dd24c",
            roleName: "b24988ac-6180-42a0-ab88-20f7382dd24c",
            state: "eligible",
            memberType: "direct",
            endDateTime: "2027-01-01T00:00:00Z",
            // memberType Group: held through a group (Learn; not measured yet)
            isViaGroup: true,
        });
    });

    it("leaves startDateTime and isViaGroup out when ARM gives no start and the item is direct or inherited", () => {
        const direct = toAssignment(item("/subscriptions/s1", "Direct"));
        const inherited = toAssignment(item("/subscriptions/s1", "Inherited"));
        expect("startDateTime" in direct).toBe(false);
        expect("isViaGroup" in direct).toBe(false);
        expect("isViaGroup" in inherited).toBe(false);
    });

    it("maps an eligibility schedule as eligible, and a custom role as custom", () => {
        const schedule = toAssignment({
            id: "/subscriptions/s1/resourceGroups/rg-ops/providers/Microsoft.Authorization/roleEligibilitySchedules/c1",
            name: "c1",
            type: "Microsoft.Authorization/roleEligibilitySchedules",
            properties: {
                scope: "/subscriptions/s1/resourceGroups/rg-ops",
                roleDefinitionId: "/subscriptions/s1/providers/Microsoft.Authorization/roleDefinitions/e2bfb68a-a9fa-4b1b-90de-f347a25f36a9",
                principalId: "p3",
                principalType: "User",
                memberType: "Direct",
                status: "Provisioned",
                roleEligibilityScheduleRequestId: "/subscriptions/s1/resourceGroups/rg-ops/providers/Microsoft.Authorization/roleEligibilityScheduleRequests/r1",
                expandedProperties: { roleDefinition: { id: "x", displayName: "Contoso Operator", type: "CustomRole" } },
            },
        });
        expect(schedule).toMatchObject({ state: "eligible", memberType: "direct", roleName: "Contoso Operator", isCustomRole: true });
    });

    it("maps every Reader item as active, and the two inherited ones as inherited", () => {
        const rows = READER.map(toAssignment);
        expect(rows.every((r) => r.state === "active")).toBe(true);
        expect(rows.filter((r) => r.memberType === "inherited")).toHaveLength(2);
    });

    it("marks an active instance from an activation, and only that one", () => {
        const base = { ...OWNER[0], properties: { ...OWNER[0].properties } };
        expect(toAssignment({ ...base, properties: { ...base.properties, assignmentType: "Activated" } }).isActivated).toBe(true);
        expect("isActivated" in toAssignment({ ...base, properties: { ...base.properties, assignmentType: "Assigned" } })).toBe(false);
        expect("isActivated" in toAssignment(base)).toBe(false);
        const eligible = { ...base, type: "Microsoft.Authorization/roleEligibilityScheduleInstances", properties: { ...base.properties, assignmentType: "Activated" as const } };
        expect("isActivated" in toAssignment(eligible)).toBe(false);
    });
});

describe("toAssignment principalUpn", () => {
    const base = OWNER[0];
    const withPrincipal = (principal: Record<string, string>) => toAssignment({ ...base, properties: { ...base.properties, expandedProperties: { ...base.properties.expandedProperties, principal: { id: "p", displayName: "P", type: "User", ...principal } } } });

    it("takes the sign-in name, else the e-mail address, else leaves it out", () => {
        expect(withPrincipal({ userPrincipalName: "anna@contoso.com", email: "anna.mail@contoso.com" }).principalUpn).toBe("anna@contoso.com");
        expect(withPrincipal({ email: "anna.mail@contoso.com" }).principalUpn).toBe("anna.mail@contoso.com");
        expect("principalUpn" in withPrincipal({})).toBe(false);
    });
});

describe("topReadableScopes", () => {
    const SUB = "/subscriptions/s2";
    const rg = (name: string) => ({ id: `${SUB}/resourceGroups/${name}` });
    const res = (group: string, path: string) => ({ id: `${SUB}/resourceGroups/${group}/providers/${path}` });

    it("keeps every group and only the resources outside them", () => {
        expect(topReadableScopes([rg("rg-a")], [res("rg-a", "Microsoft.KeyVault/vaults/kv-a"), res("rg-b", "Microsoft.Compute/virtualMachines/vm-b")])).toEqual([
            `${SUB}/resourceGroups/rg-a`,
            `${SUB}/resourceGroups/rg-b/providers/Microsoft.Compute/virtualMachines/vm-b`,
        ]);
    });

    it("compares group ids without case", () => {
        expect(topReadableScopes([{ id: `${SUB}/resourceGroups/RG-A` }], [res("rg-a", "Microsoft.KeyVault/vaults/kv-a")])).toEqual([`${SUB}/resourceGroups/RG-A`]);
    });

    it("reads a parent resource once, not its children, whatever the order", () => {
        const server = res("rg-b", "Microsoft.Sql/servers/sql-b");
        const database = res("rg-b", "Microsoft.Sql/servers/sql-b/databases/db-b");
        expect(topReadableScopes([], [database, server])).toEqual([server.id]);
    });

    it("gives nothing when nothing is readable", () => {
        expect(topReadableScopes([], [])).toEqual([]);
    });
});

describe("toAssignment and custom roles", () => {
    const item = (type: string) => ({
        id: "/subscriptions/s1/providers/Microsoft.Authorization/roleAssignmentScheduleInstances/a",
        name: "a",
        type: "Microsoft.Authorization/roleAssignmentScheduleInstances",
        properties: {
            scope: "/subscriptions/s1",
            roleDefinitionId: "/subscriptions/s1/providers/Microsoft.Authorization/roleDefinitions/r1",
            principalId: "p",
            principalType: "User",
            memberType: "Direct" as const,
            status: "Provisioned",
            expandedProperties: { roleDefinition: { id: "r1", displayName: "Deployer", type } },
        },
    });

    it("marks a role whose expanded type is CustomRole", () => {
        expect(toAssignment(item("CustomRole")).isCustomRole).toBe(true);
        expect("isCustomRole" in toAssignment(item("BuiltInRole"))).toBe(false);
    });
});

describe("isCurrentSchedule", () => {
    const NOW = Date.parse("2026-10-22T12:00:00Z");
    const schedule = (startDateTime?: string, endDateTime?: string | null): ArmRoleScheduleInstance => ({
        id: "x",
        name: "x",
        type: "Microsoft.Authorization/roleEligibilitySchedules",
        properties: { scope: "/subscriptions/s1", roleDefinitionId: "r", principalId: "p", principalType: "User", memberType: "Direct", status: "Provisioned", startDateTime, endDateTime },
    });

    it("keeps a started schedule without an end, or with an end after now", () => {
        expect(isCurrentSchedule(schedule("2026-10-01T00:00:00Z"), NOW)).toBe(true);
        expect(isCurrentSchedule(schedule("2026-10-01T00:00:00Z", null), NOW)).toBe(true);
        expect(isCurrentSchedule(schedule("2026-10-01T00:00:00Z", "2026-10-22T12:00:01Z"), NOW)).toBe(true);
        expect(isCurrentSchedule(schedule(undefined, "2027-01-01T00:00:00Z"), NOW)).toBe(true);
    });

    it("drops a schedule that starts after now or has ended", () => {
        expect(isCurrentSchedule(schedule("2026-10-22T12:00:01Z", "2027-01-01T00:00:00Z"), NOW)).toBe(false);
        expect(isCurrentSchedule(schedule("2026-10-01T00:00:00Z", "2026-10-22T12:00:00Z"), NOW)).toBe(false);
    });
});

describe("buildScopeTree with the hierarchy from getEntities", () => {
    const T = "11111111-1111-1111-1111-111111111111";
    const ROOT = `${MG}/${T}`;
    const LZ = `${MG}/landingzones`;
    const CORP = `${MG}/corp`;
    const S1 = "aaaaaaaa-0000-0000-0000-000000000001";
    const S9 = "bbbbbbbb-0000-0000-0000-000000000009";
    const entity = (id: string, displayName: string, parent?: string) => ({
        id,
        name: id.split("/").pop() ?? id,
        type: id.startsWith("/subscriptions") ? "/subscriptions" : "Microsoft.Management/managementGroups",
        properties: { displayName, parent: parent ? { id: parent } : {}, tenantId: T },
    });
    const entities = [
        entity(ROOT, "Tenant Root Group"),
        entity(LZ, "Landing Zones", ROOT),
        entity(CORP, "Corp", LZ),
        entity(`/subscriptions/${S1}`, "Apps", CORP),
    ];
    // Items only on the Tenant Root Group, Landing Zones and the subscription: Corp has none
    const instances = { [S1]: [item(ROOT, "Inherited", "Tenant Root Group"), item(LZ, "Inherited", "Landing Zones"), item(`/subscriptions/${S1}`, "Direct", "Apps")] };
    const subs = [sub(S1, "Apps", T)];
    const parentOf = (scopes: ReturnType<typeof buildScopeTree>, id: string) => scopes.find((s) => s.id === id)?.parentId;

    it("adds the group between two scopes of the tree and nests the groups and the subscription under it", () => {
        const scopes = buildScopeTree(subs, instances, entities);
        expect(scopes.find((s) => s.id === CORP)).toMatchObject({ name: "Corp", level: "managementGroup" });
        expect(parentOf(scopes, CORP)).toBe(LZ);
        expect(parentOf(scopes, LZ)).toBe(ROOT);
        expect(parentOf(scopes, `/subscriptions/${S1}`)).toBe(CORP);
    });

    it("matches ids without regard to case", () => {
        const lower = entities.map((e) => ({ ...e, id: e.id.toLowerCase(), properties: { ...e.properties, parent: e.properties.parent.id ? { id: e.properties.parent.id.toLowerCase() } : {} } }));
        const scopes = buildScopeTree(subs, instances, lower);
        // The added group keeps the id as getEntities wrote it; the groups seen in the instances keep theirs
        expect(parentOf(scopes, `/subscriptions/${S1}`)).toBe(CORP.toLowerCase());
        expect(parentOf(scopes, LZ)).toBe(ROOT);
    });

    it("gives the flat result without entities and with an empty list", () => {
        const flat = buildScopeTree(subs, instances);
        expect(buildScopeTree(subs, instances, [])).toEqual(flat);
        expect(flat.some((s) => s.id === CORP)).toBe(false);
        expect(parentOf(flat, `/subscriptions/${S1}`)).toBe(LZ);
    });

    it("leaves a delegated subscription its own tree", () => {
        const scopes = buildScopeTree([...subs, sub(S9, "Fabrikam", "99999999-9999-9999-9999-999999999999")], { ...instances, [S9]: [] }, entities);
        expect(parentOf(scopes, `/subscriptions/${S9}`)).toBeNull();
        expect(parentOf(scopes, `/subscriptions/${S1}`)).toBe(CORP);
    });
});
