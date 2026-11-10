import { describe, expect, it } from "vitest";
import type { ArmRoleDefinition, ArmRoleManagementAlert, AzureAssignment, AzureScope } from "@/types/azureResource.types";
import { azurePolicyKey } from "@/utils/azureScopes";
import { computeAzureCards, computeAzureEasyToMiss, type AzureDashboardInput, type AzureSettingsOutcome } from "@/utils/azureDashboardStats";
import type { AzureAlertsOutcome } from "@/utils/azureDashboardView";
import {
    AZURE_EXPORT_BLOCKS,
    azureExportFileStem,
    buildAzureDashboardCsvRows,
    buildAzureDashboardExportReport,
    defaultAzureBlocks,
    type AzureDashboardExportInput,
    type AzureExportOptions,
} from "@/utils/azureDashboardExport";

const MG = "/providers/Microsoft.Management/managementGroups/mg1";
const S1 = "/subscriptions/s1";
const S2 = "/subscriptions/s2";
const RG = "/subscriptions/s1/resourceGroups/rg1";
const RES = "/subscriptions/s1/resourceGroups/rg1/providers/Microsoft.KeyVault/vaults/kv1";

const OWNER = "8e3af657-a8ff-443c-a75c-2fe8c4bcb635";
const CONTRIB = "b24988ac-6180-42a0-ab88-20f7382dd24c";
const READER = "acdd72a7-3385-48ef-bd42-f606fba81ae7";
const CUSTOM = "cccccccc-0000-0000-0000-000000000001";
const KVADMIN = "00482a5a-887f-4fb3-b363-3b7fe8e74483";

const NOW = new Date("2026-10-24T12:00:00Z");
const inHours = (h: number) => new Date(NOW.getTime() + h * 3600000).toISOString();
const inDays = (d: number) => inHours(d * 24);

const scopes: AzureScope[] = [
    { id: MG, name: "Contoso MG", level: "managementGroup", parentId: null },
    { id: S1, name: "Prod Sub", level: "subscription", parentId: MG, tenantId: "t-home" },
    { id: S2, name: "Partner Sub", level: "subscription", parentId: MG, tenantId: "t-other" },
    { id: RG, name: "rg1", level: "resourceGroup", parentId: S1 },
    { id: RES, name: "kv1", level: "resource", parentId: RG, resourceType: "Microsoft.KeyVault/vaults" },
];

function a(id: string, scopeId: string, roleDefinitionId: string, roleName: string, principalId: string, principalName: string, over: Partial<AzureAssignment> = {}): AzureAssignment {
    return { id, scopeId, roleDefinitionId, roleName, principalId, principalName, principalType: "User", state: "active", memberType: "direct", endDateTime: null, ...over };
}

const assignments: AzureAssignment[] = [
    a("a1", MG, OWNER, "Owner", "u-alice", "Alice", { memberType: "inherited" }),
    a("a2", MG, OWNER, "Owner", "u-bg", "Break Glass", { memberType: "inherited" }),
    a("a3", S1, OWNER, "Owner", "u-bob", "Bob", { state: "eligible" }),
    a("a4", S1, OWNER, "Owner", "u-bob", "Bob", { endDateTime: inHours(2), isActivated: true }),
    a("a5", S1, CONTRIB, "Contributor", "u-carol", "Carol", { state: "eligible", endDateTime: inDays(3), principalUpn: "carol_x.com#EXT#@c.onmicrosoft.com" }),
    a("a6", S1, CONTRIB, "Contributor", "u-app1", "App One", { principalType: "ServicePrincipal" }),
    a("a7", S1, CONTRIB, "Contributor", "u-mi1", "MI One", { principalType: "ServicePrincipal" }),
    a("a8", S1, READER, "Reader", "u-agent1", "Agent One", { principalType: "AgentIdentity", endDateTime: inDays(10) }),
    a("a9", RG, READER, "Reader", "u-dave", "Dave", { state: "eligible" }),
    a("a10", RG, CUSTOM, "Custom", "u-erin", "Erin", { isCustomRole: true }),
    a("a11", RES, KVADMIN, "Key Vault Administrator", "u-frank", "Frank", { state: "eligible", endDateTime: inDays(20) }),
    a("a12", RES, CONTRIB, "Contributor", "u-grp1", "Group One", { principalType: "Group" }),
    a("a13", RES, CONTRIB, "Contributor", "u-grace", "Grace", { isViaGroup: true }),
    a("a14", S2, OWNER, "Owner", "u-henk", "Henk"),
    a("a15", S1, CONTRIB, "Contributor", "u-alice", "Alice", { state: "eligible", memberType: "inherited" }),
];

