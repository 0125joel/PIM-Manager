import { describe, expect, it } from "vitest";
import readerFixture from "@/__tests__/fixtures/azure/reader-subscription-instances.json";
import type { ArmRoleScheduleInstance } from "@/types/azureResource.types";
import type { LoadingPhase } from "@/types/workload.types";
import { DEFAULT_AZURE_FILTERS, EMPTY_AZURE_FILTERS } from "@/utils/azureReport";
import { azureReportView, azureSyncedText, isDelegatedScope, isFiltered, loadingPercent, loadingSubscriptionCount, toMyRoleRow } from "@/utils/azureReportStates";

const READER = readerFixture.value as unknown as ArmRoleScheduleInstance[];

describe("azureReportView", () => {
    it.each([
        ["complete", 3, "report"],
        ["error", 3, "report"],
        ["fetching", 3, "report"],
        ["error", 0, "failed"],
        ["complete", 0, "empty"],
        ["idle", 0, "loading"],
        ["fetching", 0, "loading"],
        ["processing", 0, "loading"],
    ])("phase %s with %i scopes is %s", (phase, scopeCount, expected) => {
        expect(azureReportView({ phase: phase as LoadingPhase, scopeCount })).toBe(expected);
    });
});

describe("loadingPercent", () => {
    it("is null without a total and capped at 100", () => {
        expect(loadingPercent({ current: 0, total: 0 })).toBeNull();
        expect(loadingPercent({ current: 1, total: 3 })).toBe(33);
        expect(loadingPercent({ current: 2, total: 2 })).toBe(100);
        expect(loadingPercent({ current: 5, total: 2 })).toBe(100);
    });
});

describe("isFiltered", () => {
    it("is false for the empty filters and a blank query", () => {
        expect(isFiltered(EMPTY_AZURE_FILTERS)).toBe(false);
        expect(isFiltered({ ...EMPTY_AZURE_FILTERS, query: "   " })).toBe(false);
        expect(isFiltered({ ...EMPTY_AZURE_FILTERS, origin: "all" })).toBe(false);
    });

    it("is true when the query, status or Origin Inherited is set", () => {
        expect(isFiltered({ ...EMPTY_AZURE_FILTERS, query: "x" })).toBe(true);
        expect(isFiltered({ ...EMPTY_AZURE_FILTERS, origin: "inherited" })).toBe(true);
        expect(isFiltered({ ...EMPTY_AZURE_FILTERS, status: "assigned" })).toBe(true);
        expect(isFiltered({ ...EMPTY_AZURE_FILTERS, privileged: true })).toBe(true);
        expect(isFiltered({ ...EMPTY_AZURE_FILTERS, principalType: "user" })).toBe(true);
        expect(isFiltered({ ...EMPTY_AZURE_FILTERS, ends: "permanent" })).toBe(true);
        expect(isFiltered({ ...EMPTY_AZURE_FILTERS, level: "resource" })).toBe(true);
        expect(isFiltered({ ...EMPTY_AZURE_FILTERS, resourceType: "microsoft.keyvault/vaults" })).toBe(true);
    });

    it.each([
        { customRole: true }, { approval: "required" }, { justification: "notRequired" }, { mfa: "neither" }, { maxDuration: "over8h" },
        { notified: "none" }, { via: "direct" }, { noEligible: true }, { excludeEmergency: true }, { role: "8e3af657-a8ff-443c-a75c-2fe8c4bcb635" },
        { principalType: "guest" }, { level: "subscriptionOrAbove" },
    ] as const)("is true for the dashboard key %j", (patch) => {
        expect(isFiltered({ ...EMPTY_AZURE_FILTERS, ...patch })).toBe(true);
    });

    it("is false for the default Origin This scope", () => {
        expect(isFiltered(DEFAULT_AZURE_FILTERS)).toBe(false);
    });
});

describe("toMyRoleRow", () => {
    it("takes names from the expanded properties", () => {
        const row = toMyRoleRow(READER[0]);
        expect(row.roleName).toBe(READER[0].properties.expandedProperties?.roleDefinition?.displayName);
        expect(row.scopeName).toBe(READER[0].properties.expandedProperties?.scope?.displayName);
        expect(row.endText).toBe("Permanent");
        expect(row.isPermanent).toBe(true);
        expect(row.id).toBe(READER[0].id);
    });

    it("falls back to the ids without expanded properties", () => {
        expect(
            toMyRoleRow({
                id: "/subscriptions/s1/providers/Microsoft.Authorization/roleEligibilityScheduleInstances/e1",
                name: "e1",
                type: "Microsoft.Authorization/roleEligibilityScheduleInstances",
                properties: { scope: "/subscriptions/s1", roleDefinitionId: "/providers/Microsoft.Authorization/roleDefinitions/b24988ac-6180-42a0-ab88-20f7382dd24c", principalId: "me", principalType: "User", memberType: "Direct", status: "Provisioned", endDateTime: "not a date" },
            }),
        ).toEqual({ id: "/subscriptions/s1/providers/Microsoft.Authorization/roleEligibilityScheduleInstances/e1", roleName: "b24988ac-6180-42a0-ab88-20f7382dd24c", scopeName: "/subscriptions/s1", endText: "not a date", isPermanent: false });
    });
});

describe("azureSyncedText", () => {
    const now = new Date("2026-10-19T12:00:00Z");

    it("reads the sync time as on the dashboard while nothing loads", () => {
        expect(azureSyncedText("2026-10-19T11:57:00Z", "complete", now)).toBe("synced 3 min ago");
        expect(azureSyncedText("2026-10-19T11:59:40Z", "complete", now)).toBe("synced just now");
    });

    it("is undefined without a load time, with an invalid one, or while loading", () => {
        expect(azureSyncedText(undefined, "complete", now)).toBeUndefined();
        expect(azureSyncedText("x", "complete", now)).toBeUndefined();
        expect(azureSyncedText("2026-10-19T11:57:00Z", "fetching", now)).toBeUndefined();
    });
});

describe("isDelegatedScope", () => {
    it("is true for a subscription of another tenant than the user's", () => {
        expect(isDelegatedScope({ level: "subscription", tenantId: "T-2" }, "t-1")).toBe(true);
    });

    it("is false for a subscription of the user's own tenant, ignoring case", () => {
        expect(isDelegatedScope({ level: "subscription", tenantId: "T-2" }, "t-2")).toBe(false);
    });

    it("is false without a tenant on either side, and for a resource group", () => {
        expect(isDelegatedScope({ level: "subscription", tenantId: undefined }, "t-1")).toBe(false);
        expect(isDelegatedScope({ level: "subscription", tenantId: "T-2" }, undefined)).toBe(false);
        expect(isDelegatedScope({ level: "resourceGroup", tenantId: "T-2" }, "t-1")).toBe(false);
    });
});

describe("loadingSubscriptionCount", () => {
    it("counts the subscriptions still loading below their own level", () => {
        expect(loadingSubscriptionCount([
            { level: "subscription", access: "loading" },
            { level: "subscription", access: "partial" },
            { level: "subscription" },
            { level: "resourceGroup" },
            { level: "subscription", access: "loading" },
        ])).toBe(2);
        expect(loadingSubscriptionCount([])).toBe(0);
    });
});
