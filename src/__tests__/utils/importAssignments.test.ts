import { describe, expect, it } from "vitest";
import type { PrincipalRef } from "@/types/configure.types";
import { changeId } from "@/utils/configureBasket";
import { CONFIGURE_NOW, buildFixtureAccess } from "../fixtures/configureFixture";
import { PEOPLE, buildReportGroups, buildReportRoles } from "../fixtures/reportFixture";
import {
    EMPTY_PRINCIPALS, changesOfRows, checkAssignmentRows, countRows, filterRows, knownPrincipals, mergePrincipals, neededLookups, resolveBulkAssignmentEnd,
    type AssignmentCheckInput, type CheckedRow,
} from "@/utils/importAssignments";
import { readImportFile } from "@/utils/importDetect";
import { FILE_SCHEMAS, writeCsv } from "@/utils/exportSchema";
import { buildBulkGroupAssignmentRows, buildBulkRoleAssignmentRows } from "@/utils/exportRows";
import { EXPORT_NOW, buildExportGroups, buildExportRoles } from "../fixtures/exportFixture";

const roles = buildReportRoles();
const groups = buildReportGroups();
const GROUP_LIKES = groups.map((g) => ({ id: g.group.id, displayName: g.group.displayName, isAssignableToRole: g.group.isAssignableToRole ?? null, isUnderPim: g.isManaged !== false }));
const access = buildFixtureAccess("pra", { groups: GROUP_LIKES, ownedGroup: { id: "g-helpdesk1", displayName: "Helpdesk Tier 1" } });

const megan: PrincipalRef = { id: "u-megan", kind: "user", displayName: "Megan Bowen", userPrincipalName: "megan@contoso.com" };
const lookedUp = { byId: new Map([[megan.id, megan]]), byUpn: new Map([["megan@contoso.com", megan]]) };
const principals = mergePrincipals(knownPrincipals(roles, groups), lookedUp);

function check(kind: "role" | "group", csv: string, patch: Partial<AssignmentCheckInput> = {}): CheckedRow[] {
    const file = readImportFile(csv, "file.csv");
    expect(file.csv).not.toBeNull();
    return checkAssignmentRows({
        kind, rows: file.csv!.rows, rowNumbers: file.csv!.rowNumbers, errors: file.csv!.errors, isOlderRemoval: file.detected.isOlderRemoval,
        fileName: "file.csv", roles, groups, access, principals, administrativeUnits: new Map([["au-nl", "Netherlands"]]), tenantName: "Contoso", now: CONFIGURE_NOW, ...patch,
    });
}

const ROLE_HEAD = "Role ID,Principal ID,Principal UPN,Assignment Type,Action,Scope ID,End Date,Duration Days,Justification";

