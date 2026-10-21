import { describe, expect, it } from "vitest";
import { CSV_BOM, FILE_SCHEMAS, parseCsvText, writeCsv, type ExportFileType } from "@/utils/exportSchema";
import { buildBulkGroupAssignmentRows, buildBulkRoleAssignmentRows, buildGroupPolicyRows, buildRolePolicyRows } from "@/utils/exportRows";
import { KIND_INFO, describeDecidedBy, describeKind, detectCsvKind, readImportFile, tooBigMessage, type ImportKind } from "@/utils/importDetect";
import { EXPORT_AUTH_CONTEXTS, EXPORT_EXTENSIONS, EXPORT_NOW, buildExportGroups, buildExportRoles } from "../fixtures/exportFixture";

/** The templates of the removed Bulk, as people kept them: headers and one example row */
const OLD = {
    roleRemovals: 'Role ID,Role Name,Principal ID,Principal UPN,Assignment Type,Scope ID,Action\n"","Global Reader","","john.smith@contoso.com",eligible,/,remove',
    groupRemovals: 'Group ID,Group Name,Principal ID,Principal UPN,Access Type,Assignment Type,Action\n"","IT Administrators","","john.smith@contoso.com",member,eligible,remove',
    roleAssignments: 'Role ID,Role Name,Principal ID,Principal UPN,Assignment Type,Duration Days,Justification,Action,Scope ID,End Date\n"","Global Reader","","john.smith@contoso.com",eligible,365,"Bulk onboarding",add,/,""',
    groupAssignments: 'Group ID,Group Name,Principal ID,Principal UPN,Access Type,Assignment Type,Duration Days,Justification,Action,End Date\n"","IT Administrators","","john.smith@contoso.com",member,eligible,180,"",add,""',
    rolePolicies: "Role ID,Role Name,Description,Built-in,Privileged,PIM Configured,Max Activation Duration,MFA Required,Justification Required,Approval Required,Approvers,Auth Context,Pre-approval Extension,Post-approval Extension,Permanent Count,Eligible Count,Active Count,Total Assignments\n\"\",\"Global Administrator\",\"\",Yes,Yes,Yes,PT8H,Yes,Yes,No,\"\",\"\",\"\",\"\",0,2,0,2",
    groupPolicies: "Group ID,Group Name,Group Type,Role-Assignable,Eligible Members,Eligible Owners,Active Members,Active Owners,Member Max Duration,Member MFA,Member Approval,Owner Max Duration,Owner MFA,Owner Approval,Member Pre-approval Extension,Member Post-approval Extension,Owner Pre-approval Extension,Owner Post-approval Extension\n\"\",\"IT Administrators\",Security,Yes,5,2,3,1,PT8H,Yes,No,PT8H,Yes,Yes,\"\",\"\",\"\",\"\"",
};

const lists = { authenticationContexts: EXPORT_AUTH_CONTEXTS, customExtensions: EXPORT_EXTENSIONS };
const roles = buildExportRoles();
const groups = buildExportGroups();

const exported: Record<string, { type: ExportFileType; kind: ImportKind; rows: ReturnType<typeof buildRolePolicyRows> }> = {
    roleAssignments: { type: "bulkRoleAssignments", kind: "roleAssignments", rows: buildBulkRoleAssignmentRows(roles, { now: EXPORT_NOW }).rows },
    groupAssignments: { type: "bulkGroupAssignments", kind: "groupAssignments", rows: buildBulkGroupAssignmentRows(groups, { now: EXPORT_NOW }).rows },
    rolePolicies: { type: "bulkRolePolicies", kind: "rolePolicies", rows: buildRolePolicyRows(roles, lists) },
    groupPolicies: { type: "bulkGroupPolicies", kind: "groupPolicies", rows: buildGroupPolicyRows(groups, lists) },
};

