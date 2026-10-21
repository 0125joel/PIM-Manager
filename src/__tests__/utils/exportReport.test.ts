import { describe, expect, it } from "vitest";
import { buildExportReport, buildExportRows, defaultBlocks, type ExportInput, type ExportOptions } from "@/utils/exportReport";
import { escapeCsvCell, FILE_SCHEMAS, readCsv, writeCsv, type ExportRow } from "@/utils/exportSchema";
import { anonymisePeople } from "@/utils/exportAnonymise";
import { EMERGENCY_ACCOUNT_IDS, buildFixtureGroups, buildFixtureRoles } from "../fixtures/dashboardBasicFixture";
import { role } from "../fixtures/dashboardFilterFixtures";

const input: ExportInput = {
    rolesData: buildFixtureRoles(),
    groupsData: buildFixtureGroups(),
    filter: {},
    emergencyAccountIds: new Set(EMERGENCY_ACCOUNT_IDS),
    alerts: null,
    tenantExtensionIds: null,
    policiesLoading: false,
    meta: { tenantName: "Contoso", exporter: "Alex Wilber", version: "3.2.0", exportedAt: new Date("2026-10-02T14:05:00Z"), dataReadAt: new Date("2026-10-02T14:03:00Z") },
};

const options = (over: Partial<ExportOptions> = {}): ExportOptions => ({
    detail: "full",
    audience: "admin",
    chartStyle: "bars",
    anonymise: false,
    applyFilter: true,
    counting: { directoryRoles: true, pimGroups: true, unmanagedGroups: true, agents: true, securityAlerts: false },
    blocks: defaultBlocks("full"),
    ...over,
});

describe("buildExportReport", () => {
    it("repeats the numbers of the dashboard", () => {
        const report = buildExportReport(input, options());
        const value = (label: string) => report.numbers?.find((n) => n.label === label)?.value;
        expect(value("Roles and groups")).toBe("154");
        expect(value("Eligible")).toBe("138");
        expect(report.header.tenant).toBe("Contoso");
    });

    describe("anonymisePeople", () => {
        it("keeps Agent ID names while replacing a person's name", () => {
            const source = role({
                id: "agents",
                permanent: [
                    { principalId: "identity", principal: { id: "identity", displayName: "Contoso Agent", "@odata.type": "#microsoft.graph.agentIdentity", servicePrincipalType: "ServiceIdentity" } },
                    { principalId: "agent-user", principal: { id: "agent-user", displayName: "Agent account", "@odata.type": "#microsoft.graph.agentUser" } },
                    { principalId: "person", principal: { id: "person", displayName: "A person", "@odata.type": "#microsoft.graph.user" } },
                ],
            });
            const result = anonymisePeople([source], []);
            const rows = result.roles[0].assignments.permanent;
            expect(rows[0].principal?.displayName).toBe("Contoso Agent");
            expect(rows[1].principal?.displayName).toBe("Agent account");
            expect(rows[2].principal?.displayName).toBe("Person 1");
        });
    });

    it("lists what needs attention with counts above zero only", () => {
        const report = buildExportReport(input, options());
        expect(report.attention?.every((a) => a.count > 0)).toBe(true);
        expect(report.attention?.map((a) => a.label)).toContain("Role-assignable groups outside PIM");
    });

    it("a summary has no findings tables and no appendix", () => {
        const report = buildExportReport(input, options({ detail: "summary", blocks: defaultBlocks("summary") }));
        expect(report.tables).toHaveLength(0);
        expect(report.appendix).toBeNull();
        expect(report.glossary).toBeNull();
    });

    it("the appendix lists every assignment, and not for the management audience", () => {
        const withAppendix = buildExportReport(input, options({ detail: "appendix" }));
        expect(withAppendix.appendix?.length).toBeGreaterThan(100);
        const management = buildExportReport(input, options({ detail: "appendix", audience: "management" }));
        expect(management.appendix).toBeNull();
    });

    it("replaces names of people, never of groups", () => {
        const names = new Set(buildFixtureRoles().flatMap((r) => r.assignments.eligible.map((e) => e.principal?.displayName)).filter(Boolean));
        const report = buildExportReport(input, options({ detail: "appendix", anonymise: true }));
        const printed = JSON.stringify({ ...report, header: undefined });
        for (const name of names) expect(printed).not.toContain(`"${name}"`);
        expect(report.header.isAnonymised).toBe(true);
        expect(printed).toContain("Person 1");
    });

    it("the management audience is always anonymised", () => {
        const report = buildExportReport(input, options({ audience: "management", anonymise: false }));
        expect(report.header.isAnonymised).toBe(true);
    });

    it("a filter narrows the document and is named in the header", () => {
        const filtered = buildExportReport({ ...input, filter: { assignment: "permanent" } }, options());
        expect(filtered.header.filter).not.toBeNull();
        const value = (label: string) => filtered.numbers?.find((n) => n.label === label)?.value;
        expect(Number(value("Eligible"))).toBeLessThan(138);
        const ignored = buildExportReport({ ...input, filter: { assignment: "permanent" } }, options({ applyFilter: false }));
        expect(ignored.header.filter).toBeNull();
    });

    it("says why alerts are missing", () => {
        const report = buildExportReport(input, options({ counting: { directoryRoles: true, pimGroups: true, unmanagedGroups: true, agents: true, securityAlerts: true } }));
        expect(report.alerts).toBeNull();
        expect(report.notes.join(" ")).toContain("Security alerts could not be read");
    });
});

