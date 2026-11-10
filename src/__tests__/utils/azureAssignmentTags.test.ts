import { describe, it, expect } from "vitest";
import { azureAssignmentTags } from "@/utils/azureAssignmentTags";
import { DELETED_PRINCIPAL } from "@/utils/azureDashboard";
import type { AzureAssignment } from "@/types/azureResource.types";

const fmt = (iso: string) => `D(${iso})`;
const NONE: ReadonlySet<string> = new Set();

const base: AzureAssignment = {
    id: "a",
    scopeId: "/subscriptions/s1",
    principalId: "P-1",
    principalName: "Anna",
    principalType: "User",
    roleDefinitionId: "r",
    roleName: "Reader",
    state: "active",
    memberType: "direct",
    endDateTime: null,
};

describe("azureAssignmentTags", () => {
    it("base assignment without emergency access: User, Active, Permanent (warn), Assigned", () => {
        const tags = azureAssignmentTags(base, NONE, fmt);
        expect(tags.map((t) => t.label)).toEqual(["User", "Active", "Permanent", "Assigned"]);
        expect(tags[2]).toMatchObject({ term: "permanent", variant: "warn" });
    });

    it("activated and time-bound: Expires with its date, then Activated", () => {
        const tags = azureAssignmentTags({ ...base, isActivated: true, endDateTime: "2026-11-01T00:00:00Z" }, NONE, fmt);
        expect(tags.map((t) => t.label)).toEqual(["User", "Active", "Expires D(2026-11-01T00:00:00Z)", "Activated"]);
        expect(tags[2].term).toBe("expires");
    });

    it("eligible without end date: User, Eligible, No end date", () => {
        const tags = azureAssignmentTags({ ...base, state: "eligible", endDateTime: null }, NONE, fmt);
        expect(tags.map((t) => t.label)).toEqual(["User", "Eligible", "No end date"]);
    });

    it("service principal: first label App, term app", () => {
        const tags = azureAssignmentTags({ ...base, principalType: "ServicePrincipal" }, NONE, fmt);
        expect(tags[0]).toMatchObject({ label: "App", term: "app" });
    });

    it("deleted principal: first label Deleted, warn, term deleted", () => {
        const tags = azureAssignmentTags(base, NONE, fmt, new Map([["p-1", DELETED_PRINCIPAL]]));
        expect(tags[0]).toMatchObject({ label: "Deleted", term: "deleted", variant: "warn" });
    });

    it("foreign group: first label Foreign group, term foreignGroup", () => {
        const tags = azureAssignmentTags({ ...base, principalType: "ForeignGroup" }, NONE, fmt);
        expect(tags[0]).toMatchObject({ label: "Foreign group", term: "foreignGroup" });
    });

    it("unknown principal type: first label Device, term null", () => {
        const tags = azureAssignmentTags({ ...base, principalType: "Device" }, NONE, fmt);
        expect(tags[0]).toMatchObject({ label: "Device", term: null });
    });

    it("emergency access account: last tag Emergency access, band, emergency-access icon", () => {
        const tags = azureAssignmentTags(base, new Set(["p-1"]), fmt);
        expect(tags[tags.length - 1]).toEqual({ term: "emergency", label: "Emergency access", variant: "band", icon: "emergency-access" });
    });

    it("guest, agent and managed identity tags", () => {
        expect(azureAssignmentTags({ ...base, principalUpn: "a_b.com#EXT#@t.onmicrosoft.com" }, NONE, fmt)[0]).toEqual({ term: "guest", label: "Guest" });
        expect(azureAssignmentTags({ ...base, principalType: "AgentIdentity" }, NONE, fmt)[0]).toEqual({ term: "agent", label: "Agent" });
        const mi = { ...base, principalType: "ServicePrincipal" };
        expect(azureAssignmentTags(mi, NONE, fmt, new Map([["p-1", "ManagedIdentity"]]))[0]).toEqual({ term: "managedIdentity", label: "Managed identity" });
        expect(azureAssignmentTags(mi, NONE, fmt)[0]).toEqual({ term: "app", label: "App" });
    });

    it("device and other unknown types have no term", () => {
        expect(azureAssignmentTags({ ...base, principalType: "Device" }, NONE, fmt)[0]).toEqual({ term: null, label: "Device" });
        expect(azureAssignmentTags({ ...base, principalType: "Something" }, NONE, fmt)[0]).toEqual({ term: null, label: "Unknown" });
    });
});