/** The file as European Excel saves it: semicolons, cells that hold one quoted */
function toSemicolons(csv: string): string {
    const quote = (cell: string) => (/[;"\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);
    return parseCsvText(csv).map((cells) => cells.map(quote).join(";")).join("\r\n") + "\r\n";
}

describe("every bulk file the Report exports is recognised", () => {
    for (const [name, { type, kind, rows }] of Object.entries(exported)) {
        it(`${name}: comma, semicolon, BOM, comment rows`, () => {
            const csv = writeCsv(FILE_SCHEMAS[type], rows, { preamble: ["Tenant: Contoso", "Exported by Alex"] });
            for (const text of [csv, CSV_BOM + csv, toSemicolons(csv)]) {
                const file = readImportFile(text, `${type}.csv`);
                expect(file.kind).toBe(kind);
                expect(file.detected.required.every((r) => r.present)).toBe(true);
                expect(file.csv?.errors).toEqual([]);
                expect(file.csv?.rows).toHaveLength(rows.length);
            }
        });
    }

    it("takes the Excel sep= line off and keeps the row numbers of the file", () => {
        const csv = "sep=;\r\nRole ID;Principal UPN;Assignment Type;End Date\r\nr1;a@contoso.com;eligible;nope\r\nr2;b@contoso.com;active;\r\n";
        const file = readImportFile(csv, "x.csv");
        expect(file.kind).toBe("roleAssignments");
        expect(file.csv?.delimiter).toBe(";");
        expect(file.csv?.rowNumbers).toEqual([3, 4]);
        expect(file.csv?.errors).toEqual([expect.objectContaining({ rowNumber: 3, header: "End Date", value: "nope" })]);
    });

    it("counts comment rows above the header in the row numbers", () => {
        const csv = writeCsv(FILE_SCHEMAS.bulkRoleAssignments, [{ roleId: "r1", principalId: "p1", assignmentType: "eligible" }], { preamble: ["Tenant: Contoso"] });
        expect(readImportFile(csv, "x.csv").csv?.rowNumbers).toEqual([3]);
    });
});

describe("the overview files are not for import", () => {
    it("says so", () => {
        const csv = writeCsv(FILE_SCHEMAS.overviewAssignments, []);
        const file = readImportFile(csv, "pim-overview-assignments.csv");
        expect(file.kind).toBeNull();
        expect(file.detected.problem).toContain("For Configure Import");
        expect(readImportFile(writeCsv(FILE_SCHEMAS.overviewRoleSettings, []), "x.csv").kind).toBeNull();
    });
});

describe("today's removal files", () => {
    it("are role or group assignments, marked as older removal files", () => {
        const role = readImportFile(OLD.roleRemovals, "role-removals.csv");
        expect(role.kind).toBe("roleAssignments");
        expect(role.detected.isOlderRemoval).toBe(true);
        expect(describeKind(role)).toBe("Role assignments (older removal file)");
        expect(role.csv?.rows[0]).toMatchObject({ roleName: "Global Reader", assignmentType: "eligible", action: "remove" });
        const group = readImportFile(OLD.groupRemovals, "group-removals.csv");
        expect(group.kind).toBe("groupAssignments");
        expect(group.detected.isOlderRemoval).toBe(true);
        expect(describeKind(group)).toBe("Group assignments (older removal file)");
    });

    it("are not taken for removals when the file has a Duration Days column", () => {
        expect(readImportFile(OLD.roleAssignments, "x.csv").detected.isOlderRemoval).toBe(false);
    });
});

describe("today's templates and old headers are still recognised", () => {
    it("reads the four old templates as the same types", () => {
        expect(readImportFile(OLD.rolePolicies, "a.csv").kind).toBe("rolePolicies");
        expect(readImportFile(OLD.groupPolicies, "a.csv").kind).toBe("groupPolicies");
        expect(readImportFile(OLD.roleAssignments, "a.csv").kind).toBe("roleAssignments");
        expect(readImportFile(OLD.groupAssignments, "a.csv").kind).toBe("groupAssignments");
    });
    it("accepts Role Name and Principal UPN in place of the ids", () => {
        const file = readImportFile("Role Name,Principal UPN,Assignment Type\nGlobal Reader,a@b.c,eligible\n", "a.csv");
        expect(file.kind).toBe("roleAssignments");
        expect(file.detected.required).toEqual([{ label: "Role ID", present: true }, { label: "Principal ID", present: true }, { label: "Assignment Type", present: true }]);
        expect(file.detected.alsoRead).toContain("Role Name");
        expect(describeDecidedBy(file.detected.decidedBy)).toBe("Recognised from Role Name, Principal UPN and Assignment Type.");
    });
});

describe("what is not a file of ours", () => {
    it("shows a missing required header in red", () => {
        const file = readImportFile("Role ID,Principal ID,Duration Days\nr1,p1,30\n", "a.csv", "roleAssignments");
        expect(file.kind).toBe("roleAssignments");
        expect(file.detected.required.find((r) => r.label === "Assignment Type")?.present).toBe(false);
    });
    it("does not recognise an unknown file", () => {
        const file = readImportFile("Name,Colour\nA,red\n", "a.csv");
        expect(file.kind).toBeNull();
        expect(file.detected.problem).toContain("does not recognise");
        expect(readImportFile("", "a.csv").detected.problem).toBe("The file is empty.");
    });
    it("lists unknown columns as skipped and the read-only export columns of a settings file", () => {
        const assignments = readImportFile("Role ID,Principal ID,Assignment Type,Notes\nr,p,eligible,x\n", "a.csv");
        expect(assignments.detected.skipped).toEqual([{ header: "Notes", reason: "unknown" }]);
        const policies = readImportFile(writeCsv(FILE_SCHEMAS.bulkRolePolicies, exported.rolePolicies.rows), "a.csv");
        const readOnly = policies.detected.skipped.filter((s) => s.reason === "readOnly").map((s) => s.header);
        expect(readOnly).toEqual(expect.arrayContaining(["Description", "Built-in", "Privileged", "Permanent Count", "Approvers", "Auth Context"]));
        expect(policies.detected.skipped.filter((s) => s.reason === "unknown")).toEqual([]);
    });
    it("tells a settings file with only the key column from nothing", () => {
        expect(detectCsvKind(["Role ID"]).kind).toBeNull();
        expect(detectCsvKind(["Role ID", "Max Activation Duration"]).kind).toBe("rolePolicies");
        expect(detectCsvKind(["Group ID", "Owner MFA"]).kind).toBe("groupPolicies");
    });
});

describe("JSON", () => {
    it("recognises an access model file", () => {
        const file = readImportFile(JSON.stringify({ schemaVersion: "1.0.0", roles: [{ templateId: "x" }] }), "model.json");
        expect(file.kind).toBe("accessModel");
        expect(file.detected.required.every((r) => r.present)).toBe(true);
        expect(describeDecidedBy(file.detected.decidedBy)).toBe("Recognised from schemaVersion and roles.");
    });
    it("recognises a PIM Manager access model file by its format, not as a PIM Monitor model", () => {
        const file = readImportFile(JSON.stringify({ format: "pim-manager-access-model", formatVersion: 1, exportedAt: "2026-10-20T09:00:00.000Z", tenant: { id: "t", name: "Contoso" }, labels: [], groups: [] }), "pim-manager-access-model-contoso-2026-10-20.json");
        expect(file.kind).toBe("accessModelChoices");
        expect(file.detected.required.every((r) => r.present)).toBe(true);
        expect(file.json).not.toBeNull();
    });
    it("does not take a PIM Manager backup for an access model", () => {
        const file = readImportFile(JSON.stringify({ schemaVersion: 1, app: { name: "PIM Manager", version: "3" }, exportedAt: "2026-10-01T00:00:00Z", roles: [] }), "pim-backup.json");
        expect(file.kind).toBeNull();
        expect(file.detected.problem).toContain("backup");
    });
    it("rejects broken and foreign JSON", () => {
        expect(readImportFile("{", "a.json").detected.problem).toBe("This file is not valid JSON.");
        expect(readImportFile("{\"a\":1}", "a.json").kind).toBeNull();
    });
});

describe("reading as another type", () => {
    it("takes the admin's choice and keeps the detection", () => {
        const file = readImportFile("Role ID,Principal ID,Assignment Type\nr,p,eligible\n", "a.csv", "groupAssignments");
        expect(file.kind).toBe("groupAssignments");
        expect(file.wasChosen).toBe(true);
        expect(file.detected.kind).toBe("roleAssignments");
    });
});

describe("limits", () => {
    it("words the size limit", () => expect(tooBigMessage(6.3 * 1024 * 1024)).toBe("This file is 6.3 MB. The limit is 5 MB."));
    it("counts the required columns of the reference", () => {
        expect(KIND_INFO.roleAssignments.required).toHaveLength(3);
        expect(KIND_INFO.groupAssignments.required).toHaveLength(4);
        expect(KIND_INFO.rolePolicies.required).toHaveLength(1);
        expect(KIND_INFO.groupPolicies.required).toHaveLength(1);
        expect(KIND_INFO.accessModel.required).toHaveLength(2);
    });
});

describe("the file as people edit it by hand (gate C of NG-71)", () => {
    it("skips a blank line before the header and a comment row between the rows", () => {
        const csv = "# note\r\n\r\nRole ID,Principal ID,Assignment Type\r\nr1,p1,eligible\r\n# half way\r\nr2,p2,active\r\n";
        const file = readImportFile(csv, "x.csv");
        expect(file.kind).toBe("roleAssignments");
        expect(file.csv?.rows).toEqual([{ roleId: "r1", principalId: "p1", assignmentType: "eligible" }, { roleId: "r2", principalId: "p2", assignmentType: "active" }]);
        expect(file.csv?.rowNumbers).toEqual([4, 6]);
        expect(file.csv?.missingColumns).not.toContain("Role ID");
    });

    it("counts the physical line of a row after a cell with a line break", () => {
        const csv = 'Role ID,Principal ID,Assignment Type,Justification\r\nr1,p1,active,"first\r\nsecond"\r\nr2,p2,active,why\r\n';
        expect(readImportFile(csv, "x.csv").csv?.rowNumbers).toEqual([2, 4]);
    });

    it("keeps an apostrophe in the text and reads no ambiguous date", () => {
        const file = readImportFile("Role ID,Principal ID,Assignment Type,Justification,End Date\nr1,p1,active,Megan\u2019s cover,01-04-2027\n", "x.csv");
        expect(file.csv?.rows[0].justification).toBe("Megan\u2019s cover");
        expect(file.csv?.errors).toEqual([expect.objectContaining({ header: "End Date", value: "01-04-2027" })]);
    });
});