describe("settings not readable with the current access (FIX-11, FIX-12)", () => {
    const notes = (report: ReturnType<typeof buildExportReport>) => report.notes.join(" ");
    const marked = {
        ...input,
        rolesData: buildFixtureRoles().map((r, i) => (i < 2 ? { ...r, policy: null, policiesForbidden: true } : r)),
        groupsData: buildFixtureGroups().map((g, i) => (i === 0 ? { ...g, policies: undefined, settings: undefined, policiesForbidden: true } : g)),
    };

    it("names the roles and groups without a filter", () => {
        expect(notes(buildExportReport(marked, options()))).toContain("2 roles and 1 group have settings that are not readable");
    });

    it("still names the roles when a policy filter took them out of the view (the filter is roles only, so no group)", () => {
        expect(notes(buildExportReport({ ...marked, filter: { approval: "required" } }, options()))).toContain("2 roles have settings that are not readable");
    });
});

describe("csv", () => {
    it("has a row per assignment with the object id, or without it when anonymised", () => {
        const rows = buildExportRows(input, options());
        expect(rows.length).toBeGreaterThan(100);
        expect(rows.some((r) => r.objectId !== "")).toBe(true);
        const anon = buildExportRows(input, options({ anonymise: true }));
        expect(anon.filter((r) => r.kind === "user").every((r) => r.objectId === "" && r.upn === "")).toBe(true);
    });

    it("quotes cells and defuses formulas", () => {
        expect(escapeCsvCell('a,"b"')).toBe('"a,""b"""');
        expect(escapeCsvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    });

    it("writes the dashboard CSV with the Report Overview columns: the first twelve unchanged, four added", () => {
        const csv = writeCsv(FILE_SCHEMAS.overviewAssignments, buildExportRows(input, options()) as unknown as ExportRow[]);
        expect(csv.split("\r\n")[0]).toBe("Workload,Role or group,Access,Assignment,Name,UPN or mail,Object id,Principal type,Member type,Start,End,Scope,Role or group id,Privileged,Emergency access,Origin");
    });

    it("marks the emergency access accounts in the dashboard CSV", () => {
        const rows = buildExportRows(input, options());
        const emergency = rows.filter((r) => r.emergency);
        expect(emergency.length).toBeGreaterThan(0);
        expect(emergency.every((r) => input.emergencyAccountIds.has(r.objectId.toLowerCase()))).toBe(true);
        const read = readCsv(FILE_SCHEMAS.overviewAssignments, writeCsv(FILE_SCHEMAS.overviewAssignments, rows as unknown as ExportRow[]));
        expect(read.rows.filter((r) => r.emergency === true)).toHaveLength(emergency.length);
    });
});

describe("buildStatsView scope", () => {
    it("narrows every role number to the privileged roles only when asked", async () => {
        const { buildStatsView } = await import("@/utils/dashboardView");
        const base = { rolesData: input.rolesData, groupsData: input.groupsData, counting: { directoryRoles: true, pimGroups: true, unmanagedGroups: true, agents: true }, effective: {}, policiesLoading: false, emergencyAccountIds: input.emergencyAccountIds, scope: "privileged" as const };
        expect(buildStatsView(base).roles).toHaveLength(130);
        const narrowed = buildStatsView({ ...base, narrowToScope: true });
        expect(narrowed.roles).toHaveLength(33);
        expect(narrowed.groups.length).toBe(buildStatsView(base).groups.length);
        expect(buildStatsView({ ...base, scope: "all", narrowToScope: true }).roles).toHaveLength(130);
    });

    it("the filter sentence counts against the roles in scope, not every role", async () => {
        const { buildStatsView, buildViewFilterSentence } = await import("@/utils/dashboardView");
        const effective = { customRole: true };
        const base = { rolesData: input.rolesData, groupsData: input.groupsData, counting: { directoryRoles: true, pimGroups: true, unmanagedGroups: true, agents: true }, effective, policiesLoading: false, emergencyAccountIds: input.emergencyAccountIds, scope: "privileged" as const };
        const basic = buildStatsView(base);
        expect(buildViewFilterSentence(basic, input.rolesData, effective, true, false)).toBe(`${basic.roles.length} of 130 roles. Blocks about groups and alerts are not affected.`);
        const advanced = buildStatsView({ ...base, narrowToScope: true });
        expect(buildViewFilterSentence(advanced, input.rolesData, effective, true, true)).toBe(`${advanced.roles.length} of 33 privileged roles. The sections below are not affected.`);
        expect(buildViewFilterSentence(buildStatsView({ ...base, effective: {} }), input.rolesData, {}, true, false)).toBe("");
    });
});
