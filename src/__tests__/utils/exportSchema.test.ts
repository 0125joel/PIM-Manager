import { describe, expect, it } from "vitest";
import {
    FILE_SCHEMAS, approversCodec, daysCodec, durationCodec, endDateCodec, enumCodec, intCodec, parseCsvText, prepareCsvText, readCsv, writeCsv, yesNoCodec,
    type ExportFileType, type ExportRow, type FileSchema,
} from "@/utils/exportSchema";
import {
    buildAssignmentRows, buildBulkGroupAssignmentRows, buildBulkRoleAssignmentRows, buildGroupPolicyRows, buildOverviewGroupSettingsRows,
    buildOverviewRoleSettingsRows, buildRolePolicyRows, policyFieldsOf, type ExportLists,
} from "@/utils/exportRows";
import { buildBackup } from "@/utils/exportBackup";
import { toGraphDuration } from "@/utils/durationUtils";
import { readImportFile, type ImportKind } from "@/utils/importDetect";
import {
    COMMA_GROUP_NAME, EXPORT_AUTH_CONTEXTS, EXPORT_EXTENSIONS, EXPORT_NOW, NASTY_GROUP_NAME, buildExportGroups, buildExportRoles,
} from "../fixtures/exportFixture";

const lists: ExportLists = { authenticationContexts: EXPORT_AUTH_CONTEXTS, customExtensions: EXPORT_EXTENSIONS };
const roles = buildExportRoles();
const groups = buildExportGroups();

/** What a row should read back as: the source row without empty cells */
function expectedOf(schema: FileSchema, row: ExportRow): ExportRow {
    const expected: ExportRow = {};
    for (const column of schema.columns) {
        const value = row[column.key];
        if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) continue;
        expected[column.key] = value;
    }
    return expected;
}

const rowsByType = (): Record<ExportFileType, ExportRow[]> => ({
    overviewAssignments: buildAssignmentRows(roles, groups, { emergencyIds: new Set(["u-bg1"]) }) as unknown as ExportRow[],
    overviewRoleSettings: buildOverviewRoleSettingsRows(roles, lists),
    overviewGroupSettings: buildOverviewGroupSettingsRows(groups, lists),
    bulkRolePolicies: buildRolePolicyRows(roles, lists),
    bulkGroupPolicies: buildGroupPolicyRows(groups, lists),
    bulkRoleAssignments: buildBulkRoleAssignmentRows(roles, { now: EXPORT_NOW }).rows,
    bulkGroupAssignments: buildBulkGroupAssignmentRows(groups, { now: EXPORT_NOW }).rows,
});

describe("cell codecs", () => {
    it("reads Yes and No in any spelling and rejects the rest", () => {
        expect(yesNoCodec.read("YES")).toEqual({ ok: true, value: true });
        expect(yesNoCodec.read("0")).toEqual({ ok: true, value: false });
        expect(yesNoCodec.read("")).toEqual({ ok: true, value: undefined });
        expect(yesNoCodec.read("maybe").ok).toBe(false);
        expect(yesNoCodec.write(true)).toBe("Yes");
        expect(yesNoCodec.write(undefined)).toBe("");
    });
    it("reads ISO durations only", () => {
        expect(durationCodec.read("PT8H")).toEqual({ ok: true, value: "PT8H" });
        expect(durationCodec.read("8 hours").ok).toBe(false);
    });
    it("reads whole numbers, days and end dates", () => {
        expect(intCodec.read("12")).toEqual({ ok: true, value: 12 });
        expect(intCodec.read("-1").ok).toBe(false);
        expect(daysCodec.read("Permanent")).toEqual({ ok: true, value: "permanent" });
        expect(daysCodec.read("3.5").ok).toBe(false);
        expect(endDateCodec.read("permanent")).toEqual({ ok: true, value: "permanent" });
        expect(endDateCodec.read("2027-06-30T00:00:00Z")).toEqual({ ok: true, value: "2027-06-30T00:00:00Z" });
        expect(endDateCodec.read("next week").ok).toBe(false);
    });
    it("reads enums without case", () => {
        expect(enumCodec(["eligible", "active"] as const).read("Active")).toEqual({ ok: true, value: "active" });
        expect(enumCodec(["eligible", "active"] as const).read("permanent").ok).toBe(false);
    });
    it("writes and reads approvers as type:id", () => {
        const refs = [{ type: "user" as const, id: "u1" }, { type: "group" as const, id: "g1" }, { type: "manager" as const, id: "" }];
        expect(approversCodec.write(refs)).toBe("user:u1;group:g1;manager");
        expect(approversCodec.read("user:u1;group:g1;manager")).toEqual({ ok: true, value: refs });
        expect(approversCodec.read("robot:7").ok).toBe(false);
    });
});