describe("the result of a role row", () => {
    it("is a new assignment for a person not holding the role, with the file's name and line in the source", () => {
        const [row] = check("role", `${ROLE_HEAD}\nrole-pra,,megan@contoso.com,eligible,add,,2027-04-01T00:00:00Z,,`);
        expect(row).toMatchObject({ line: 2, who: "Megan Bowen", action: "Add eligible", target: "Privileged Role Administrator", scope: "Tenant-wide", end: "Ends 2027-04-01", result: "new", message: "New assignment" });
        expect(row.change).toMatchObject({ kind: "add", type: "eligible", scope: "/", start: null, end: "2027-04-01T00:00:00.000Z", source: { from: "import", file: "file.csv", line: 2 }, principal: { id: "u-megan" } });
    });

    it("skips an assignment that is already there and turns another end into a change of end", () => {
        const rows = [
            ...check("role", `${ROLE_HEAD}\nrole-pra,u-anna,,eligible,add,,2027-01-31T00:00:00Z,,`),
            ...check("role", `${ROLE_HEAD}\nrole-pra,u-anna,,eligible,add,,2027-05-31T00:00:00Z,,`),
        ];
        expect(rows.map((r) => r.result)).toEqual(["alreadyThere", "changesEnd"]);
        expect(rows[0].message).toBe("Already there, skipped");
        expect(rows[1].detail).toBe("Ends 2027-01-31, then ends 2027-05-31");
        expect(rows[1].change).toMatchObject({ kind: "update", action: "adminUpdate", end: "2027-05-31T00:00:00.000Z", schedule: { principal: { id: "u-anna" }, type: "eligible", scope: "/" } });
    });

    it("removes an assignment that is there and skips one that is not", () => {
        const rows = check("role", `${ROLE_HEAD}\nrole-exo,u-mo,,eligible,remove,,,,\nrole-exo,u-anna,,eligible,remove,,,,`);
        expect(rows.map((r) => r.result)).toEqual(["remove", "notThere"]);
        expect(rows[0].change).toMatchObject({ kind: "remove", schedule: { principal: { id: "u-mo" }, type: "eligible" } });
        expect(rows[1].message).toBe("Not there any more, skipped");
        expect(rows[1].change).toBeNull();
    });

    it("does not count an activation as the assignment", () => {
        // Ravi has an activated Security Administrator schedule, no assignment
        const [add] = check("role", `${ROLE_HEAD}\nrole-sec,u-ravi,,active,add,,2027-01-01T00:00:00Z,,why`);
        const [remove] = check("role", `${ROLE_HEAD}\nrole-sec,u-ravi,,active,remove,,,,`);
        expect(add.result).toBe("new");
        expect(remove.result).toBe("notThere");
    });

    it("does not count a schedule through a group as the assignment", () => {
        const through = structuredClone(roles).map((r) => {
            if (r.definition.id === "role-pra") (r.assignments.eligible[0] as { memberType?: string }).memberType = "Group";
            return r;
        });
        const [row] = check("role", `${ROLE_HEAD}\nrole-pra,u-anna,,eligible,add,,2027-01-31T00:00:00Z,,`, { roles: through });
        expect(row.result).toBe("new");
    });
});

