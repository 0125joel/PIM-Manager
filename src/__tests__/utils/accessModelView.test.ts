import { describe, expect, it } from "vitest";
import bundled from "@/config/accessModel/eam-catalog.json";
import { GLOBAL_ADMIN_TEMPLATE_ID, buildReportGroups, buildReportRoles } from "@/__tests__/fixtures/reportFixture";
import { parseAccessModelCatalog, type AccessModelCatalog, type LoadedCatalog } from "@/utils/accessModelCatalog";
import {
    EMPTY_ROLE_FILTER,
    catalogLine,
    catalogRoleRows,
    compareRole,
    countGrid,
    describeConfig,
    filterCatalogRoles,
    groupPlacementRows,
    levelRuleCounts,
    levelSettingRows,
    toggleCell,
} from "@/utils/accessModelView";

const parsed = parseAccessModelCatalog(bundled);
const catalog = (parsed.ok ? parsed.catalog : null) as AccessModelCatalog;
const roles = buildReportRoles();
const NOW = new Date(2026, 9, 4, 14, 0);
const contexts = [{ id: "c-sif", displayName: "Phish resistant SIF" }, { id: "c-other", displayName: "Something else" }];

describe("access model page as data (spec 8)", () => {
    it("the catalog line, live and fallback", () => {
        const live: LoadedCatalog = { catalog, origin: "live", readAt: new Date(2026, 9, 4, 13, 40) };
        expect(catalogLine(live, NOW)).toBe(`Catalog of ${catalog.catalogVersion} from pimmonitor.com, read after sign-in at 13:40.`);
        expect(catalogLine({ ...live, origin: "bundled", fallbackReason: "unreachable" }, NOW)).toMatch(/ships with this PIM Manager version\. pimmonitor\.com could not be reached\.$/);
        expect(catalogLine({ ...live, origin: "bundled", fallbackReason: "newerVersion" }, NOW)).toMatch(/^This catalog needs a newer PIM Manager\./);
    });

    it("the level rules count every role once", () => {
        const counts = levelRuleCounts(catalog);
        expect(counts.isPrivileged + counts.fullControl + counts.permissions).toBe(catalog.roles.length);
        expect(counts.isPrivileged).toBe(catalog.roles.filter((r) => r.isPrivileged).length);
    });

    it("one row per level when the planes agree, with the tenant's context by name", () => {
        const rows = levelSettingRows(catalog, contexts, {});
        expect(rows.map((r) => r.level)).toEqual(["Privileged", "Specialized", "Enterprise"]);
        expect(rows[0]).toMatchObject({ maxActivation: "1 hour", approval: "Yes", justification: "Yes", label: { text: "Phishing-resistant + sign-in frequency", slug: "phish-resistant-sif" }, inTenant: { name: "Phish resistant SIF", how: "byName" } });
        expect(rows[1].inTenant).toEqual({ name: null, how: "notMatched" });
        expect(rows[2]).toMatchObject({ maxActivation: "8 hours", approval: "No", label: { text: "Standard MFA", slug: null }, inTenant: null });
        expect(levelSettingRows(catalog, contexts, { "phish-resistant-no-sif": "c-other" })[1].inTenant).toEqual({ name: "Something else", how: "chosen" });
    });

    it("a label no context name matches is matched by its Conditional Access policy when that read is there (C2-03)", () => {
        const withRequirements = { ...catalog, authContexts: catalog.authContexts.map((c) => (c.slug === "phish-resistant-no-sif" ? { ...c, requireState: "enabled", requireAuthStrengthId: "00000000-0000-0000-0000-000000000004" } : c)) } as AccessModelCatalog;
        const policies = [{
            state: "enabled",
            conditions: { applications: { includeAuthenticationContextClassReferences: ["c-other"] } },
            grantControls: { builtInControls: [], authenticationStrength: { id: "00000000-0000-0000-0000-000000000004" } },
        }];
        expect(levelSettingRows(withRequirements, contexts, {})[1].inTenant).toEqual({ name: null, how: "notMatched" });
        expect(levelSettingRows(withRequirements, contexts, {}, policies)[1].inTenant).toEqual({ name: "Something else", how: "byPolicy" });
    });

    it("rows per plane when the planes differ", () => {
        const levels = catalog.levels.map((l) => (l.plane === "Data" && l.securityLevel === "Privileged" ? { ...l, expectedConfig: { ...l.expectedConfig, maxActivationDuration: "PT2H" } } : l));
        expect(levelSettingRows({ ...catalog, levels }, [], {}).filter((r) => r.level.endsWith("Privileged")).map((r) => r.level)).toEqual(["Control · Privileged", "Management · Privileged", "Data · Privileged"]);
    });

    it("the count grid adds up per plane and in total", () => {
        const grid = countGrid(catalog);
        expect(grid.rows.map((r) => r.plane)).toEqual(["Control", "Management", "Data"]);
        expect(grid.rows.reduce((sum, r) => sum + r.total, 0)).toBe(grid.total);
        expect(grid.total).toBe(catalog.roles.length);
    });

    it("the recommended settings in words", () => {
        expect(describeConfig({ maxActivationDuration: "PT1H", requireApproval: true, authContext: "phish-resistant-sif" }, catalog)).toBe("1 hour, approval, Phishing-resistant + sign-in frequency");
        expect(describeConfig({ maxActivationDuration: "PT8H", requireApproval: false, requireMFA: true }, catalog)).toBe("8 hours, no approval, Standard MFA");
    });
});