describe("CSV text", () => {
    it("keeps commas, quotes and line breaks inside quoted cells and strips a BOM", () => {
        expect(parseCsvText("﻿a,b\r\n\"x, \"\"y\"\"\nz\",2\r\n")).toEqual([["a", "b"], ["x, \"y\"\nz", "2"]]);
    });

    it("a quote inside an unquoted cell is text, and an unclosed quote is an error, never silent (I-01)", () => {
        // A stray inch mark does not swallow the next rows
        expect(parseCsvText('a,b\r\nNeeds 24" screen,add\r\nx,remove\r\n')).toEqual([["a", "b"], ['Needs 24" screen', "add"], ["x", "remove"]]);
        // A curly quote inside a quoted cell stays text; one around a cell is a quote
        const curly = prepareCsvText('a,b\r\n"Per \u201CINC-1, ok",remove\r\n\u201Cwrapped\u201D,add\r\n');
        expect(parseCsvText(curly.text)).toEqual([["a", "b"], ["Per \u201CINC-1, ok", "remove"], ["wrapped", "add"]]);
        // A quoted cell never closed: the row says so
        const schema = FILE_SCHEMAS.bulkRoleAssignments;
        const header = schema.columns.map((c) => c.header).join(",");
        const read = readCsv(schema, `${header}\r\n"Global Reader,a@x.com\r\nUser Administrator,b@x.com\r\n`);
        expect(read.errors.some((e) => e.message.includes("never closed"))).toBe(true);
    });
    it("reads headers without case, ignores unknown columns and reports missing ones", () => {
        const schema = FILE_SCHEMAS.bulkRoleAssignments;
        const result = readCsv(schema, "role id,PRINCIPAL ID,Extra\nr1,p1,x\n");
        expect(result.rows).toEqual([{ roleId: "r1", principalId: "p1" }]);
        expect(result.unknownColumns).toEqual(["Extra"]);
        expect(result.missingColumns).toContain("End Date");
    });
    it("writes comment rows above the header and reads past them", () => {
        const schema = FILE_SCHEMAS.bulkRoleAssignments;
        const csv = writeCsv(schema, [{ roleId: "r1", principalId: "p1" }], { preamble: ["Tenant: Contoso, Inc", "# Filter: none"] });
        expect(csv.split("\r\n").slice(0, 3)).toEqual(['"# Tenant: Contoso, Inc"', "# Filter: none", schema.columns.map((c) => c.header).join(",")]);
        expect(readCsv(schema, csv).rows).toEqual([{ roleId: "r1", principalId: "p1" }]);
    });
    it("reports a bad cell with its row and header", () => {
        const result = readCsv(FILE_SCHEMAS.bulkRoleAssignments, "Role ID,Duration Days\nr1,soon\n");
        expect(result.errors).toEqual([{ rowNumber: 2, header: "Duration Days", message: expect.stringContaining("soon"), value: "soon" }]);
    });
});

describe("round trip per file type", () => {
    for (const type of Object.keys(FILE_SCHEMAS) as ExportFileType[]) {
        it(`${type}: write then read gives the source back`, () => {
            const schema = FILE_SCHEMAS[type];
            const rows = rowsByType()[type];
            expect(rows.length).toBeGreaterThan(0);
            const result = readCsv(schema, writeCsv(schema, rows));
            expect(result.errors).toEqual([]);
            expect(result.missingColumns).toEqual([]);
            expect(result.unknownColumns).toEqual([]);
            expect(result.rows).toEqual(rows.map((r) => expectedOf(schema, r)));
        });
    }

    it("file names carry the date", () => {
        expect(FILE_SCHEMAS.bulkGroupPolicies.fileName("2026-10-02")).toBe("pim-bulk-group-policies-2026-10-02.csv");
        expect(FILE_SCHEMAS.overviewAssignments.fileName("2026-10-02")).toBe("pim-overview-assignments-2026-10-02.csv");
    });
});

