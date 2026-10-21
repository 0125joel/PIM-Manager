import { describe, expect, it } from "vitest";
import { FILE_SCHEMAS } from "@/utils/exportSchema";
import { CSV_KINDS, IMPORT_KINDS, KIND_INFO, readImportFile } from "@/utils/importDetect";
import { REFERENCE_NOTES, buildReference, buildTemplate, referencedHeaders, schemaHeaders } from "@/utils/importReference";

describe("the reference is generated from FILE_SCHEMAS", () => {
    for (const kind of CSV_KINDS) {
        it(`${kind}: every column of the schema appears exactly once`, () => {
            const headers = referencedHeaders(buildReference(kind));
            expect([...headers].sort()).toEqual([...schemaHeaders(kind)].sort());
            expect(new Set(headers).size).toBe(headers.length);
        });
        it(`${kind}: every note names a header of the schema`, () => {
            const known = new Set(schemaHeaders(kind).map((h) => h.toLowerCase()));
            for (const header of Object.keys(REFERENCE_NOTES[kind])) expect(known.has(header), `${kind}: ${header}`).toBe(true);
        });
    }

    it("counts the required columns of the render", () => {
        expect(buildReference("roleAssignments").requiredCount).toBe(3);
        expect(buildReference("groupAssignments").requiredCount).toBe(4);
        expect(buildReference("rolePolicies").requiredCount).toBe(1);
        expect(buildReference("accessModel").requiredCount).toBe(2);
    });

    it("sorts the role settings columns into the boxes of the render", () => {
        const boxes = Object.fromEntries(buildReference("rolePolicies").boxes.map((b) => [b.id, b]));
        expect(boxes.required.rows.map((r) => r.header)).toEqual(["Role ID"]);
        expect(boxes.activation.rows.map((r) => r.header)).toContain("Max Activation Duration");
        expect(boxes.activation.countLabel).toBe("11 columns");
        expect(boxes.assignment.rows.map((r) => r.header)).toContain("Eligible Allow Permanent");
        expect(boxes.assignment.countLabel).toBe("6 columns");
        expect(boxes.notifications.rows).toHaveLength(3);
        expect(boxes.notifications.countLabel).toBe("27 columns");
        const other = boxes.other.rows.map((r) => r.header);
        expect(other).toContain("Role Name");
        expect(other).toContain("MFA Required");
        expect(boxes.other.rows.find((r) => r.values[0] === "read only")?.headers).toEqual(expect.arrayContaining(["Description", "Built-in", "Permanent Count", "Approvers", "Auth Context"]));
    });

    it("takes the values from the codec", () => {
        const rows = buildReference("rolePolicies").boxes.flatMap((b) => b.rows);
        expect(rows.find((r) => r.header === "Require On Activation")?.values).toEqual(["none", "mfa", "authenticationContext"]);
        expect(rows.find((r) => r.header === "Ticket Required")?.values).toEqual(["Yes", "No"]);
        expect(rows.find((r) => r.header === "Role ID")?.values).toEqual(["<UUID>"]);
        expect(buildReference("roleAssignments").boxes.flatMap((b) => b.rows).find((r) => r.header === "Assignment Type")?.values).toEqual(["eligible", "active"]);
    });

    it("lists Member and Owner columns of group settings once each", () => {
        const headers = referencedHeaders(buildReference("groupPolicies"));
        expect(headers).toContain("Member Max Duration");
        expect(headers).toContain("Owner Max Duration");
    });
});

describe("templates", () => {
    it("have the headers of the import and read back as their own kind", () => {
        for (const kind of CSV_KINDS) {
            const template = buildTemplate(kind)!;
            const file = readImportFile(template.csv, template.fileName);
            expect(file.kind, kind).toBe(kind);
            expect(file.csv?.errors, kind).toEqual([]);
            expect(file.csv?.rows).toHaveLength(1);
            expect(file.detected.required.every((r) => r.present)).toBe(true);
        }
    });
    it("leave the read-only export columns out and there is none for the access model", () => {
        expect(buildTemplate("rolePolicies")!.csv.split("\r\n")[0]).not.toContain("Permanent Count");
        expect(buildTemplate("accessModel")).toBeNull();
    });

});

describe("kinds", () => {
    it("have a schema, except the two access model kinds", () => {
        expect(IMPORT_KINDS.filter((k) => !KIND_INFO[k].schema)).toEqual(["accessModel", "accessModelChoices"]);
        expect(KIND_INFO.roleAssignments.schema).toBe(FILE_SCHEMAS.bulkRoleAssignments);
    });
});