function def(roleName: string, actions: string[]): ArmRoleDefinition {
    return { id: roleName, name: roleName, type: "Microsoft.Authorization/roleDefinitions", properties: { roleName, permissions: [{ actions }] } };
}
const definitions = new Map<string, ArmRoleDefinition>([
    [CUSTOM, def("Custom", ["*"])],
    [READER, def("Reader", ["*/read"])],
    [KVADMIN, def("Key Vault Administrator", ["Microsoft.Authorization/*/read"])],
]);

const spTypes = new Map([["u-app1", "Application"], ["u-mi1", "ManagedIdentity"]]);

const GROUP_APPROVER = "11111111-aaaa-4aaa-8aaa-111111111111";
const ANN = "22222222-bbbb-4bbb-8bbb-222222222222";

interface RuleSpec {
    approval?: boolean;
    approvers?: Record<string, unknown>[];
    mfa?: boolean;
    maxDuration: string;
    notifyDefaults: boolean;
}

function loaded(spec: RuleSpec): AzureSettingsOutcome {
    const caller = { caller: "EndUser" };
    return {
        status: "loaded",
        rules: [
            { id: "Approval_EndUser_Assignment", "@odata.type": "#microsoft.graph.unifiedRoleManagementPolicyApprovalRule", target: caller, setting: { isApprovalRequired: spec.approval === true, approvalStages: [{ primaryApprovers: spec.approvers ?? [] }] } },
            { id: "Enablement_EndUser_Assignment", "@odata.type": "#microsoft.graph.unifiedRoleManagementPolicyEnablementRule", target: caller, enabledRules: spec.mfa ? ["MultiFactorAuthentication"] : [] },
            { id: "Expiration_EndUser_Assignment", "@odata.type": "#microsoft.graph.unifiedRoleManagementPolicyExpirationRule", target: caller, maximumDuration: spec.maxDuration },
            { id: "Notification_Admin_EndUser_Assignment", "@odata.type": "#microsoft.graph.unifiedRoleManagementPolicyNotificationRule", target: { caller: "Admin" }, isDefaultRecipientsEnabled: spec.notifyDefaults, notificationRecipients: [] },
        ],
    };
}

const approvers = [
    { "@odata.type": "#microsoft.graph.groupMembers", groupId: GROUP_APPROVER, description: "Security Approvers" },
    { "@odata.type": "#microsoft.graph.singleUser", userId: ANN, description: "Ann" },
];

const settings = new Map<string, AzureSettingsOutcome>([
    [azurePolicyKey(MG, OWNER), loaded({ approval: true, approvers, mfa: true, maxDuration: "PT8H", notifyDefaults: true })],
    [azurePolicyKey(S1, OWNER), loaded({ mfa: true, maxDuration: "PT10H", notifyDefaults: false })],
    [azurePolicyKey(S1, CONTRIB), loaded({ maxDuration: "PT4H", notifyDefaults: false })],
    [azurePolicyKey(S1, READER), loaded({ maxDuration: "PT12H", notifyDefaults: true })],
    [azurePolicyKey(RG, CUSTOM), { status: "noAccess" }],
    [azurePolicyKey(RES, KVADMIN), { status: "failed" }],
    [azurePolicyKey(RES, CONTRIB), { status: "missing" }],
    [azurePolicyKey(S2, OWNER), loaded({ maxDuration: "PT90M", notifyDefaults: false })],
]);

function stats(list: AzureAssignment[]): AzureDashboardInput {
    return { assignments: list, scopes, homeTenantId: "t-home", definitions, settings, spTypes, emergencyIds: new Set(["u-bg"]), now: NOW, isTopScope: true, chosenScopeId: null, scope: "privileged" };
}

function alert(name: string, over: Partial<ArmRoleManagementAlert["properties"]> = {}, severity = "Medium"): ArmRoleManagementAlert {
    return { id: name, name, properties: { isActive: false, incidentCount: 0, lastScannedDateTime: "2026-10-23T00:00:00Z", alertDefinition: { properties: { displayName: `Alert ${name}`, severityLevel: severity } }, ...over } };
}