describe("policy fields", () => {
    const ga = roles[0];
    const fields = policyFieldsOf(ga.policy?.details?.rules, lists, ga.policy?.approvers);

    it("carries every activation field", () => {
        expect(fields).toMatchObject({
            maxActivationDuration: "PT4H",
            requireOnActivation: "authenticationContext",
            authContextId: "c1",
            authContextName: "Phishing-resistant",
            mfaRequired: false,
            ticketRequired: true,
            approvalRequired: true,
            approverNames: "Erik van Dam; Security Leads",
            approvers: [{ type: "user", id: "u-erik" }, { type: "group", id: "g-secleads" }],
            preExtensionId: "ext-servicenow",
            preExtensionName: "ServiceNow ticket check",
            preExtensionEnabled: true,
            postExtensionId: "ext-audit",
        });
    });
    it("carries the assignment fields and every non default notification rule", () => {
        expect(fields).toMatchObject({ allowPermanentEligible: true, eligibleExpiration: "P1Y", allowPermanentActive: true, activeRequiresMfa: true });
        const notificationKeys = Object.keys(fields ?? {}).filter((k) => k.startsWith("n."));
        expect(notificationKeys).toHaveLength(27);
        expect(fields?.["n.eligibleAssignment.admin.additionalRecipients"]).toBe("n0@contoso.com;audit@contoso.com");
        expect(fields?.["n.eligibleAssignment.admin.criticalOnly"]).toBe(true);
        expect(fields?.["n.eligibleAssignment.assignee.isEnabled"]).toBe(true);
        expect(fields?.["n.eligibleAssignment.admin.isEnabled"]).toBe(false);
    });
    it("is null without rules", () => {
        expect(policyFieldsOf([], lists)).toBeNull();
        expect(policyFieldsOf(undefined, lists)).toBeNull();
    });
    it("completes group rules that have no target", () => {
        const memberRules = groups[0].policies?.member?.rules.map(({ target, ...rest }) => { void target; return rest; });
        const stripped = policyFieldsOf(memberRules, lists);
        expect(stripped?.maxActivationDuration).toBe("PT4H");
        expect(stripped?.["n.activation.requestor.additionalRecipients"]).toBe(fields?.["n.activation.requestor.additionalRecipients"]);
    });
});

/** The expected notification fields read straight from the raw rules, not through the parser under test */
function expectedNotifications(rules: readonly { id: string; [key: string]: unknown }[]): Record<string, unknown> {
    const category: Record<string, string> = { "Admin_Eligibility": "eligibleAssignment", "Admin_Assignment": "activeAssignment", "EndUser_Assignment": "activation" };
    const expected: Record<string, unknown> = {};
    for (const rule of rules) {
        const match = /^Notification_(Admin|Requestor|Approver)_(Admin|EndUser)_(Eligibility|Assignment)$/.exec(rule.id);
        if (!match) continue;
        const cat = category[`${match[2]}_${match[3]}`];
        const recipient = match[1] === "Requestor" ? (cat === "activation" ? "requestor" : "assignee") : match[1].toLowerCase();
        const recipients = (rule.notificationRecipients as string[]).join(";");
        expected[`n.${cat}.${recipient}.isEnabled`] = rule.isDefaultRecipientsEnabled;
        expected[`n.${cat}.${recipient}.additionalRecipients`] = recipients === "" ? undefined : recipients;
        expected[`n.${cat}.${recipient}.criticalOnly`] = rule.notificationLevel === "Critical";
    }
    return expected;
}

