import { describe, expect, it } from "vitest";
import { buildAzurePanelRules } from "@/__tests__/fixtures/azureReportFixture";
import type { AzureAssignment, AzureScope } from "@/types/azureResource.types";
import type { AzureAssignmentRow } from "@/utils/azureReport";
import {
    AZURE_ASSIGNMENT_COLUMNS, AZURE_ROLE_SETTINGS_COLUMNS, anonymiseAzure, buildAzureAssignmentRows, buildAzureRoleSettingsRows, rolePairsOf, subscriptionOf,
    type AzurePolicyOutcome, type AzureRolePair,
} from "@/utils/azureExportRows";
import { policyTileTexts } from "@/utils/exportRows";
import { writeCsv } from "@/utils/exportSchema";

const ROOT: AzureScope = { id: "/", name: "Root", level: "root", parentId: null };
const MG: AzureScope = { id: "/providers/Microsoft.Management/managementGroups/contoso", name: "Contoso", level: "managementGroup", parentId: "/" };
const SUB: AzureScope = { id: "/subscriptions/s1", name: "Contoso Production", level: "subscription", parentId: MG.id, tenantId: "home" };
const LH: AzureScope = { id: "/subscriptions/s2", name: "Fabrikam", level: "subscription", parentId: MG.id, tenantId: "other" };
const RG: AzureScope = { id: "/subscriptions/s1/resourceGroups/rg-web", name: "rg-web", level: "resourceGroup", parentId: SUB.id };
const KV: AzureScope = { id: "/subscriptions/s1/resourceGroups/rg-web/providers/Microsoft.KeyVault/vaults/kv-web", name: "kv-web", level: "resource", parentId: RG.id, resourceType: "Microsoft.KeyVault/vaults" };
const SCOPES = [ROOT, MG, SUB, LH, RG, KV];
const OWNER = "8e3af657-a8ff-443c-a75c-2fe8c4bcb635";
const READER = "acdd72a7-3385-48ef-bd42-f606fba81ae7";

const assignment = (extra: Partial<AzureAssignment> = {}): AzureAssignment => ({
    id: "a1", scopeId: KV.id, principalId: "P-1", principalName: "Adele Vance", principalType: "User", principalUpn: "adele@contoso.com",
    roleDefinitionId: OWNER, roleName: "Owner", state: "eligible", memberType: "direct", startDateTime: "2026-10-01T08:00:00Z", endDateTime: "2027-01-01T00:00:00Z", ...extra,
});
const row = (a: AzureAssignment, scope: AzureScope = KV, extra: Partial<AzureAssignmentRow> = {}): AzureAssignmentRow => ({
    assignment: a, scope, isInherited: false, originText: "This scope", endText: "", principalTypeLabel: "User", ...extra,
});
const CTX = { scopes: SCOPES, emergencyIds: new Set<string>(), homeTenantId: "home" };
const one = (a: AzureAssignment, scope: AzureScope = KV, ctx = CTX) => buildAzureAssignmentRows([row(a, scope)], ctx)[0];

describe("buildAzureAssignmentRows", () => {
    it("fills every column for an eligible row", () => {
        const result = buildAzureAssignmentRows([row(assignment())], { ...CTX, emergencyIds: new Set(["p-1"]) });
        expect(result).toEqual([{
            workload: "Azure resource role", role: "Owner", assignment: "Eligible", name: "Adele Vance", upn: "adele@contoso.com", objectId: "P-1",
            principalType: "User", memberType: "Direct", start: "2026-10-01", end: "2027-01-01", scope: "kv-web", scopeLevel: "Resource", scopeId: KV.id,
            resourceType: "Microsoft.KeyVault/vaults", subscription: "Contoso Production", delegated: false, roleId: OWNER, roleType: "Built-in",
            privileged: true, emergency: true, origin: "", inherited: false,
        }]);
        expect(AZURE_ASSIGNMENT_COLUMNS.map((c) => c.key)).toEqual(Object.keys(result[0]));
    });

    it("sets Assignment and Origin", () => {
        const active = { state: "active" as const };
        expect(one(assignment({ ...active, endDateTime: null }))).toMatchObject({ assignment: "Permanent", origin: "Assigned" });
        expect(one(assignment({ ...active }))).toMatchObject({ assignment: "Active", origin: "Assigned" });
        expect(one(assignment({ ...active, endDateTime: null, isActivated: true }))).toMatchObject({ assignment: "Active", origin: "Activated" });
    });

    it("sets member type, role type and privileged", () => {
        expect(one(assignment({ isViaGroup: true })).memberType).toBe("Group");
        expect(one(assignment({ isCustomRole: true })).roleType).toBe("Custom");
        expect(one(assignment({ roleDefinitionId: READER })).privileged).toBe(false);
        expect(one(assignment({ roleDefinitionId: OWNER.toUpperCase() })).privileged).toBe(true);
    });

    it("finds the subscription and Delegated", () => {
        expect(one(assignment(), MG)).toMatchObject({ subscription: "", delegated: false });
        expect(one(assignment(), LH)).toMatchObject({ subscription: "Fabrikam", delegated: true });
        expect(one(assignment(), SUB)).toMatchObject({ subscription: "Contoso Production", delegated: false });
        expect(one(assignment(), LH, { scopes: SCOPES, emergencyIds: new Set() } as typeof CTX).delegated).toBe(false);
        expect(subscriptionOf(RG, [RG])).toBeNull();
    });

    it("leaves the object id out after anonymising", () => {
        expect(buildAzureAssignmentRows([row(assignment())], { ...CTX, anonymisedIds: new Set(["p-1"]) })[0].objectId).toBe("");
    });

    it("defuses a formula in a name", () => {
        const csv = writeCsv({ columns: AZURE_ASSIGNMENT_COLUMNS }, buildAzureAssignmentRows([row(assignment({ principalName: '=HYPERLINK("x")' }))], CTX));
        expect(csv).toContain('"\'=HYPERLINK(""x"")"');
    });
});