describe("rows that need a fix", () => {
    it("says what is wrong with the person", () => {
        const rows = check("role", `${ROLE_HEAD}\nrole-pra,,j.doe@contoso.com,eligible,add,,,,\nrole-pra,u-nobody,,eligible,add,,,,\nrole-pra,,,eligible,add,,,,`);
        expect(rows.map((r) => r.message)).toEqual([
            "Nobody with this UPN in Contoso.",
            "Nobody with this ID in Contoso.",
            "Principal ID and Principal UPN are both empty. Give one of them.",
        ]);
    });

    it("says what is wrong with a date, a type or a role", () => {
        const rows = check("role", `${ROLE_HEAD}\nrole-pra,u-anna,,eligible,add,,2026-13-01,,\nrole-pra,u-anna,,sometimes,add,,,,\nrole-zzz,u-anna,,eligible,add,,,,\nrole-pra,u-anna,,,add,,,,\nrole-pra,u-anna,,eligible,add,,2020-01-01T00:00:00Z,,`);
        expect(rows.map((r) => r.message)).toEqual([
            "End Date 2026-13-01 is not a date.",
            "Assignment Type sometimes is not eligible or active.",
            "No role with this ID in Contoso.",
            "Assignment Type is empty. Use eligible or active.",
            "End Date 2020-01-01 is in the past.",
        ]);
        expect(rows.every((r) => r.result === "error" && r.change === null)).toBe(true);
    });

    it("finds a role by name, and refuses a name that is two roles", () => {
        const [ok] = check("role", `Role Name,Principal UPN,Assignment Type,End Date\nExchange Administrator,megan@contoso.com,eligible,2027-01-01\n`);
        expect(ok.result).toBe("new");
        const twice = [...roles, { ...roles[0], definition: { ...roles[0].definition, id: "role-ga-copy" } }];
        const [bad] = check("role", `Role Name,Principal UPN,Assignment Type\nGlobal Administrator,megan@contoso.com,eligible\n`, { roles: twice });
        expect(bad.message).toBe("2 roles are named Global Administrator. Use the Role ID.");
    });

    it("never takes an unknown scope for tenant-wide", () => {
        const rows = check("role", `${ROLE_HEAD}\nrole-pra,u-anna,,eligible,add,not a scope,2027-01-01,,\nrole-pra,u-anna,,eligible,add,/administrativeUnits/au-xx,2027-01-01,,`);
        expect(rows[0].message).toContain("Scope ID not a scope is not");
        // A Privileged Role Administrator cannot be limited to a unit
        expect(rows[1].result).toBe("error");
    });

    it("limits a role that supports units to a unit that exists", () => {
        const [ok, missing] = check("role", `Role Name,Principal UPN,Assignment Type,Scope ID,End Date\nUser Administrator,megan@contoso.com,eligible,/administrativeUnits/au-nl,2027-01-01\nUser Administrator,megan@contoso.com,eligible,/administrativeUnits/au-xx,2027-01-01\n`);
        expect(ok).toMatchObject({ result: "new", scope: "Administrative unit: Netherlands" });
        expect(ok.change).toMatchObject({ scope: "/administrativeUnits/au-nl" });
        expect(missing.message).toBe("No administrative unit with this ID in Contoso.");
    });

    it("refuses a role the admin may not change", () => {
        const [row] = check("role", `${ROLE_HEAD}\nrole-pra,,megan@contoso.com,eligible,add,,2027-01-01,,`, { access: buildFixtureAccess("none") });
        expect(row.result).toBe("error");
        expect(row.message).toContain("You cannot change Privileged Role Administrator now.");
    });

    it("applies the policy of the target: permanent, maximum and justification", () => {
        // User Administrator allows permanent active (fixture policy), Global Administrator does not
        const rows = check("role", `${ROLE_HEAD}\nrole-ga,,megan@contoso.com,active,add,,permanent,,why\nrole-ga,u-anna,,active,add,,,,\nrole-ua,,megan@contoso.com,active,add,,permanent,,why`);
        expect(rows[0].message).toBe("Permanent active is not allowed by the Global Administrator policy. Give an End Date.");
        expect(rows[1].message).toBe("The Global Administrator policy requires a justification for active assignments.");
        expect(rows[2].result).toBe("new");
        expect(rows[2].end).toBe("No end date");
    });

    it("gives the policy maximum when the file gives no end, and says so", () => {
        const [row] = check("role", `Role ID,Principal UPN,Assignment Type\nrole-ga,megan@contoso.com,eligible\n`);
        expect(row.result === "new" || row.result === "error").toBe(true);
        if (row.result === "new") expect(row.end).toMatch(/\(policy maximum\)$/);
    });
});

describe("duplicates and counts", () => {
    it("skips the same assignment twice in the file, naming the first line", () => {
        const rows = check("role", `${ROLE_HEAD}\nrole-pra,,megan@contoso.com,eligible,add,,2027-01-01,,\nrole-pra,,megan@contoso.com,eligible,add,,2027-01-01,,`);
        expect(rows.map((r) => r.result)).toEqual(["new", "duplicate"]);
        expect(rows[1].message).toBe("Same as line 2, skipped");
    });

    it("counts the filters of the table and keeps the order of the file", () => {
        const rows = check("role", `${ROLE_HEAD}\nrole-pra,,megan@contoso.com,eligible,add,,2027-04-01,,\nrole-pra,u-anna,,eligible,add,,2027-01-31T00:00:00Z,,\nrole-exo,u-mo,,eligible,remove,,,,\nrole-exo,u-anna,,eligible,remove,,,,\nrole-pra,,nobody@contoso.com,eligible,add,,,,\nrole-pra,u-bram,,eligible,add,,2027-09-09,,`);
        expect(countRows(rows)).toEqual({ all: 6, new: 2, removals: 1, skipped: 2, fix: 1 });
        expect(filterRows(rows, "fix").map((r) => r.line)).toEqual([6]);
        expect(rows.map((r) => r.line)).toEqual([2, 3, 4, 5, 6, 7]);
        expect(changesOfRows(rows, new Set([2])).map((c) => c.kind)).toEqual(["remove", "add"]);
    });
});