describe("every policy field equals the raw rules", () => {
    const ga = roles[0];
    const gaRules = ga.policy?.details?.rules as unknown as { id: string; [key: string]: unknown }[];
    const memberRules = groups[0].policies?.member?.rules as unknown as { id: string; [key: string]: unknown }[];
    const ownerRules = groups[0].policies?.owner?.rules as unknown as { id: string; [key: string]: unknown }[];

    for (const [label, rules, approvers] of [["role", gaRules, ga.policy?.approvers], ["group member", memberRules, groups[0].policies?.member?.approvers], ["group owner", ownerRules, []]] as const) {
        it(`${label}: all 27 notification fields`, () => {
            const fields = policyFieldsOf(rules, lists, approvers) ?? {};
            const expected = expectedNotifications(rules);
            expect(Object.keys(expected)).toHaveLength(27);
            for (const [key, value] of Object.entries(expected)) expect(fields[key], key).toEqual(value);
        });
        it(`${label}: expiration, activation and assignment fields`, () => {
            const fields = policyFieldsOf(rules, lists, approvers) ?? {};
            const rule = (id: string) => rules.find((r) => r.id === id) as Record<string, unknown>;
            expect(fields.maxActivationDuration).toBe(rule("Expiration_EndUser_Assignment").maximumDuration);
            expect(fields.allowPermanentEligible).toBe(rule("Expiration_Admin_Eligibility").isExpirationRequired === false);
            expect(fields.allowPermanentActive).toBe(rule("Expiration_Admin_Assignment").isExpirationRequired === false);
            expect(toGraphDuration(String(fields.eligibleExpiration))).toBe(rule("Expiration_Admin_Eligibility").maximumDuration);
            expect(toGraphDuration(String(fields.activeExpiration))).toBe(rule("Expiration_Admin_Assignment").maximumDuration);
            const enabled = (rule("Enablement_EndUser_Assignment").enabledRules as string[]);
            expect(fields.justificationRequired).toBe(enabled.includes("Justification"));
            expect(fields.ticketRequired).toBe(enabled.includes("Ticketing"));
            expect(fields.mfaRequired).toBe(enabled.includes("MultiFactorAuthentication"));
            const activeEnabled = (rule("Enablement_Admin_Assignment").enabledRules as string[]);
            expect(fields.activeRequiresMfa).toBe(activeEnabled.includes("MultiFactorAuthentication"));
            expect(fields.activeRequiresJustification).toBe(activeEnabled.includes("Justification"));
            expect(fields.approvalRequired).toBe((rule("Approval_EndUser_Assignment").setting as { isApprovalRequired: boolean }).isApprovalRequired);
        });
    }

    it("keeps a linked but switched off extension and says it is off", () => {
        const owner = policyFieldsOf(ownerRules, lists);
        expect(owner).toMatchObject({ preExtensionId: "ext-audit", preExtensionEnabled: false, preExtensionName: "Audit trail hook" });
        expect(owner?.postExtensionId).toBeUndefined();
        const schema = FILE_SCHEMAS.bulkGroupPolicies;
        const read = readCsv(schema, writeCsv(schema, rowsByType().bulkGroupPolicies));
        const helpdesk = read.rows.find((r) => r.groupId === "g-helpdesk");
        expect(helpdesk).toMatchObject({ "owner.preExtensionId": "ext-audit", "owner.preExtensionEnabled": false, "member.preExtensionEnabled": true, "member.postExtensionId": "ext-audit", "member.postExtensionEnabled": true });
    });

    it("writes Member and Owner side by side in the group file", () => {
        const schema = FILE_SCHEMAS.bulkGroupPolicies;
        const helpdesk = readCsv(schema, writeCsv(schema, rowsByType().bulkGroupPolicies)).rows.find((r) => r.groupId === "g-helpdesk");
        expect(helpdesk).toMatchObject({
            "member.maxActivationDuration": "PT4H", "owner.maxActivationDuration": "PT8H",
            "member.requireOnActivation": "authenticationContext", "owner.requireOnActivation": "none",
            "member.approvalRequired": true, "owner.approvalRequired": false,
            "member.approvers": [{ type: "user", id: "u-erik" }, { type: "group", id: "g-secleads" }],
        });
    });
});