const alerts = new Map<string, AzureAlertsOutcome>([
    ["s1", { status: "loaded", alerts: [alert("owners", { isActive: true, incidentCount: 3 }, "High")] }],
    ["s2", { status: "loaded", alerts: [alert("owners")] }],
    ["s3", { status: "loaded", alerts: [alert("a", { lastScannedDateTime: "0001-01-01T00:00:00-08:00" })] }],
    ["s4", { status: "noAccess" }],
]);

const eligibleOnly = assignments.filter((x) => x.state === "eligible");

function exportInput(over: Partial<AzureDashboardExportInput> = {}): AzureDashboardExportInput {
    return {
        stats: stats(eligibleOnly),
        statsWithoutFilter: stats(assignments),
        reads: { alerts },
        scopeLine: "All you can read",
        includeInherited: true,
        includeDelegated: true,
        filterSentence: "Eligible",
        subscriptionName: (id) => ({ s1: "Prod Sub", s2: "Partner Sub" })[id] ?? id,
        meta: { tenantName: "Contoso", tenantId: "t-home", exporter: "Alex (alex@contoso.com)", version: "v3.2.0", exportedAt: NOW },
        ...over,
    };
}

function options(over: Partial<AzureExportOptions> = {}): AzureExportOptions {
    return { detail: "full", audience: "admin", chartStyle: "bars", anonymise: false, applyFilter: true, blocks: defaultAzureBlocks("full"), ...over };
}

describe("a failed settings read in the export", () => {
    it("is named as could not be read, not as still loading, and is not counted as not required", () => {
        const failed = new Map(settings);
        failed.set(azurePolicyKey(S1, OWNER), { status: "failed" });
        // The missing pair of the fixture is in `unloaded` too: loaded here, so only the failed pair is not
        failed.set(azurePolicyKey(RES, CONTRIB), loaded({ maxDuration: "PT4H", notifyDefaults: true }));
        const withFailed = (list: AzureAssignment[]): AzureDashboardInput => ({ ...stats(list), settings: failed });
        const report = buildAzureDashboardExportReport(exportInput({ stats: withFailed(assignments), statsWithoutFilter: withFailed(assignments) }), options());
        expect(report.notes).toContain("1 role × scope has settings that could not be read: they are left out of the settings numbers and charts. Refresh the dashboard and export again.");
        expect(report.notes.some((n) => n.includes("still loading"))).toBe(false);
        const before = buildAzureDashboardExportReport(exportInput({ stats: stats(assignments), statsWithoutFilter: stats(assignments) }), options());
        const approval = (r: typeof report) => r.numbers?.find((n) => n.label === "Require approval");
        expect(approval(before)?.note).toBe("of 5 privileged role × scope");
        expect(approval(report)?.note).toBe("of 4 privileged role × scope");
        expect(approval(report)?.value).toBe(approval(before)?.value);
    });
});

describe("defaultAzureBlocks", () => {
    it("turns on numbers, attention, alerts and posture for a summary, and everything for full", () => {
        const summary = defaultAzureBlocks("summary");
        expect(AZURE_EXPORT_BLOCKS.filter((b) => summary[b.key]).map((b) => b.key)).toEqual(["numbers", "attention", "alerts", "posture"]);
        expect(Object.values(defaultAzureBlocks("full")).every(Boolean)).toBe(true);
    });
});

describe("buildAzureDashboardExportReport header", () => {
    it("says what is counted and names the filter when it is applied", () => {
        const header = buildAzureDashboardExportReport(exportInput(), options()).header;
        expect(header).toMatchObject({
            title: "PIM Manager Azure dashboard",
            tenant: "Contoso",
            counted: ["All you can read", "Including inherited assignments", "Delegated subscriptions counted"],
            filter: "Eligible",
            isAnonymised: false,
        });
    });

    it("leaves the filter out when it is off, and when none is active", () => {
        expect(buildAzureDashboardExportReport(exportInput(), options({ applyFilter: false })).header.filter).toBeNull();
        expect(buildAzureDashboardExportReport(exportInput({ filterSentence: "" }), options()).header.filter).toBeNull();
    });

    it("says when inherited and delegated are off", () => {
        const header = buildAzureDashboardExportReport(exportInput({ includeInherited: false, includeDelegated: false, scopeLine: "Contoso MG / Prod Sub" }), options()).header;
        expect(header.counted).toEqual(["Contoso MG / Prod Sub", "Without inherited assignments", "Delegated subscriptions left out"]);
    });
});