describe("roles of the catalog against the tenant", () => {
    it("a row per catalog role, sorted, with Why and the tenant comparison", () => {
        const rows = catalogRoleRows(catalog, roles, contexts, {});
        expect(rows).toHaveLength(catalog.roles.length);
        expect([...rows].map((r) => r.name)).toEqual([...rows].map((r) => r.name).sort((a, b) => a.localeCompare(b)));
        const ga = rows.find((r) => r.templateId === GLOBAL_ADMIN_TEMPLATE_ID)!;
        expect(ga).toMatchObject({ plane: "Control", level: "Privileged", reason: "isPrivileged", reasonText: "Microsoft marks it privileged", privileged: "Yes" });
        expect(ga.why.description).toMatch(/^Can manage all aspects of Microsoft Entra ID/);
        // Global Administrator of the fixture: 4 hours instead of 1, and an authentication context other than the label's
        expect(ga.tenant).toEqual({ kind: "differs", count: 2 });
    });

    it("a role the tenant does not have or has not read is not compared; one that matches looks right", () => {
        expect(compareRole(undefined, { requireApproval: true }, [], {})).toEqual({ kind: "notLoaded" });
        const ga = roles.find((r) => r.definition.id === "role-ga")!;
        expect(compareRole(ga, { maxActivationDuration: "PT4H", requireApproval: true, requireJustification: true }, [], {})).toEqual({ kind: "looksRight" });
        // A label without a context in the tenant stays Keep and is not counted
        expect(compareRole(ga, { maxActivationDuration: "PT4H", authContext: "unknown-label" }, [], {})).toEqual({ kind: "looksRight" });
    });

    it("filters combine; a chosen cell toggles plane and level", () => {
        const rows = catalogRoleRows(catalog, roles, contexts, {});
        const cell = toggleCell(EMPTY_ROLE_FILTER, "Control", "Privileged");
        expect(filterCatalogRoles(rows, cell).every((r) => r.plane === "Control" && r.level === "Privileged")).toBe(true);
        expect(filterCatalogRoles(rows, cell)).toHaveLength(countGrid(catalog).rows[0].cells[0].count);
        expect(toggleCell(cell, "Control", "Privileged")).toEqual(EMPTY_ROLE_FILTER);
        expect(filterCatalogRoles(rows, { ...EMPTY_ROLE_FILTER, query: "GLOBAL admin" }).map((r) => r.name)).toContain("Global Administrator");
        expect(filterCatalogRoles(rows, { ...EMPTY_ROLE_FILTER, reason: "fullControl" }).every((r) => r.reason === "fullControl")).toBe(true);
    });
});

describe("groups (spec 9.4)", () => {
    it("a group that holds a role is proposed at that role's place; without roles no proposal; the stored place wins", () => {
        const rows = groupPlacementRows(catalog, buildReportGroups(), roles, { "g-dev": { plane: "Data", securityLevel: "Enterprise" } });
        const tier0 = rows.find((r) => r.groupId === "g-tier0")!;
        expect(tier0.proposal).toMatchObject({ plane: "Control", securityLevel: "Privileged", fromRole: "Global Administrator" });
        expect(rows.find((r) => r.groupId === "g-finance")!.proposal).toBeNull();
        expect(rows.find((r) => r.groupId === "g-dev")!.placement).toEqual({ plane: "Data", securityLevel: "Enterprise" });
    });
});