describe("bulk files", () => {
    const roleResult = buildBulkRoleAssignmentRows(roles, { now: EXPORT_NOW });
    const groupResult = buildBulkGroupAssignmentRows(groups, { now: EXPORT_NOW });

    it("leaves out activated and via group role assignments and counts them", () => {
        expect(roleResult.skipped).toEqual({ activated: 2, viaGroup: 2 });
        expect(roleResult.rows).toHaveLength(8);
        expect(roleResult.rows.map((r) => r.principalId)).not.toContain("u-ravi");
        // Nor the role assignment an activation leaves behind in the legacy list
        expect(roleResult.rows.filter((r) => r.principalId === "u-mo" && r.roleId === "role-ga")).toHaveLength(1);
    });
    it("equals the source tenant, assignment by assignment", () => {
        const key = (r: ExportRow) => `${r.roleId}|${r.principalId}|${r.assignmentType}|${r.scopeId}|${r.endDate}`;
        expect(roleResult.rows.map(key).sort()).toEqual([
            "role-ga|sp-deploy|eligible|/app-deploy|permanent",
            "role-ga|u-anna|eligible|/|permanent",
            "role-ga|u-bram|eligible|/administrativeUnits/au-1|2027-06-30T00:00:00Z",
            "role-ga|u-erik|active|/|permanent",
            "role-ga|u-guest|eligible|/|2027-01-15T08:00:00Z",
            "role-ga|u-lotte|active|/|permanent",
            "role-ga|u-mo|active|/|2026-12-01T12:00:00Z",
            "role-helpdesk|u-mo|eligible|/|2027-03-01T00:00:00Z",
        ].sort());
        const groupKey = (r: ExportRow) => `${r.groupId}|${r.principalId}|${r.accessType}|${r.assignmentType}|${r.endDate}`;
        expect(groupResult.rows.map(groupKey).sort()).toEqual([
            "g-comma|u-bram|owner|eligible|2027-02-01T00:00:00Z",
            "g-helpdesk|u-erik|owner|active|permanent",
            "g-helpdesk|u-lotte|member|eligible|2027-06-30T00:00:00Z",
            "g-helpdesk|u-mo|member|eligible|permanent",
            "g-helpdesk|u-ravi|member|active|2026-12-24T10:00:00Z",
            "g-nasty|u-mo|member|eligible|permanent",
        ].sort());
    });
    it("writes scope, end date and the whole days left", () => {
        const bram = roleResult.rows.find((r) => r.principalId === "u-bram");
        expect(bram).toMatchObject({ scopeId: "/administrativeUnits/au-1", endDate: "2027-06-30T00:00:00Z", durationDays: "271", assignmentType: "eligible" });
        const app = roleResult.rows.find((r) => r.principalId === "sp-deploy");
        expect(app).toMatchObject({ principalUpn: "", scopeId: "/app-deploy", endDate: "permanent", durationDays: "permanent" });
    });
    it("writes a permanent role assignment once, as active and permanent", () => {
        const lotte = roleResult.rows.filter((r) => r.principalId === "u-lotte" && r.assignmentType === "active");
        expect(lotte).toHaveLength(1);
        expect(lotte[0]).toMatchObject({ durationDays: "permanent", endDate: "permanent" });
        expect(roleResult.rows.find((r) => r.principalId === "u-erik")).toMatchObject({ assignmentType: "active", endDate: "permanent" });
    });
    it("leaves out activated and via group group assignments and counts them", () => {
        expect(groupResult.skipped).toEqual({ activated: 1, viaGroup: 1 });
        expect(groupResult.rows).toHaveLength(6);
        expect(groupResult.rows.find((r) => r.principalId === "u-erik")).toMatchObject({ accessType: "owner", assignmentType: "active", endDate: "permanent" });
        expect(groupResult.rows.find((r) => r.principalId === "u-mo" && r.groupId === "g-helpdesk")).toMatchObject({ assignmentType: "eligible", endDate: "permanent" });
    });
    it("reads memberType without case: Graph documents direct and group in lower case", () => {
        const lower = buildExportGroups().map((g) => ({ ...g, assignments: g.assignments.map((a) => ({ ...a, memberType: a.memberType?.toLowerCase() })) }));
        expect(buildBulkGroupAssignmentRows(lower, { now: EXPORT_NOW }).skipped).toEqual(groupResult.skipped);
        const lowerRoles = buildExportRoles().map((r) => ({
            ...r,
            assignments: { ...r.assignments, eligible: r.assignments.eligible.map((e) => ({ ...e, memberType: e.memberType?.toLowerCase() })) },
        }));
        expect(buildBulkRoleAssignmentRows(lowerRoles, { now: EXPORT_NOW }).skipped).toEqual(roleResult.skipped);
    });
    it("a role without rules has an empty policy part and PIM Configured No", () => {
        const rows = buildRolePolicyRows(roles, lists);
        const reader = rows.find((r) => r.roleId === "role-reader");
        expect(reader).toMatchObject({ pimConfigured: false });
        expect(reader?.maxActivationDuration).toBeUndefined();
        const csv = writeCsv(FILE_SCHEMAS.bulkRolePolicies, rows);
        expect(csv.split("\r\n").length).toBe(rows.length + 2);
    });
});