describe("buildAzureDashboardExportReport content", () => {
    it("has the eight cards of the dashboard as numbers, for the filter on and off", () => {
        for (const applyFilter of [true, false]) {
            const input = exportInput();
            const cards = computeAzureCards(applyFilter ? input.stats : input.statsWithoutFilter);
            const report = buildAzureDashboardExportReport(input, options({ applyFilter }));
            expect(report.numbers).toHaveLength(8);
            expect(report.numbers?.map((n) => [n.value, n.note])).toEqual(
                (["roleScope", "activeNow", "permanent", "eligible", "privileged", "requireApproval", "customRoles", "inherited"] as const).map((id) => [cards[id].value ?? "not loaded", cards[id].breakdown]),
            );
        }
        expect(buildAzureDashboardExportReport(exportInput(), options()).numbers?.[0].label).toBe("Role × scope");
    });

    it("lists the Easy to miss rows with their counts", () => {
        const input = exportInput();
        const easy = computeAzureEasyToMiss(input.stats);
        const report = buildAzureDashboardExportReport(input, options());
        // Rows with 0 or an unknown count are left out, as Entra does
        expect(report.attention?.map((r) => [r.label, r.count])).toEqual(easy.filter((r) => r.count !== null && r.count > 0).map((r) => [r.label, r.count]));
        expect(report.attention?.every((r) => r.count > 0)).toBe(true);
    });

    it("has no tables in a summary and no appendix", () => {
        const report = buildAzureDashboardExportReport(exportInput(), options({ detail: "summary", blocks: defaultAzureBlocks("summary") }));
        expect(report.tables).toEqual([]);
        expect(report.appendix).toBeNull();
        expect(report.glossary).toBeNull();
        expect(report.numbers).not.toBeNull();
        expect(report.charts?.length).toBeGreaterThan(0);
    });

    it("has a findings table per Easy to miss row above 0 in a full report, with the count of the row", () => {
        const input = exportInput({ stats: stats(assignments) });
        const easy = computeAzureEasyToMiss(input.stats).filter((r) => r.count !== null && r.count > 0);
        const report = buildAzureDashboardExportReport(input, options());
        const findings = report.tables.filter((t) => t.block === "findings");
        expect(easy.length).toBeGreaterThan(0);
        expect(findings.map((t) => t.id)).toEqual(easy.map((r) => r.id));
        for (const row of easy) {
            const table = findings.find((t) => t.id === row.id);
            // The count is the number of rows in the whole table, and the number of the Easy to miss row
            expect(table?.count).toBe(row.count);
            expect(table?.rows.length).toBe(Math.min(row.count ?? 0, 10));
            const unit: Record<string, string[]> = {
                permanentOwners: ["Who", "Role", "Scope"],
                eligibleWithoutEnd: ["Who", "Role", "Scope"],
                nobodyNotified: ["Role", "Scope"],
                onlyPermanent: ["Role", "Scope"],
            };
            expect(table?.columns.map((c) => c.label)).toEqual(unit[row.id] ?? ["Who", "Roles"]);
        }
        // One row per principal: Carol is a guest, App One an app
        expect(findings.find((t) => t.id === "guests")?.rows).toEqual([["Carol", "Contributor · Prod Sub"]]);
        expect(findings.find((t) => t.id === "apps")?.rows).toEqual([["App One", "Contributor · Prod Sub"]]);
        // One row per role x scope
        expect(findings.find((t) => t.id === "onlyPermanent")?.columns.map((c) => c.label)).toEqual(["Role", "Scope"]);
        // Permanent Owners at subscription or above: Alice on the management group, Henk on the partner subscription (Break Glass is emergency access)
        expect(findings.find((t) => t.id === "permanentOwners")?.rows).toEqual([["Alice", "Owner", "Contoso MG"], ["Henk", "Owner", "Partner Sub"]]);
    });

    it("shows the first 3 roles of a principal and then +n", () => {
        const guest = (id: string, scopeId: string) => a(id, scopeId, CONTRIB, "Contributor", "u-carol", "Carol", { principalUpn: "carol_x.com#EXT#@c.onmicrosoft.com" });
        const many = [...assignments, guest("g1", RG), guest("g2", RES), guest("g3", MG), guest("g4", S2)];
        const report = buildAzureDashboardExportReport(exportInput({ stats: stats(many) }), options());
        const guests = report.tables.find((t) => t.id === "guests");
        expect(guests?.count).toBe(1);
        expect(guests?.rows).toEqual([["Carol", "Contributor · Contoso MG, Contributor · Partner Sub, Contributor · Prod Sub, +2"]]);
    });

    it("names Azure resources in the header environment", () => {
        expect(buildAzureDashboardExportReport(exportInput(), options()).header.environment).toBe("Azure resources");
    });

    it("has the emergency, accounts, approvers and right now tables in a full report", () => {
        const report = buildAzureDashboardExportReport(exportInput({ stats: stats(assignments) }), options());
        const ids = report.tables.map((t) => t.id);
        expect(ids).toEqual(expect.arrayContaining(["emergency", "accounts", "approvers", "activatedNow", "endingSoon"]));
        expect(report.tables.find((t) => t.id === "emergency")?.rows).toEqual([["Break Glass", "permanent", "Owner · Contoso MG"]]);
        expect(report.glossary?.map((g) => g.term)).toContain("Privileged roles");
    });

    it("turns a block off", () => {
        const report = buildAzureDashboardExportReport(exportInput(), options({ blocks: { ...defaultAzureBlocks("full"), numbers: false, attention: false } }));
        expect(report.numbers).toBeNull();
        expect(report.attention).toBeNull();
    });

    it("counts the alerts: open, and the subscriptions that are clear, with the notes", () => {
        const report = buildAzureDashboardExportReport(exportInput(), options());
        expect(report.alerts).toEqual({ openCount: 1, passedCount: 1, rows: [{ title: "Alert owners (Prod Sub)", severity: "High", affected: 3 }] });
        expect(report.notes.some((n) => n.includes("not been scanned"))).toBe(true);
        expect(report.notes.some((n) => n.includes("could not be read"))).toBe(true);
    });

    it("leaves the alerts of a delegated subscription out when delegated subscriptions are off", () => {
        const report = buildAzureDashboardExportReport(exportInput({ includeDelegated: false }), options());
        expect(report.alerts?.passedCount).toBe(0);
        expect(report.alerts?.openCount).toBe(1);
    });
});