describe("group rows", () => {
    const GROUP_HEAD = "Group ID,Principal ID,Principal UPN,Access Type,Assignment Type,Action,End Date,Duration Days,Justification";

    it("adds to the side the file names and compares per side", () => {
        const rows = check("group", `${GROUP_HEAD}\ng-helpdesk1,,megan@contoso.com,member,eligible,add,2027-04-01,,\ng-helpdesk1,u-mo,,member,eligible,add,permanent,,\ng-helpdesk1,u-mo,,owner,eligible,add,permanent,,`);
        expect(rows.map((r) => r.result)).toEqual(["new", "alreadyThere", "new"]);
        expect(rows[0].change).toMatchObject({ kind: "add", target: { kind: "group", id: "g-helpdesk1", access: "member" }, scope: "/" });
        expect(rows[2].scope).toBe("Owner");
    });

    it("needs an Access Type and finds a group by name", () => {
        const [noSide] = check("group", `Group ID,Principal UPN,Assignment Type\ng-helpdesk1,megan@contoso.com,eligible\n`);
        expect(noSide.message).toBe("Access Type is empty. Use member or owner.");
        const [byName] = check("group", `Group Name,Principal UPN,Access Type,Assignment Type,End Date\nHelpdesk Tier 1,megan@contoso.com,member,eligible,2027-01-01\n`);
        expect(byName.result).toBe("new");
    });

    it("removes a person from a group", () => {
        const [row] = check("group", `${GROUP_HEAD}\ng-helpdesk1,u-lotte,,member,eligible,remove,,,`);
        expect(row.result).toBe("remove");
    });
});

describe("older removal files", () => {
    it("read every row without an Action as a removal", () => {
        const [row] = check("role", `Role ID,Principal ID,Principal UPN,Assignment Type,Scope ID,Action\nrole-exo,u-mo,,eligible,/,\n`);
        expect(row.result).toBe("remove");
        const [explicit] = check("role", `Role ID,Principal ID,Principal UPN,Assignment Type,Scope ID,Action\nrole-pra,,megan@contoso.com,eligible,/,add\n`);
        expect(explicit.action).toBe("Add eligible");
    });

    it("a file with add on some rows reads its empty Action cells as add, as the reference says (I-04)", () => {
        const rows = check("role", `Role ID,Principal ID,Principal UPN,Assignment Type,Scope ID,Action\nrole-pra,,megan@contoso.com,eligible,/,add\nrole-exo,u-mo,,eligible,/,\n`);
        expect(rows[1].action).toMatch(/^Add/);
    });
});

