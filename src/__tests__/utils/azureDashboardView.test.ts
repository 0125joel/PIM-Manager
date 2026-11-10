import { describe, expect, it } from "vitest";
import type { ArmRoleManagementAlert, AzureAssignment, AzureScope } from "@/types/azureResource.types";
import { DEFAULT_AZURE_FILTERS, EMPTY_AZURE_FILTERS, type AzureReportFilters } from "@/utils/azureReport";
import { azureScopePath, buildAzureDashboardView, countAzureScopes, hasPartialInView, summarizeAzureAlerts, type AzureAlertsOutcome } from "@/utils/azureDashboardView";

const MG = "/providers/Microsoft.Management/managementGroups/mg1";
const SA = "/subscriptions/sa";
const SB = "/subscriptions/sb";
const SD = "/subscriptions/sd";
const RG = "/subscriptions/sa/resourceGroups/rg1";

const OWNER = "8e3af657-a8ff-443c-a75c-2fe8c4bcb635";
const CONTRIB = "b24988ac-6180-42a0-ab88-20f7382dd24c";
const READER = "acdd72a7-3385-48ef-bd42-f606fba81ae7";

const NOW = new Date("2026-10-24T12:00:00Z");

const scopes: AzureScope[] = [
    { id: MG, name: "Contoso MG", level: "managementGroup", parentId: null },
    { id: SA, name: "Sub A", level: "subscription", parentId: MG, tenantId: "t-home" },
    { id: SB, name: "Sub B", level: "subscription", parentId: MG, tenantId: "t-home", access: "partial" },
    { id: SD, name: "Sub D", level: "subscription", parentId: null, tenantId: "t-other" },
    { id: RG, name: "rg1", level: "resourceGroup", parentId: SA },
];

function a(id: string, scopeId: string, roleDefinitionId: string, over: Partial<AzureAssignment> = {}): AzureAssignment {
    return { id, scopeId, roleDefinitionId, roleName: id, principalId: `p-${id}`, principalName: id, principalType: "User", state: "active", memberType: "direct", endDateTime: null, ...over };
}

const assignments: AzureAssignment[] = [
    a("mg-owner", MG, OWNER),
    a("sa-owner", SA, OWNER, { state: "eligible" }),
    a("rg-contributor", RG, CONTRIB, { endDateTime: "2026-12-01T00:00:00Z" }),
    a("sb-reader", SB, READER, { state: "eligible" }),
    a("sd-owner", SD, OWNER),
];

function view(over: Partial<Parameters<typeof buildAzureDashboardView>[0]> = {}) {
    return buildAzureDashboardView({
        assignments,
        scopes,
        chosenScopeId: null,
        includeInherited: false,
        includeDelegated: true,
        homeTenantId: "t-home",
        filters: EMPTY_AZURE_FILTERS,
        context: {},
        now: NOW,
        ...over,
    });
}

const ids = (list: AzureAssignment[]) => list.map((x) => x.id);

describe("buildAzureDashboardView: in view", () => {
    it("holds every assignment at the top scope", () => {
        expect(ids(view().inView)).toEqual(["mg-owner", "sa-owner", "rg-contributor", "sb-reader", "sd-owner"]);
    });

    it("leaves the delegated subscription out when delegated is off", () => {
        expect(ids(view({ includeDelegated: false }).inView)).toEqual(["mg-owner", "sa-owner", "rg-contributor", "sb-reader"]);
    });

    it("holds the chosen scope and what is below it, and what is above only with Include inherited", () => {
        expect(ids(view({ chosenScopeId: SA }).inView)).toEqual(["sa-owner", "rg-contributor"]);
        expect(ids(view({ chosenScopeId: SA, includeInherited: true }).inView)).toEqual(["mg-owner", "sa-owner", "rg-contributor"]);
    });

    it("holds the assignments of a management group's subscriptions below it, and its own", () => {
        expect(ids(view({ chosenScopeId: MG }).inView)).toEqual(["mg-owner", "sa-owner", "rg-contributor", "sb-reader"]);
    });

    it("compares scope ids without case", () => {
        expect(ids(view({ chosenScopeId: SA.toUpperCase() }).inView)).toEqual(["sa-owner", "rg-contributor"]);
    });

    it("leaves a delegated subscription out of a chosen scope view when delegated is off", () => {
        expect(ids(view({ chosenScopeId: SD, includeDelegated: false }).inView)).toEqual([]);
        expect(ids(view({ chosenScopeId: SD }).inView)).toEqual(["sd-owner"]);
    });
});