describe("Import reads the files of today's export and the new bulk files", () => {
    const cases: Array<{ type: ExportFileType; kind: ImportKind }> = [
        { type: "bulkRolePolicies", kind: "rolePolicies" },
        { type: "bulkGroupPolicies", kind: "groupPolicies" },
        { type: "bulkRoleAssignments", kind: "roleAssignments" },
        { type: "bulkGroupAssignments", kind: "groupAssignments" },
    ];

    // The headers of the export before the new columns, the first columns of each new file
    const legacyHeaders: Record<string, string[]> = {
        bulkRolePolicies: ["Role ID", "Role Name", "Description", "Built-in", "Privileged", "PIM Configured", "Max Activation Duration", "MFA Required", "Justification Required", "Approval Required", "Approvers", "Auth Context", "Pre-approval Extension", "Post-approval Extension", "Permanent Count", "Eligible Count", "Active Count", "Total Assignments"],
        bulkGroupPolicies: ["Group ID", "Group Name", "Group Type", "Role-Assignable", "Eligible Members", "Eligible Owners", "Active Members", "Active Owners", "Member Max Duration", "Member MFA", "Member Approval", "Owner Max Duration", "Owner MFA", "Owner Approval", "Member Pre-approval Extension", "Member Post-approval Extension", "Owner Pre-approval Extension", "Owner Post-approval Extension"],
        bulkRoleAssignments: ["Role ID", "Role Name", "Principal ID", "Principal UPN", "Assignment Type", "Duration Days", "Justification", "Action"],
        bulkGroupAssignments: ["Group ID", "Group Name", "Principal ID", "Principal UPN", "Access Type", "Assignment Type", "Duration Days", "Justification", "Action"],
    };

    for (const { type, kind } of cases) {
        it(`${type} is recognised as ${kind}, also with only the old columns, and reads the same values`, () => {
            const schema = FILE_SCHEMAS[type];
            const rows = rowsByType()[type];
            const full = readImportFile(writeCsv(schema, rows), `${type}.csv`);
            expect(full.kind).toBe(kind);
            expect(full.csv?.errors).toEqual([]);
            expect(full.csv?.rows).toHaveLength(rows.length);

            const legacySchema: FileSchema = { ...schema, columns: schema.columns.filter((c) => legacyHeaders[type].includes(c.header)) };
            expect(legacySchema.columns.map((c) => c.header)).toEqual(legacyHeaders[type]);
            const legacy = readImportFile(writeCsv(legacySchema, rows), `${type}.csv`);
            expect(legacy.kind).toBe(kind);
            expect(legacy.csv?.errors).toEqual([]);
            // Every value of an old column is the same in both files
            const keys = new Set(legacySchema.columns.map((c) => c.key));
            const only = (r: ExportRow) => Object.fromEntries(Object.entries(r).filter(([k]) => keys.has(k)));
            expect(legacy.csv?.rows.map(only)).toEqual(full.csv?.rows.map(only));
        });
    }

    it("keeps Scope ID and End Date of the bulk assignment files as exported", () => {
        for (const type of ["bulkRoleAssignments", "bulkGroupAssignments"] as const) {
            const rows = rowsByType()[type];
            const read = readImportFile(writeCsv(FILE_SCHEMAS[type], rows), `${type}.csv`).csv!;
            expect(read.errors).toEqual([]);
            read.rows.forEach((r, i) => {
                if (type === "bulkRoleAssignments" && rows[i].scopeId) expect(r.scopeId).toBe(rows[i].scopeId);
                expect(r.endDate).toBe(rows[i].endDate);
            });
        }
        const scoped = rowsByType().bulkRoleAssignments.filter((r) => r.scopeId && r.scopeId !== "/");
        expect(scoped.length).toBeGreaterThan(0);
    });

    it("reads the group name that starts with = as the group's name (the apostrophe that defuses it is taken off)", () => {
        const read = readImportFile(writeCsv(FILE_SCHEMAS.bulkGroupPolicies, rowsByType().bulkGroupPolicies), "g.csv").csv!;
        expect(read.rows.map((r) => r.groupName)).toContain(NASTY_GROUP_NAME);
    });
});

