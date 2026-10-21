import { describe, expect, it } from "vitest";
import { DEFAULT_EXPORT_CHOICE, parseStoredChoice, planExport, type ExportChoice, type ExportData } from "@/utils/reportExportPlan";
import { readCsv, FILE_SCHEMAS } from "@/utils/exportSchema";
import { EXPORT_AUTH_CONTEXTS, EXPORT_EXTENSIONS, EXPORT_NOW, buildExportGroups, buildExportRoles } from "../fixtures/exportFixture";

const allRoles = buildExportRoles();
const allGroups = buildExportGroups();

const data = (over: Partial<ExportData> = {}): ExportData => ({
    allRoles,
    allGroups,
    filteredRoles: allRoles.slice(0, 1),
    filteredGroups: allGroups.slice(0, 1),
    canExportGroups: true,
    filterSentence: "",
    searchTerm: "",
    lists: { authenticationContexts: EXPORT_AUTH_CONTEXTS, customExtensions: EXPORT_EXTENSIONS },
    authenticationContexts: EXPORT_AUTH_CONTEXTS,
    emergencyIds: new Set(["u-bg1"]),
    meta: { tenantId: "t-1", tenantName: "Contoso", exporter: "Alex Wilber", appVersion: "3.2.0", readAt: { directoryRoles: "2026-10-02T11:00:00Z" }, exportedAt: EXPORT_NOW },
    ...over,
});

const choice = (over: Partial<ExportChoice> = {}): ExportChoice => ({ ...DEFAULT_EXPORT_CHOICE, ...over });

describe("parseStoredChoice", () => {
    it("falls back to the default for nothing, rubbish and wrong types", () => {
        expect(parseStoredChoice(null)).toEqual(DEFAULT_EXPORT_CHOICE);
        expect(parseStoredChoice("{not json")).toEqual(DEFAULT_EXPORT_CHOICE);
        expect(parseStoredChoice(JSON.stringify({ purpose: "zip", overview: { assignments: "yes" } }))).toEqual(DEFAULT_EXPORT_CHOICE);
    });
    it("keeps what is valid, field by field", () => {
        const stored = parseStoredChoice(JSON.stringify({ purpose: "bulk", bulk: { rolePolicies: false }, scope: { groups: false } }));
        expect(stored.purpose).toBe("bulk");
        expect(stored.bulk).toEqual({ ...DEFAULT_EXPORT_CHOICE.bulk, rolePolicies: false });
        expect(stored.scope).toEqual({ ...DEFAULT_EXPORT_CHOICE.scope, groups: false });
    });
});

describe("planExport overview", () => {
    it("offers the three files with the spec's names and row counts", () => {
        const plan = planExport(data(), choice());
        expect(plan.files.map((f) => f.name)).toEqual(["pim-overview-assignments-2026-10-02.csv", "pim-overview-role-settings-2026-10-02.csv", "pim-overview-group-settings-2026-10-02.csv"]);
        expect(plan.files[1].count).toBe(`${allRoles.length} rows`);
        expect(plan.files[2].count).toBe(`${allGroups.length * 2} rows`);
        for (const file of plan.files) expect(file.build().split("\r\n").filter(Boolean).length).toBeGreaterThan(1);
    });
    it("starts with comment rows that say tenant, data read, filter and exporter, and reads back", () => {
        const text = planExport(data({ filterSentence: "Privileged only" }), choice()).files[1].build();
        const lines = text.split("\r\n");
        expect(lines[0]).toBe("# Tenant: Contoso (t-1)");
        expect(lines[1]).toContain("# Data read: directory roles");
        expect(lines[2]).toBe("# Filter: Privileged only");
        expect(lines[3]).toContain("by Alex Wilber");
        expect(readCsv(FILE_SCHEMAS.overviewRoleSettings, text).rows).toHaveLength(1);
    });
    it("applies the filter to roles and groups alike, and only when asked", () => {
        const filtered = planExport(data({ filterSentence: "Privileged only" }), choice());
        expect(filtered.files[1].count).toBe("1 row");
        expect(filtered.files[2].count).toBe("2 rows");
        const unfiltered = planExport(data({ filterSentence: "Privileged only" }), choice({ scope: { ...DEFAULT_EXPORT_CHOICE.scope, applyFilter: false } }));
        expect(unfiltered.files[1].count).toBe(`${allRoles.length} rows`);
        const noFilterActive = planExport(data(), choice());
        expect(noFilterActive.files[1].count).toBe(`${allRoles.length} rows`);
    });
    it("leaves out a workload that is not in scope or not available", () => {
        const noGroups = planExport(data({ canExportGroups: false }), choice());
        expect(noGroups.files.map((f) => f.id)).toEqual(["overviewAssignments", "overviewRoleSettings"]);
        const noRoles = planExport(data(), choice({ scope: { ...DEFAULT_EXPORT_CHOICE.scope, roles: false } }));
        expect(noRoles.files.map((f) => f.id)).toEqual(["overviewAssignments", "overviewGroupSettings"]);
        expect(planExport(data(), choice({ scope: { roles: false, groups: false, applyFilter: false } })).files).toEqual([]);
    });
    it("leaves the exporter and the search words out of a file whose names are replaced", () => {
        const withNames = planExport(data({ filterSentence: "Privileged only", searchTerm: "anna" }), choice()).files[0].build();
        expect(withNames).toContain('"# Filter: Privileged only, Search ""anna"""');
        expect(withNames).toContain("by Alex Wilber");
        const replaced = planExport(data({ filterSentence: "Privileged only", searchTerm: "anna" }), choice({ overview: { ...DEFAULT_EXPORT_CHOICE.overview, anonymise: true } })).files[0].build();
        expect(replaced).toContain("# Filter: Privileged only\r\n");
        expect(replaced).not.toContain("Alex Wilber");
        expect(replaced).not.toContain("anna");
    });
    it("replaces extra notification recipients, which are addresses of people", () => {
        const text = planExport(data(), choice({ overview: { ...DEFAULT_EXPORT_CHOICE.overview, anonymise: true } })).files.map((f) => f.build()).join("\n");
        expect(text).not.toContain("audit@contoso.com");
        expect(text).not.toContain("n0@contoso.com");
        const named = planExport(data(), choice()).files.map((f) => f.build()).join("\n");
        expect(named).toContain("audit@contoso.com");
    });
    it("replaces the names of people everywhere, approvers included, and the object ids", () => {
        const text = planExport(data(), choice({ overview: { ...DEFAULT_EXPORT_CHOICE.overview, anonymise: true } })).files.map((f) => f.build()).join("\n");
        for (const secret of ["Anna de Vries", "anna@contoso.com", "Erik van Dam", "Lotte Visser", "u-anna", "u-erik", "sam.partner"]) expect(text).not.toContain(secret);
        expect(text).toContain("Person 1");
        // Groups, apps and roles keep their names
        expect(text).toContain("Security Leads");
        expect(text).toContain("Deploy pipeline");
        expect(text).toContain("Global Administrator");
    });
    it("keeps the names when not asked to replace them", () => {
        const text = planExport(data(), choice()).files.map((f) => f.build()).join("\n");
        expect(text).toContain("Anna de Vries");
        expect(text).toContain("Erik van Dam");
    });
});