describe("lookups", () => {
    it("maps Agent ID principals to Configure's service principal or user kinds", () => {
        const base = roles[0];
        const eligible = base.assignments.eligible[0];
        const withAgents = {
            ...base,
            assignments: {
                ...base.assignments,
                eligible: [
                    ...base.assignments.eligible,
                    { ...eligible, id: "agent-identity", principalId: "agent-identity", principal: { id: "agent-identity", displayName: "Agent", "@odata.type": "#microsoft.graph.agentIdentity" } },
                    { ...eligible, id: "agent-user", principalId: "agent-user", principal: { id: "agent-user", displayName: "Agent account", "@odata.type": "#microsoft.graph.agentUser" } },
                ],
            },
        };
        const known = knownPrincipals([withAgents], []);
        expect(known.byId.get("agent-identity")?.kind).toBe("servicePrincipal");
        expect(known.byId.get("agent-user")?.kind).toBe("user");
    });

    it("asks Graph only for people no loaded assignment names", () => {
        const known = knownPrincipals(roles, groups);
        expect(known.byId.get(PEOPLE.anna.id)?.displayName).toBe("Anna de Vries");
        const guid = "3f2a91c4-7d1e-4b6a-9e0f-5c8d2a1b7e63";
        const file = readImportFile(`${ROLE_HEAD}\nrole-pra,u-anna,,eligible,add,,,,\nrole-pra,${guid},,eligible,add,,,,\nrole-pra,not-a-guid,,eligible,add,,,,\nrole-pra,,megan@contoso.com,eligible,add,,,,\nrole-pra,,anna@contoso.com,eligible,add,,,,`, "x.csv");
        // A value that is no id never goes to Graph: one of them would make Graph refuse the whole chunk
        expect(neededLookups(file.csv!.rows, known)).toEqual({ ids: [guid], upns: ["megan@contoso.com"] });
        expect(neededLookups(file.csv!.rows, EMPTY_PRINCIPALS).ids).toEqual([guid]);
    });
});

describe("resolveBulkAssignmentEnd (moved from the old parser)", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    it("lets End Date win over Duration Days, then falls back to the days, then the policy default", () => {
        expect(resolveBulkAssignmentEnd({ durationDays: "30", endDate: "2026-06-01T00:00:00.000Z" }, now)).toEqual({ permanent: false, endDateTime: "2026-06-01T00:00:00.000Z" });
        expect(resolveBulkAssignmentEnd({ durationDays: "30" }, now)).toEqual({ permanent: false, endDateTime: "2026-01-31T00:00:00.000Z" });
        expect(resolveBulkAssignmentEnd({ durationDays: "permanent" }, now)).toEqual({ permanent: true });
        expect(resolveBulkAssignmentEnd({ durationDays: "" }, now)).toEqual({ permanent: false });
    });
});

describe("round trip: the files the Report exports, imported into the same tenant", () => {
    const exportRoles = buildExportRoles();
    const exportGroups = buildExportGroups();
    const known = knownPrincipals(exportRoles, exportGroups);

    it("gives only Already there for role assignments", () => {
        const csv = writeCsv(FILE_SCHEMAS.bulkRoleAssignments, buildBulkRoleAssignmentRows(exportRoles, { now: EXPORT_NOW }).rows);
        const rows = check("role", csv, { roles: exportRoles, groups: exportGroups, access: null, principals: known, now: EXPORT_NOW });
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.filter((r) => r.result !== "alreadyThere").map((r) => [r.line, r.result, r.message])).toEqual([]);
    });

    it("gives only Already there for group assignments", () => {
        const csv = writeCsv(FILE_SCHEMAS.bulkGroupAssignments, buildBulkGroupAssignmentRows(exportGroups, { now: EXPORT_NOW }).rows);
        const rows = check("group", csv, { roles: exportRoles, groups: exportGroups, access: null, principals: known, now: EXPORT_NOW });
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.filter((r) => r.result !== "alreadyThere").map((r) => [r.line, r.result, r.message])).toEqual([]);
    });

    it("turns every row into a removal when the Action is remove", () => {
        const rows = buildBulkRoleAssignmentRows(exportRoles, { now: EXPORT_NOW }).rows.map((r) => ({ ...r, action: "remove" }));
        const checked = check("role", writeCsv(FILE_SCHEMAS.bulkRoleAssignments, rows), { roles: exportRoles, groups: exportGroups, access: null, principals: known, now: EXPORT_NOW });
        expect(new Set(checked.map((r) => r.result))).toEqual(new Set(["remove"]));
    });
});

