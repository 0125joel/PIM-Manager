import { describe, expect, it } from "vitest";
import { buildIdleEvents, buildIdleGroups, buildIdleMembership, buildIdleRoles, IDLE_EMERGENCY_IDS, IDLE_NOW } from "@/app/dev/audit/idleData";
import { buildNoActivationRows, countNoActivation, GROUPS_NOT_GRANTED_REASON, noActivationHonesty } from "@/utils/auditNoActivation";
import {
    countEnvironments,
    describeInclude,
    describeNoActivationFilter,
    includeHint,
    keepIncluded,
    planAuditExport,
    planNoActivationExport,
    withInclude,
    type NoActivationExportInput,
} from "@/utils/auditExportPlan";

const ALL = { roles: true, groups: true };
const ROLES_ONLY = { roles: true, groups: false };

const rows = buildNoActivationRows({ roles: buildIdleRoles(), groups: buildIdleGroups(), events: buildIdleEvents(), days: 30, now: IDLE_NOW, emergencyIds: IDLE_EMERGENCY_IDS, format: { timeZone: "UTC", locale: "en-GB" }, membership: buildIdleMembership() });

function inputOf(kept: typeof rows, include = ALL): NoActivationExportInput {
    const counts = countEnvironments(rows);
    return {
        rows: kept,
        honesty: noActivationHonesty(countNoActivation(kept)),
        period: { from: new Date("2026-10-06T12:00:00Z"), to: new Date("2026-11-05T11:58:00Z") },
        filterSentence: withInclude(describeNoActivationFilter({ env: "both" }), counts, include),
        searchTerm: "",
        readAt: "2026-11-05T11:58:00Z",
        oldestAvailable: new Date("2026-10-06T11:58:00Z"),
        source: "graph",
        tenant: { id: "3f2a91c4-7d1e-4b6a-9e0f-5c8d2a1b7e63", name: "Contoso" },
        exportedAt: new Date("2026-11-05T12:05:00Z"),
    };
}

describe("the workloads of the export", () => {
    const events = buildIdleEvents();
    const mixed = [
        ...events.filter((event) => event.environment === "role").slice(0, 2),
        ...events.filter((event) => event.environment === "group").slice(0, 1),
    ];

    it("counts, keeps and names the workloads of events", () => {
        const counts = countEnvironments(mixed);
        expect(counts).toEqual({ roles: 2, groups: 1 });
        expect(keepIncluded(mixed, ROLES_ONLY)).toHaveLength(2);
        expect(describeInclude(counts, ROLES_ONLY)).toBe("Entra roles only");
        expect(describeInclude(counts, { roles: false, groups: true })).toBe("PIM for Groups only");
        expect(describeInclude({ roles: 2, groups: 0 }, ROLES_ONLY)).toBe("");
        expect(describeInclude(counts, ALL)).toBe("");
    });

    it("joins the words to the filter sentence", () => {
        expect(withInclude("Failed or denied", { roles: 2, groups: 1 }, ROLES_ONLY)).toBe("Failed or denied, Entra roles only");
        expect(withInclude("", { roles: 2, groups: 1 }, ROLES_ONLY)).toBe("Entra roles only");
        expect(withInclude("Failed or denied", { roles: 2, groups: 1 }, ALL)).toBe("Failed or denied");
    });

    it("leaves the events file as it is when both are chosen", () => {
        const base = { period: { from: new Date("2026-10-06T12:00:00Z"), to: new Date("2026-11-05T11:58:00Z") }, filterSentence: "", searchTerm: "", emergencyIds: new Set<string>(), readAt: "2026-11-05T11:58:00Z", oldestAvailable: new Date("2026-10-06T11:58:00Z"), source: "graph" as const, tenant: { id: "t" }, exportedAt: new Date("2026-11-05T12:05:00Z") };
        const plain = planAuditExport({ ...base, events: mixed }, { format: "csv", replaceNames: false });
        const chosen = planAuditExport({ ...base, events: keepIncluded(mixed, ALL), filterSentence: withInclude("", countEnvironments(mixed), ALL) }, { format: "csv", replaceNames: false });
        if (plain.format !== "csv" || chosen.format !== "csv") throw new Error("csv expected");
        expect(chosen.content).toBe(plain.content);
    });
});

describe("a No activation export without PIM for Groups", () => {
    const kept = keepIncluded(rows, ROLES_ONLY);
    const input = inputOf(kept, ROLES_ONLY);

    it("holds no group row and says so in the filter line of every format", () => {
        expect(kept.length).toBeLessThan(rows.length);
        expect(kept.some((row) => /^(Member|Owner) of /.test(row.resourceName))).toBe(false);
        for (const format of ["csv", "json", "pdf"] as const) {
            const file = planNoActivationExport(input, { format, replaceNames: false });
            if (file.format === "pdf") {
                expect(file.pdf.meta.find((item) => item.label === "Filters")?.value).toContain("Entra roles only");
                const drawn = file.pdf.sections.flatMap((section) => section.rows);
                expect(drawn).toHaveLength(kept.length);
                expect(file.pdf.totals.reduce((sum, total) => sum + total.value, 0)).toBe(kept.length);
                expect(JSON.stringify(drawn)).not.toMatch(/(Member|Owner) of /);
            } else {
                expect(file.content).toContain("Entra roles only");
                expect(file.content).not.toMatch(/(Member|Owner) of /);
            }
        }
    });

    it("counts only those rows in the honesty text", () => {
        expect(input.honesty).toContain(`${kept.length} assignments`);
        expect(input.honesty).not.toContain(`${rows.length} assignments`);
    });

    it("is the same file as the plain plan when both are chosen", () => {
        const plain: NoActivationExportInput = { ...inputOf(rows), filterSentence: describeNoActivationFilter({ env: "both" }) };
        const chosen = inputOf(keepIncluded(rows, ALL), ALL);
        const a = planNoActivationExport(plain, { format: "csv", replaceNames: false });
        const b = planNoActivationExport(chosen, { format: "csv", replaceNames: false });
        if (a.format !== "csv" || b.format !== "csv") throw new Error("csv expected");
        expect(b.content).toBe(a.content);
    });
});

describe("the hint under a workload", () => {
    it("counts when there are rows", () => {
        expect(includeHint({ workload: "roles", count: 28, unit: "assignment" })).toBe("28 assignments");
        expect(includeHint({ workload: "groups", count: 1, unit: "assignment" })).toBe("1 assignment");
        expect(includeHint({ workload: "roles", count: 28, unit: "action" })).toBe("28 actions");
        expect(includeHint({ workload: "groups", count: 1, unit: "action" })).toBe("1 action");
    });

    it("tells why a workload has no rows, in this order", () => {
        expect(includeHint({ workload: "groups", count: 0, unit: "assignment", groupsReason: GROUPS_NOT_GRANTED_REASON, env: "role" })).toBe("Not granted yet");
        expect(includeHint({ workload: "groups", count: 0, unit: "assignment", groupsReason: "Microsoft Graph did not return the groups" })).toBe("Could not be read");
        expect(includeHint({ workload: "groups", count: 0, unit: "assignment", groupsReason: null, env: "role" })).toBe("Left out by the current filter");
        expect(includeHint({ workload: "roles", count: 0, unit: "action", env: "group" })).toBe("Left out by the current filter");
        expect(includeHint({ workload: "groups", count: 0, unit: "action", env: "both" })).toBe("None in this view");
    });
});