describe("buildAzureDashboardExportReport names", () => {
    const users = ["Alice", "Bob", "Carol", "Dave", "Erin", "Frank", "Grace", "Henk", "Break Glass", "Ann"];

    it.each([
        ["anonymise", options({ anonymise: true, applyFilter: false })],
        ["management", options({ audience: "management", applyFilter: false })],
    ])("replaces users and guests by Person n everywhere (%s)", (_name, opts) => {
        const report = buildAzureDashboardExportReport(exportInput(), opts);
        const text = JSON.stringify(report);
        for (const user of users) expect(text).not.toContain(user);
        expect(text).toContain("Person 1");
        expect(report.header.isAnonymised).toBe(true);
        // Apps, managed identities, agents and groups keep their names; so does the group that approves
        for (const kept of ["App One", "MI One", "Agent One", "Security Approvers"]) expect(text).toContain(kept);
    });

    it("keeps the names when they are not replaced", () => {
        const text = JSON.stringify(buildAzureDashboardExportReport(exportInput({ stats: stats(assignments) }), options()));
        expect(text).toContain("Henk");
        expect(text).toContain("Ann");
    });

    it("gives a person the same label with the filter on and off", () => {
        const on = buildAzureDashboardExportReport(exportInput(), options({ anonymise: true, applyFilter: true }));
        const off = buildAzureDashboardExportReport(exportInput(), options({ anonymise: true, applyFilter: false }));
        const label = (r: typeof on) => r.tables.find((t) => t.id === "eligibleWithoutEnd")?.rows.map((row) => row[0]).sort();
        expect(label(on)).toBeDefined();
        for (const who of label(on) ?? []) expect(label(off)).toContain(who);
    });
});