describe("cell escaping", () => {
    it("defuses a group name that starts with = and reads it back", () => {
        const csv = writeCsv(FILE_SCHEMAS.bulkGroupPolicies, rowsByType().bulkGroupPolicies);
        expect(csv).toContain(`"'=HYPERLINK(""http://example.com"")"`);
        expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
        const names = readCsv(FILE_SCHEMAS.bulkGroupPolicies, csv).rows.map((r) => r.groupName);
        expect(names).toContain(NASTY_GROUP_NAME);
        expect(names).toContain(COMMA_GROUP_NAME);
    });
    it("does the same in the overview files", () => {
        const csv = writeCsv(FILE_SCHEMAS.overviewAssignments, rowsByType().overviewAssignments);
        expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
    });
});

describe("overview files", () => {
    it("adds the ids, Privileged, Emergency access and Origin", () => {
        const rows = buildAssignmentRows(roles, groups, { emergencyIds: new Set(["u-bg1"]) });
        const bg1 = rows.find((r) => r.objectId === "u-bg1");
        expect(bg1).toMatchObject({ emergency: true, privileged: true, resourceId: "role-ga", origin: "Assigned" });
        const activated = rows.find((r) => r.objectId === "u-ravi" && r.resource === "Global Administrator" && r.type === "Active");
        expect(activated?.origin).toBe("Activated");
        const group = rows.find((r) => r.resource === "Helpdesk Tier 1" && r.objectId === "u-erik");
        expect(group).toMatchObject({ resourceId: "g-helpdesk", origin: "Assigned", emergency: false });
        expect(group?.privileged).toBeUndefined();
        expect(rows.find((r) => r.type === "Eligible")?.origin).toBe("");
    });
    it("lists a role assignment from the legacy list only when no active schedule covers it", () => {
        const rows = buildAssignmentRows(roles, groups);
        const ga = rows.filter((r) => r.resource === "Global Administrator" && r.type !== "Eligible");
        // Lotte (assigned schedule) and Ravi (activation) come once, from their schedules; Erik has no schedule
        expect(ga.filter((r) => r.objectId === "u-lotte")).toHaveLength(1);
        expect(ga.filter((r) => r.objectId === "u-ravi").map((r) => r.origin)).toEqual(["Activated"]);
        expect(ga.filter((r) => r.objectId === "u-erik")).toMatchObject([{ type: "Permanent", origin: "Assigned" }]);
    });
    it("keeps the header the dashboard CSV has as the first columns", () => {
        const header = writeCsv(FILE_SCHEMAS.overviewAssignments, []).split("\r\n")[0];
        expect(header.startsWith("Workload,Role or group,Access,Assignment,Name,UPN or mail,Object id,Principal type,Member type,Start,End,Scope")).toBe(true);
    });
    it("writes the settings of a role as readable text and says why a role has none", () => {
        const rows = buildOverviewRoleSettingsRows(roles, lists);
        const ga = rows.find((r) => r.roleId === "role-ga");
        expect(ga).toMatchObject({ settings: "Loaded", privileged: true });
        expect(String(ga?.["tile.extensionBefore"])).toContain("ServiceNow ticket check");
        expect(String(ga?.["tile.approvers"])).toContain("Erik van Dam");
        expect(String(ga?.["tile.activation"])).toContain("Admin:");
        expect(rows.find((r) => r.roleId === "role-reader")?.settings).toBe("Not configured");
        expect(rows.find((r) => r.roleId === "role-failed")?.settings).toBe("Not loaded");
    });
    it("writes one row per group and Member or Owner", () => {
        const rows = buildOverviewGroupSettingsRows(groups, lists);
        expect(rows).toHaveLength(groups.length * 2);
        expect(rows.filter((r) => r.groupId === "g-comma").every((r) => r.settings === "Not configured")).toBe(true);
        expect(rows.find((r) => r.groupId === "g-helpdesk" && r.access === "Owner")?.settings).toBe("Loaded");
    });
});