describe("rolePairsOf", () => {
    it("gives one pair per role and scope, in tree order", () => {
        const pairs = rolePairsOf([
            row(assignment({ scopeId: RG.id, roleDefinitionId: READER, roleName: "Reader" }), RG),
            row(assignment({ scopeId: SUB.id }), SUB),
            row(assignment({ scopeId: SUB.id, principalId: "P-2" }), SUB),
            row(assignment({ scopeId: RG.id.toUpperCase() }), RG),
        ], SCOPES);
        expect(pairs.map((p) => [p.roleName, p.scope.id])).toEqual([["Owner", SUB.id], ["Owner", RG.id], ["Reader", RG.id]]);
    });
});

describe("buildAzureRoleSettingsRows", () => {
    const pair: AzureRolePair = { scopeId: SUB.id, roleDefinitionId: OWNER, roleName: "Owner", isCustom: false, scope: SUB };
    const build = (outcome: AzurePolicyOutcome | undefined) => buildAzureRoleSettingsRows([pair], () => outcome)[0];

    it("describes every outcome", () => {
        expect(build({ status: "loaded", rules: [], lastModified: "2026-10-22T08:15:00Z" })).toMatchObject({ settings: "Loaded", changed: true, lastChanged: "2026-10-22" });
        expect(build({ status: "loaded", rules: [], lastModified: null })).toMatchObject({ settings: "Loaded", changed: false, lastChanged: "" });
        expect(build({ status: "missing" })).toMatchObject({ settings: "No role settings", changed: undefined, lastChanged: "" });
        expect(build({ status: "noAccess" }).settings).toBe("Not readable");
        expect(build({ status: "unavailable" }).settings).toBe("Not available at root");
        expect(build({ status: "failed" }).settings).toBe("Not loaded");
        expect(build(undefined).settings).toBe("Not loaded");
        expect(build(undefined)).toMatchObject({
            role: "Owner", roleId: OWNER, roleType: "Built-in", privileged: true, scope: "Contoso Production", scopeLevel: "Subscription", scopeId: SUB.id,
        });
        // Root is never read: without an outcome it still says so, not "Not loaded"
        const atRoot: AzureRolePair = { ...pair, scopeId: ROOT.id, scope: ROOT };
        expect(buildAzureRoleSettingsRows([atRoot], () => undefined)[0].settings).toBe("Not available at root");
        expect(AZURE_ROLE_SETTINGS_COLUMNS.slice(0, 10).map((c) => c.key)).toEqual(["role", "roleId", "roleType", "privileged", "scope", "scopeLevel", "scopeId", "settings", "changed", "lastChanged"]);
    });

    it("adds the tiles of a loaded policy", () => {
        const rules = buildAzurePanelRules();
        const result = build({ status: "loaded", rules, lastModified: null });
        const tiles = policyTileTexts(rules, { isPrivileged: true });
        expect(result["tile.maxDuration"]).toBeTruthy();
        expect(result["tile.require"]).toBeTruthy();
        expect(result["tile.maxDuration"]).toBe(tiles["tile.maxDuration"]);
        expect(result["tile.require"]).toBe(tiles["tile.require"]);
    });
});

describe("anonymiseAzure", () => {
    const rows = [
        row(assignment({ id: "1", principalId: "P-1" })),
        row(assignment({ id: "2", principalId: "P-1", roleName: "Reader" })),
        row(assignment({ id: "3", principalId: "P-2", principalName: "Lee Gu" })),
        row(assignment({ id: "4", principalId: "G-1", principalName: "Ops team", principalType: "Group", principalUpn: undefined }), KV, { principalTypeLabel: "Group" }),
    ];
    const pair: AzureRolePair = { scopeId: SUB.id, roleDefinitionId: OWNER, roleName: "Owner", isCustom: false, scope: SUB };
    const rules = [
        { setting: { approvalStages: [{ primaryApprovers: [{ userId: "P-2", description: "Lee Gu" }] }] } },
        { notificationRecipients: ["lee@contoso.com"] },
    ];

    it("replaces users by the same label and leaves groups and the input alone", () => {
        const before = JSON.stringify(rows);
        const result = anonymiseAzure(rows, () => undefined);
        expect(result.rows.map((r) => r.assignment.principalName)).toEqual(["Person 1", "Person 1", "Person 2", "Ops team"]);
        expect(result.rows.map((r) => r.assignment.principalUpn)).toEqual([undefined, undefined, undefined, undefined]);
        expect([...result.ids].sort()).toEqual(["p-1", "p-2"]);
        expect(JSON.stringify(rows)).toBe(before);
    });

    it("scrubs the rules with the same labels and caches per pair", () => {
        const result = anonymiseAzure(rows, () => ({ status: "loaded", rules, lastModified: null }));
        const outcome = result.outcomeOf(pair);
        if (outcome?.status !== "loaded") throw new Error("expected loaded");
        const approver = (outcome.rules[0] as { setting: { approvalStages: { primaryApprovers: { description: string }[] }[] } }).setting.approvalStages[0].primaryApprovers[0];
        expect(approver.description).toBe("Person 2");
        expect((outcome.rules[1] as { notificationRecipients: string[] }).notificationRecipients).toEqual(["Person 3"]);
        expect(result.outcomeOf(pair)).toBe(outcome);
    });
});