describe("planExport bulk", () => {
    it("offers the four files and counts what is not included", () => {
        const plan = planExport(data(), choice({ purpose: "bulk" }));
        expect(plan.files.map((f) => f.name)).toEqual([
            "pim-bulk-role-policies-2026-10-02.csv", "pim-bulk-group-policies-2026-10-02.csv", "pim-bulk-role-assignments-2026-10-02.csv", "pim-bulk-group-assignments-2026-10-02.csv",
        ]);
        expect(plan.files.map((f) => f.count)).toEqual([`${allRoles.length} rows`, `${allGroups.length} rows`, "8 rows", "6 rows"]);
        expect(plan.notIncluded).toEqual({ activated: 3, viaGroup: 3 });
    });
    it("has no comment rows and never replaces names", () => {
        const plan = planExport(data(), choice({ purpose: "bulk", overview: { ...DEFAULT_EXPORT_CHOICE.overview, anonymise: true } }));
        for (const file of plan.files) expect(file.build().startsWith("#")).toBe(false);
        expect(plan.files[2].build()).toContain("anna@contoso.com");
    });
    it("counts nothing for a file that is not chosen", () => {
        const plan = planExport(data(), choice({ purpose: "bulk", bulk: { rolePolicies: true, groupPolicies: false, roleAssignments: false, groupAssignments: false } }));
        expect(plan.files).toHaveLength(1);
        expect(plan.notIncluded).toEqual({ activated: 0, viaGroup: 0 });
    });
});

describe("planExport backup", () => {
    it("is one complete file and ignores the filter", () => {
        const plan = planExport(data({ filterSentence: "Privileged only" }), choice({ purpose: "backup" }));
        expect(plan.files).toHaveLength(1);
        expect(plan.files[0].name).toBe("pim-backup-2026-10-02.json");
        expect(plan.files[0].count).toBe(`${allRoles.length} roles, ${allGroups.length} groups`);
        const backup = JSON.parse(plan.files[0].build());
        expect(backup.schemaVersion).toBe(1);
        expect(backup.directoryRoles).toHaveLength(allRoles.length);
        expect(backup.pimGroups).toHaveLength(allGroups.length);
        expect(backup.workloads).toEqual(["directoryRoles", "pimGroups"]);
    });
    it("leaves out PIM for Groups when it is not available", () => {
        const plan = planExport(data({ canExportGroups: false }), choice({ purpose: "backup" }));
        expect(JSON.parse(plan.files[0].build()).pimGroups).toBeUndefined();
        expect(plan.files[0].count).toBe(`${allRoles.length} roles`);
    });
});