describe("buildAzureDashboardView: counted", () => {
    it("is the view without a filter", () => {
        const result = view({ chosenScopeId: SA, includeInherited: true });
        expect(ids(result.counted)).toEqual(ids(result.inView));
    });

    it("narrows the view to the filter", () => {
        const result = view({ filters: { ...EMPTY_AZURE_FILTERS, status: "active" } });
        expect(ids(result.inView)).toHaveLength(5);
        expect(ids(result.counted)).toEqual(["mg-owner", "rg-contributor", "sd-owner"]);
    });

    it("applies a filter to the assignments above the chosen scope too", () => {
        const result = view({ chosenScopeId: SA, includeInherited: true, filters: { ...EMPTY_AZURE_FILTERS, ends: "permanent", status: "active" } });
        expect(ids(result.counted)).toEqual(["mg-owner"]);
    });

    it("does not let the origin here or all change what is counted", () => {
        const base = { chosenScopeId: SA, includeInherited: true };
        const origins: AzureReportFilters["origin"][] = ["here", "all"];
        for (const origin of origins) {
            const filters = { ...DEFAULT_AZURE_FILTERS, origin };
            expect(ids(view({ ...base, filters }).counted)).toEqual(["mg-owner", "sa-owner", "rg-contributor"]);
        }
    });

    it("counts only what is above the chosen scope for the origin inherited", () => {
        const filters = { ...DEFAULT_AZURE_FILTERS, origin: "inherited" as const };
        expect(ids(view({ chosenScopeId: SA, includeInherited: true, filters }).counted)).toEqual(["mg-owner"]);
        expect(ids(view({ chosenScopeId: null, includeInherited: true, filters }).counted)).toEqual([]);
    });

    it("leaves out an assignment on a scope that is not in the tree", () => {
        const stray = a("stray", "/subscriptions/unknown", OWNER);
        const result = view({ assignments: [...assignments, stray] });
        expect(ids(result.inView)).toContain("stray");
        expect(ids(result.counted)).not.toContain("stray");
    });

    it("excludes a role x scope with an eligible assignment for noEligible", () => {
        const result = view({ filters: { ...EMPTY_AZURE_FILTERS, noEligible: true } });
        // Owner on Sub A has an eligible assignment; the other Owner pairs do not
        expect(ids(result.counted)).toEqual(["mg-owner", "rg-contributor", "sd-owner"]);
    });
});

describe("azureScopePath", () => {
    it("gives the names from the top to the chosen scope", () => {
        expect(azureScopePath(scopes, RG)).toEqual(["Contoso MG", "Sub A", "rg1"]);
        expect(azureScopePath(scopes, SD)).toEqual(["Sub D"]);
    });

    it("is empty without a chosen scope or for a scope that is not in the tree", () => {
        expect(azureScopePath(scopes, null)).toEqual([]);
        expect(azureScopePath(scopes, "/subscriptions/unknown")).toEqual([]);
    });
});

describe("countAzureScopes", () => {
    it("counts management groups, subscriptions, the readable home ones and the delegated ones", () => {
        expect(countAzureScopes(scopes, "t-home")).toEqual({
            managementGroups: 1,
            subscriptions: 3,
            homeSubscriptions: 2,
            readableSubscriptions: 1,
            // The visibility line counts home and delegated together: SA and the delegated one are read, SB is partial
            readableAllSubscriptions: 2,
            delegatedSubscriptions: 1,
            hasUnreadable: true,
        });
    });

    it("has nothing unreadable when every home subscription is read as a whole", () => {
        const counts = countAzureScopes(scopes.filter((s) => s.id !== SB), "t-home");
        expect(counts.hasUnreadable).toBe(false);
        expect(counts.readableSubscriptions).toBe(1);
    });
});