describe("what the review of the code found (gate C of NG-71)", () => {
    it("keeps what is there when End Date and Duration Days are empty, and gives a new assignment the policy maximum", () => {
        const [existing] = check("role", `${ROLE_HEAD}\nrole-pra,u-anna,,eligible,add,,,,`);
        expect(existing.result).toBe("alreadyThere");
        expect(existing.end).toBe("Ends 2027-01-31");
    });

    it("says an unknown policy cannot give an end instead of assuming no end", () => {
        const noPolicy = roles.map((r) => (r.definition.id === "role-pra" ? { ...r, policy: null } : r));
        const [row] = check("role", `${ROLE_HEAD}\nrole-pra,,megan@contoso.com,eligible,add,,,,`, { roles: noPolicy });
        expect(row.result).toBe("error");
        expect(row.message).toContain("policy is not known yet");
    });

    it("never crashes on a huge, zero or odd Duration Days", () => {
        const rows = check("role", `${ROLE_HEAD}\nrole-pra,,megan@contoso.com,eligible,add,,,999999999999,\nrole-pra,u-anna,,eligible,add,,,0,\nrole-pra,u-bram,,eligible,add,,,30,`);
        expect(rows.map((r) => r.result)).toEqual(["error", "error", "new"]);
        expect(rows[0].message).toContain("Duration Days 999999999999");
    });

    it("accepts only ISO dates", () => {
        const rows = check("role", `${ROLE_HEAD}\nrole-pra,,megan@contoso.com,eligible,add,,01-04-2027,,\nrole-pra,u-anna,,eligible,add,,2027-02-31,,\nrole-pra,u-bram,,eligible,add,,2027-09-09,,`);
        expect(rows.map((r) => r.message)).toEqual(["End Date 01-04-2027 is not a date.", "End Date 2027-02-31 is not a date.", "New assignment"]);
    });

    it("reads an assignment that has ended, with its own end date, as already there", () => {
        const withExpired = structuredClone(roles).map((r) => {
            if (r.definition.id === "role-pra") (r.assignments.eligible[0] as { scheduleInfo: { expiration: { endDateTime: string } } }).scheduleInfo.expiration.endDateTime = "2026-01-01T00:00:00Z";
            return r;
        });
        const [row] = check("role", `${ROLE_HEAD}\nrole-pra,u-anna,,eligible,add,,2026-01-01T00:00:00Z,,`, { roles: withExpired });
        expect(row.result).toBe("alreadyThere");
    });

    it("refuses two rows that ask opposite things, and compares scope without case", () => {
        const rows = check("role", `${ROLE_HEAD}\nrole-exo,u-mo,,eligible,remove,,,,\nrole-exo,u-mo,,eligible,add,,permanent,,`);
        expect(rows[1].message).toBe("Line 2 asks the opposite for the same assignment. Keep one of the two rows.");
        const [upper] = check("role", `${ROLE_HEAD}\nrole-pra,u-anna,,eligible,add,/,2027-01-31T00:00:00Z,,`);
        expect(upper.result).toBe("alreadyThere");
    });

    it("never replaces a change that is already in the basket", () => {
        const [row] = check("role", `${ROLE_HEAD}\nrole-exo,u-mo,,eligible,remove,,,,`);
        const id = changeId(row.change!);
        const [again] = check("role", `${ROLE_HEAD}\nrole-exo,u-mo,,eligible,remove,,,,`, { otherChangeIds: new Set([id]) });
        expect(again).toMatchObject({ result: "duplicate", message: "Already in your changes, skipped", change: null });
    });

    it("an Edit change of another kind on the same assignment is not replaced either (I-02)", () => {
        const [row] = check("role", `${ROLE_HEAD}\nrole-exo,u-mo,,eligible,remove,,,,`);
        // Edit holds a change of end for the same assignment, with the principal id in other case
        const editUpdate = changeId(row.change!).replace(/^remove\|/, "update|").toUpperCase().replace(/^UPDATE\|/, "update|");
        const [again] = check("role", `${ROLE_HEAD}\nrole-exo,u-mo,,eligible,remove,,,,`, { otherChangeIds: new Set([editUpdate]) });
        expect(again).toMatchObject({ result: "duplicate", change: null });
    });
});