describe("backup", () => {
    const input = {
        roles, groups,
        tenant: { id: "t-1", displayName: "Contoso" },
        readAt: { directoryRoles: "2026-10-02T11:00:00Z", pimGroups: "2026-10-02T11:01:00Z" },
        appVersion: "3.2.0",
        exportedAt: EXPORT_NOW,
        workloads: ["directoryRoles", "pimGroups"] as ("directoryRoles" | "pimGroups")[],
        authenticationContexts: EXPORT_AUTH_CONTEXTS,
        customExtensions: EXPORT_EXTENSIONS,
    };

    it("has the header of spec 10.5", () => {
        const backup = buildBackup(input);
        expect(backup).toMatchObject({
            schemaVersion: 1,
            app: { name: "PIM Manager", version: "3.2.0" },
            tenant: { id: "t-1", displayName: "Contoso" },
            readAt: { directoryRoles: "2026-10-02T11:00:00Z" },
            exportedAt: "2026-10-02T12:00:00.000Z",
            workloads: ["directoryRoles", "pimGroups"],
        });
        expect(backup.lists.authenticationContexts).toHaveLength(EXPORT_AUTH_CONTEXTS.length);
        expect(backup.lists.customExtensions).toHaveLength(EXPORT_EXTENSIONS.length);
        expect(backup.lists.customExtensionsNote).toBeUndefined();
    });
    it("keeps the raw rules next to the parsed settings and every assignment", () => {
        const backup = buildBackup(input);
        const ga = backup.directoryRoles?.find((r) => r.definition.id === "role-ga");
        expect(ga?.policy?.rules).toBe(roles[0].policy?.details?.rules);
        expect(ga?.settings?.maxActivationDuration).toBe("PT4H");
        expect(ga?.assignments.active).toHaveLength(roles[0].assignments.active.length);
        expect(backup.directoryRoles?.find((r) => r.definition.id === "role-reader")).toMatchObject({ policy: null, settings: null });
        expect(backup.directoryRoles?.find((r) => r.definition.id === "role-failed")?.configError).toBe("Forbidden");
        const group = backup.pimGroups?.find((g) => g.group.id === "g-helpdesk");
        expect(group?.policies.member?.rules).toHaveLength(groups[0].policies?.member?.rules.length ?? -1);
        expect(group?.settings.member?.requireApproval).toBe(true);
        expect(group?.assignments).toHaveLength(6);
        expect(backup.pimGroups?.find((g) => g.group.id === "g-comma")).toMatchObject({ policies: { member: null, owner: null }, settings: { member: null, owner: null } });
    });
    it("leaves out a workload that is not loaded", () => {
        const backup = buildBackup({ ...input, workloads: ["directoryRoles"] });
        expect(backup.pimGroups).toBeUndefined();
        expect(backup.directoryRoles).toHaveLength(roles.length);
    });
    it("says so when the extension list could not be read", () => {
        const backup = buildBackup({ ...input, customExtensions: null });
        expect(backup.lists.customExtensions).toEqual([]);
        expect(backup.lists.customExtensionsNote).toContain("could not be read");
    });
    it("survives JSON", () => {
        const backup = buildBackup(input);
        const parsed = JSON.parse(JSON.stringify(backup));
        expect(parsed.schemaVersion).toBe(1);
        expect(parsed.directoryRoles[0].policy.rules).toEqual(roles[0].policy?.details?.rules);
        expect(parsed.pimGroups[0].assignments).toHaveLength(groups[0].assignments.length);
    });
});