describe("hasPartialInView", () => {
    it("names a partial subscription only when it is in view", () => {
        expect(hasPartialInView(scopes, null, true, "t-home")).toBe(true);
        // The management group holds SB; SA and its resource group do not
        expect(hasPartialInView(scopes, MG, true, "t-home")).toBe(true);
        expect(hasPartialInView(scopes, SB, true, "t-home")).toBe(true);
        expect(hasPartialInView(scopes, SA, true, "t-home")).toBe(false);
        expect(hasPartialInView(scopes, RG, true, "t-home")).toBe(false);
        expect(hasPartialInView(scopes, SD, true, "t-home")).toBe(false);
    });

    it("leaves a partial delegated subscription out while delegated subscriptions are off", () => {
        const withPartialDelegated = scopes.map((s) => (s.id === SB ? { ...s, access: undefined } : s.id === SD ? { ...s, access: "partial" as const } : s));
        expect(hasPartialInView(withPartialDelegated, null, true, "t-home")).toBe(true);
        expect(hasPartialInView(withPartialDelegated, null, false, "t-home")).toBe(false);
    });
});

function alert(name: string, over: Partial<ArmRoleManagementAlert["properties"]> & { severity?: string } = {}): ArmRoleManagementAlert {
    const { severity, ...rest } = over;
    return {
        id: name,
        name,
        properties: {
            isActive: false,
            incidentCount: 0,
            lastScannedDateTime: "2026-10-23T08:00:00Z",
            alertDefinition: { properties: { displayName: `Alert ${name}`, severityLevel: severity ?? "Medium", description: "d", mitigationSteps: "m" } },
            ...rest,
        },
    };
}

describe("summarizeAzureAlerts", () => {
    const names: Record<string, string> = { s1: "Prod", s2: "Test", s3: "Fresh", s4: "Partner", s5: "Clear" };
    const outcomes = new Map<string, AzureAlertsOutcome>([
        ["s1", { status: "loaded", alerts: [alert("owners", { isActive: true, incidentCount: 4 }), alert("outside", { isActive: true, incidentCount: 1, severity: "High" })] }],
        ["s2", { status: "loaded", alerts: [alert("owners", { isActive: true, incidentCount: 2 })] }],
        ["s3", { status: "loaded", alerts: [alert("a", { lastScannedDateTime: "0001-01-01T00:00:00-08:00" }), alert("b", { lastScannedDateTime: "" })] }],
        ["s4", { status: "loaded", alerts: [alert("a", { lastScannedDateTime: "0001-01-01T00:00:00-08:00" })] }],
        ["s5", { status: "loaded", alerts: [alert("a"), alert("b", { lastScannedDateTime: "0001-01-01T00:00:00Z" })] }],
        ["s6", { status: "noAccess" }],
        ["s7", { status: "failed" }],
    ]);

    it("counts what was read, with an alert, clear, not scanned yet and not readable", () => {
        const summary = summarizeAzureAlerts(outcomes, (id) => names[id] ?? id, (id) => id === "s4");
        expect(summary).toMatchObject({ read: 5, delegatedRead: 1, withAlert: 2, notScanned: 2, clear: 1, notReadable: 2 });
    });

    it("lists the active alerts, High before Medium, with their subscription", () => {
        const summary = summarizeAzureAlerts(outcomes, (id) => names[id] ?? id, () => false);
        expect(summary.rows.map((r) => [r.name, r.subscriptionName, r.severity, r.incidentCount])).toEqual([
            ["Alert outside", "Prod", "High", 1],
            ["Alert owners", "Prod", "Medium", 4],
            ["Alert owners", "Test", "Medium", 2],
        ]);
    });

    it("counts a subscription with an active alert as one with an alert, never as not scanned", () => {
        const only = new Map<string, AzureAlertsOutcome>([["s1", { status: "loaded", alerts: [alert("x", { isActive: true, lastScannedDateTime: "0001-01-01T00:00:00Z" })] }]]);
        expect(summarizeAzureAlerts(only, (id) => id, () => false)).toMatchObject({ withAlert: 1, notScanned: 0, clear: 0 });
    });
});
