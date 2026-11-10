import { describe, expect, it } from "vitest";
import { AZURE_FIXTURE_PANEL_ID, buildAzurePanelSettings, buildAzureReportFixture } from "@/__tests__/fixtures/azureReportFixture";

describe("buildAzureReportFixture", () => {
    it("gives 12 scopes and 17 assignments", () => {
        const { scopes, assignments } = buildAzureReportFixture();
        expect(scopes).toHaveLength(12);
        expect(assignments).toHaveLength(17);
    });

    it("has one root and every other parent in the list", () => {
        const { scopes } = buildAzureReportFixture();
        const ids = new Set(scopes.map((s) => s.id));
        const roots = scopes.filter((s) => s.parentId === null);
        expect(roots).toHaveLength(1);
        expect(roots[0].level).toBe("root");
        for (const s of scopes.filter((x) => x.parentId !== null)) {
            expect(ids.has(s.parentId as string)).toBe(true);
        }
    });

    it("gives resource scopes a resourceType and no other scope", () => {
        const { scopes } = buildAzureReportFixture();
        const resources = scopes.filter((s) => s.level === "resource");
        expect(resources).toHaveLength(4);
        expect(resources.every((s) => s.resourceType !== undefined)).toBe(true);
        expect(resources.map((s) => s.resourceType).sort()).toEqual([
            "Microsoft.EventHub/namespaces",
            "Microsoft.KeyVault/vaults",
            "Microsoft.Storage/storageAccounts",
            "Microsoft.Web/sites",
        ]);
        for (const s of scopes.filter((x) => x.level !== "resource")) {
            expect("resourceType" in s).toBe(false);
        }
    });

    it("has the panel assignment on Contoso Production", () => {
        const { scopes, assignments } = buildAzureReportFixture();
        const a = assignments.find((x) => x.id === AZURE_FIXTURE_PANEL_ID);
        expect(a).toBeDefined();
        expect(a?.roleName).toBe("Owner");
        expect(a?.state).toBe("eligible");
        expect(a?.scopeId).toBe(scopes.find((s) => s.name === "Contoso Production")?.id);
    });

    it("has every assignment scope in the list", () => {
        const { scopes, assignments } = buildAzureReportFixture();
        const ids = new Set(scopes.map((s) => s.id));
        for (const a of assignments) expect(ids.has(a.scopeId)).toBe(true);
    });

    it("does not depend on the clock", () => {
        expect(buildAzureReportFixture()).toEqual(buildAzureReportFixture());
    });
});

describe("buildAzurePanelSettings", () => {
    it("has MFA, PT8H and no approval", () => {
        const s = buildAzurePanelSettings();
        expect(s.activationRequirement).toBe("mfa");
        expect(s.maxActivationDuration).toBe("PT8H");
        expect(s.requireApproval).toBe(false);
    });
});