describe("buildAzureDashboardCsvRows", () => {
    it("has a row per counted assignment, and per assignment in view when the filter is off", () => {
        expect(buildAzureDashboardCsvRows(exportInput(), options({ applyFilter: true }))).toHaveLength(eligibleOnly.length);
        expect(buildAzureDashboardCsvRows(exportInput(), options({ applyFilter: false }))).toHaveLength(assignments.length);
    });

    it("writes the columns of the Azure Report and leaves names and object ids out when names are replaced", () => {
        const rows = buildAzureDashboardCsvRows(exportInput(), options({ applyFilter: false, anonymise: true }));
        const bob = rows.find((r) => r.role === "Owner" && r.scope === "Prod Sub" && r.assignment === "Eligible");
        expect(bob).toMatchObject({ workload: "Azure resource role", name: "Person 4", objectId: "", upn: "" });
        const app = rows.find((r) => r.name === "App One");
        expect(app).toMatchObject({ objectId: "u-app1", principalType: "App" });
        expect(rows.find((r) => r.name === "Break Glass")).toBeUndefined();
    });
});

describe("azureExportFileStem", () => {
    it("is pim-azure-dashboard, the tenant and the date", () => {
        expect(azureExportFileStem("Contoso Ltd.", new Date("2026-10-24T22:00:00Z"))).toBe("pim-azure-dashboard-contoso-ltd-2026-10-24");
        expect(azureExportFileStem(null, new Date("2026-10-24T22:00:00Z"))).toBe("pim-azure-dashboard-tenant-2026-10-24");
    });
});

describe("appendix", () => {
    const csvCount = (opts: AzureExportOptions) => buildAzureDashboardCsvRows(exportInput(), opts).length;

    it.each(["summary", "full"] as const)("is null for %s", (detail) => {
        expect(buildAzureDashboardExportReport(exportInput(), options({ detail, blocks: defaultAzureBlocks(detail) })).appendix).toBeNull();
    });

    it("is null for management, also with appendix", () => {
        expect(buildAzureDashboardExportReport(exportInput(), options({ detail: "appendix", audience: "management" })).appendix).toBeNull();
    });

    it("has a row per CSV row for admin, with the filter on and off", () => {
        for (const applyFilter of [true, false]) {
            const opts = options({ detail: "appendix", applyFilter, blocks: defaultAzureBlocks("appendix") });
            const report = buildAzureDashboardExportReport(exportInput(), opts);
            expect(report.appendix).toHaveLength(csvCount(opts));
        }
        expect(csvCount(options({ applyFilter: true }))).toBe(eligibleOnly.length);
        expect(csvCount(options({ applyFilter: false }))).toBe(assignments.length);
    });

    it("fills the Azure fields", () => {
        const rows = buildAzureDashboardExportReport(exportInput(), options({ detail: "appendix", applyFilter: false })).appendix ?? [];
        expect(rows.find((r) => r.name === "Bob" && r.type === "Eligible")).toMatchObject({ workload: "Azure resource role", resource: "Owner", kind: "User", memberType: "Direct", scope: "Prod Sub (Subscription)", resourceId: OWNER, objectId: "u-bob" });
        expect(rows.find((r) => r.name === "Grace")?.memberType).toBe("Group");
        expect(rows.find((r) => r.name === "Break Glass")).toMatchObject({ type: "Permanent", emergency: true });
    });

    it("has no user name, upn or object id when names are replaced", () => {
        const report = buildAzureDashboardExportReport(exportInput(), options({ detail: "appendix", anonymise: true, applyFilter: false }));
        const text = JSON.stringify(report.appendix);
        for (const user of ["Alice", "Bob", "Carol", "Dave", "Erin", "Frank", "Grace", "Henk", "Break Glass", "u-alice", "u-bob", "carol_x.com"]) expect(text).not.toContain(user);
        expect(text).toContain("Person 1");
        expect(text).toContain("u-app1");
    });

    it("says all assignments are in the appendix in the more note", () => {
        const many = Array.from({ length: 12 }, (_, i) => a(`x${i}`, S1, OWNER, "Owner", `u-p${i}`, `P${i}`, { state: "eligible" }));
        const input = exportInput({ stats: stats([...assignments, ...many]), statsWithoutFilter: stats([...assignments, ...many]) });
        const notes = (detail: "full" | "appendix") => buildAzureDashboardExportReport(input, options({ detail, blocks: defaultAzureBlocks(detail) })).tables.map((t) => t.note ?? "").join("|");
        expect(notes("appendix")).toContain("All assignments are in the appendix.");
        expect(notes("full")).not.toContain("All assignments are in the appendix.");
    });
});
