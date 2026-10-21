import { describe, expect, it } from "vitest";
import { matchContext } from "@/utils/authContextSlug";
import { EMPTY_BASKET } from "@/utils/configureBasket";
import { FILE_SCHEMAS, parseCsvText, writeCsv, type ExportRow } from "@/utils/exportSchema";
import { buildGroupPolicyRows, buildRolePolicyRows } from "@/utils/exportRows";
import { readImportFile } from "@/utils/importDetect";
import { compareAccessModel, compareSettingsRows, normaliseActivationDuration, notificationFieldOf, type CompareContext, type SettingsCompareResult } from "@/utils/importSettings";
import { NOTIFICATION_KEYS } from "@/utils/exportSchema";
import { buildFixtureAccess } from "../fixtures/configureFixture";
import publishedCatalog from "@/config/accessModel/eam-catalog.json";
import { EXPORT_AUTH_CONTEXTS, EXPORT_EXTENSIONS, buildExportGroups, buildExportRoles } from "../fixtures/exportFixture";

const roles = buildExportRoles();
const groups = buildExportGroups();
const lists = { authenticationContexts: EXPORT_AUTH_CONTEXTS, customExtensions: EXPORT_EXTENSIONS };
const ctx: CompareContext = {
    fileName: "f.csv", roles, groups, access: null, tenantName: "Contoso", loading: { isRolesLoading: false, isGroupsLoading: false },
    words: { contexts: EXPORT_AUTH_CONTEXTS, extensions: EXPORT_EXTENSIONS }, contexts: EXPORT_AUTH_CONTEXTS, otherBasket: EMPTY_BASKET, names: new Map(),
};

function compare(kind: "role" | "group", csv: string, patch: Partial<CompareContext> = {}): SettingsCompareResult {
    const file = readImportFile(csv, "f.csv");
    expect(file.kind).toBe(kind === "role" ? "rolePolicies" : "groupPolicies");
    return compareSettingsRows({ ...ctx, ...patch, kind, rows: file.csv!.rows, rowNumbers: file.csv!.rowNumbers, errors: file.csv!.errors, headers: file.csv!.headers });
}

const roleCsv = (rows: ExportRow[]) => writeCsv(FILE_SCHEMAS.bulkRolePolicies, rows);
const groupCsv = (rows: ExportRow[]) => writeCsv(FILE_SCHEMAS.bulkGroupPolicies, rows);
const roleRows = buildRolePolicyRows(roles, lists);
const groupRows = buildGroupPolicyRows(groups, lists);

describe("an export of an unchanged tenant compares to nothing", () => {
    it("roles: 0 values differ, no problem that needs a fix", () => {
        const result = compare("role", roleCsv(roleRows));
        expect(result.diffs.map((d) => [d.line, d.target, d.setting, d.from, d.to])).toEqual([]);
        expect(result.problems.filter((p) => p.kind === "fix")).toEqual([]);
        expect(result.differs).toBe(0);
        expect(result.matches).toBeGreaterThan(20);
    });
    it("groups: 0 values differ (Member and Owner)", () => {
        const result = compare("group", groupCsv(groupRows));
        expect(result.diffs.map((d) => [d.line, d.target, d.setting, d.from, d.to])).toEqual([]);
        expect(result.problems.filter((p) => p.kind === "fix")).toEqual([]);
        expect(result.matches).toBeGreaterThan(20);
    });
    it("also from a semicolon file as European Excel writes it (cells with a ; quoted)", () => {
        const quote = (cell: string) => (/[;"\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);
        const semicolons = (csv: string) => parseCsvText(csv).map((cells) => cells.map(quote).join(";")).join("\r\n") + "\r\n";
        const withApprovers = roleRows.map((r) => (r.roleId === "role-ga" ? { ...r, approvers: [{ type: "user" as const, id: "u-erik" }, { type: "group" as const, id: "g-secleads" }] } : r));
        expect(compare("role", semicolons(roleCsv(withApprovers))).differs).toBe(0);
        expect(compare("group", semicolons(groupCsv(groupRows))).differs).toBe(0);
    });
});

describe("one edited cell gives one change", () => {
    const base = roleRows.find((r) => r.roleId === "role-helpdesk")!;
    const edit = (patch: ExportRow) => compare("role", roleCsv([{ ...base, ...patch }]));

    it("maximum activation duration, through any spelling of the same time", () => {
        const result = edit({ maxActivationDuration: "PT2H" });
        expect(result.diffs).toHaveLength(1);
        expect(result.diffs[0]).toMatchObject({ setting: expect.stringMatching(/activation duration/i), to: "2 hours", change: { field: "maxActivationDuration", to: "PT2H", source: { from: "import", file: "f.csv", line: 2 } } });
        expect(edit({ maxActivationDuration: "PT90M" }).diffs[0].change.to).toBe("PT1H30M");
    });

    it("P1D in the file against PT24H in the tenant is no difference, and a value outside 1 to 24 hours is refused", () => {
        expect(normaliseActivationDuration("P1D")).toBe("PT24H");
        expect(normaliseActivationDuration("PT90M")).toBe("PT1H30M");
        // The tenant holds PT8H: P1D (24 hours) is a change, PT8H spelled PT480M is none
        expect(edit({ maxActivationDuration: "PT480M" }).diffs).toEqual([]);
        expect(edit({ maxActivationDuration: "P1D" }).diffs[0].change.to).toBe("PT24H");
        const refused = edit({ maxActivationDuration: "PT30M" });
        expect(refused.diffs).toEqual([]);
        expect(refused.problems[0].message).toBe("The maximum activation duration must be from 1 to 24 hours.");
        expect(edit({ maxActivationDuration: "P2D" }).problems).toHaveLength(1);
    });

    it("an empty cell and a missing column keep the value", () => {
        expect(edit({ maxActivationDuration: undefined }).diffs).toEqual([]);
        const withoutColumn = writeCsv({ columns: FILE_SCHEMAS.bulkRolePolicies.columns.filter((c) => ["Role ID", "Justification Required"].includes(c.header)) }, [{ roleId: base.roleId, justificationRequired: base.justificationRequired }]);
        expect(compare("role", withoutColumn).diffs).toEqual([]);
    });

    it("flags, expirations and the requirement", () => {
        const flip = (key: string) => edit({ [key]: !(base[key] as boolean) });
        for (const key of ["justificationRequired", "ticketRequired", "approvalRequired", "allowPermanentEligible", "allowPermanentActive", "activeRequiresMfa", "activeRequiresJustification"]) {
            if (typeof base[key] !== "boolean") continue;
            const result = flip(key);
            expect(result.diffs.some((d) => d.change.source.from === "import"), key).toBe(true);
        }
        const mfa = edit({ requireOnActivation: "mfa" });
        expect(mfa.diffs).toHaveLength(1);
        expect(mfa.diffs[0]).toMatchObject({ setting: "On activation, require", to: "Multifactor authentication", change: { to: { kind: "mfa" } } });
        const context = edit({ requireOnActivation: "authenticationContext", authContextId: EXPORT_AUTH_CONTEXTS[0].id });
        expect(context.diffs[0].change.to).toEqual({ kind: "authenticationContext", contextId: EXPORT_AUTH_CONTEXTS[0].id });
    });

    it("the older MFA Required column never downgrades a context, Require On Activation wins when both are filled", () => {
        const contextRow = roleRows.find((r) => r.roleId === "role-ga")!;
        const keep = compare("role", roleCsv([{ roleId: contextRow.roleId, mfaRequired: false }]));
        expect(keep.diffs).toEqual([]);
        // The tenant holds Nothing; the new column says MFA and the older one says No: the new one wins
        const both = compare("role", roleCsv([{ roleId: base.roleId, mfaRequired: false, requireOnActivation: "mfa" }]));
        expect(both.diffs).toHaveLength(1);
        expect(both.diffs[0].change.to).toEqual({ kind: "mfa" });
        // MFA Required Yes alone is MFA
        expect(compare("role", roleCsv([{ roleId: base.roleId, mfaRequired: true }])).diffs[0].change.to).toEqual({ kind: "mfa" });
    });

    it("an authentication context that does not exist, or none given, is an error", () => {
        expect(edit({ requireOnActivation: "authenticationContext", authContextId: "c-nope" }).problems[0].message).toBe("Authentication context c-nope does not exist in Contoso.");
        expect(edit({ requireOnActivation: "authenticationContext", authContextId: undefined }).problems[0].message).toContain("Auth Context ID is needed");
    });

    it("an unknown role, a role named twice and a row with a bad cell need a fix", () => {
        const rows = compare("role", roleCsv([{ roleId: "role-zzz", maxActivationDuration: "PT2H" }, { roleId: base.roleId, maxActivationDuration: "PT2H" }, { roleId: base.roleId, maxActivationDuration: "PT3H" }]));
        expect(rows.problems.map((p) => p.message)).toEqual(["No role with this ID in Contoso.", `${base.roleName} is also on line 3. Keep one row per role.`]);
        const bad = compare("role", "Role ID,Max Activation Duration\nr,soon\n");
        expect(bad.problems[0].message).toContain("Max Activation Duration");
    });
});

describe("notifications", () => {
    it("every notification key of the schema is a field", () => {
        expect(NOTIFICATION_KEYS).toHaveLength(27);
        for (const key of NOTIFICATION_KEYS) expect(notificationFieldOf(key), key).toMatch(/^notifications\.(eligibleAssignment|activeAssignment|activation)\.(admin|assignee|requestor|approver)\.(isEnabled|additionalRecipients|criticalOnly)$/);
    });
    it("recipients compare as a set, any order and case", () => {
        const row = roleRows.find((r) => typeof r["n.activation.admin.additionalRecipients"] === "string" && String(r["n.activation.admin.additionalRecipients"]).includes(";"))
            ?? roleRows.find((r) => typeof r["n.activation.admin.additionalRecipients"] === "string");
        if (!row) return;
        const parts = String(row["n.activation.admin.additionalRecipients"]).split(";");
        const shuffled = [...parts].reverse().map((p) => p.toUpperCase()).join(";");
        expect(compare("role", roleCsv([{ roleId: row.roleId, "n.activation.admin.additionalRecipients": shuffled }])).diffs).toEqual([]);
        const changed = compare("role", roleCsv([{ roleId: row.roleId, "n.activation.admin.additionalRecipients": `${parts.join(";")};new@contoso.com` }]));
        expect(changed.diffs).toHaveLength(1);
        expect(changed.diffs[0].change.to).toEqual([...parts.map((p) => p.trim()), "new@contoso.com"]);
    });
    it("a switched cell is one change", () => {
        const row = roleRows[0];
        const key = "n.activation.admin.isEnabled";
        const read = row[key] as boolean | undefined;
        if (read === undefined) return;
        expect(compare("role", roleCsv([{ roleId: row.roleId, [key]: !read }])).diffs).toHaveLength(1);
    });
});

describe("groups", () => {
    it("Member and Owner are compared apart", () => {
        const row = groupRows.find((r) => r["member.maxActivationDuration"] && r["owner.maxActivationDuration"])!;
        const result = compare("group", groupCsv([{ groupId: row.groupId, "owner.maxActivationDuration": "PT2H" }]));
        expect(result.diffs).toHaveLength(1);
        expect(result.diffs[0].target).toMatch(/· Owner$/);
        expect(result.diffs[0].change.target).toMatchObject({ kind: "group", access: "owner" });
    });
    it("a group not under PIM has no settings yet and is skipped with that reason", () => {
        const outside = groups.find((g) => g.isManaged === false);
        if (!outside) return;
        const result = compare("group", groupCsv([{ groupId: outside.group.id, "member.maxActivationDuration": "PT2H" }]));
        expect(result.diffs).toEqual([]);
        expect(result.problems[0]).toMatchObject({ kind: "skipped" });
        expect(result.problems[0].message).toContain("no PIM settings yet");
    });
    it("a group approval without approvers is refused", () => {
        const row = groupRows.find((r) => r["member.approvalRequired"] === false && !r["member.approvers"]);
        if (!row) return;
        const result = compare("group", groupCsv([{ groupId: row.groupId, "member.approvalRequired": true }]));
        expect(result.diffs).toEqual([]);
        expect(result.problems[0].message).toContain("approvers");
    });
});

describe("what Edit already changed is left alone", () => {
    it("says so and writes nothing for that field", () => {
        const base = roleRows.find((r) => r.maxActivationDuration)!;
        const otherBasket = { changes: [{ kind: "setting" as const, target: { kind: "role" as const, id: String(base.roleId) }, field: "maxActivationDuration" as const, from: String(base.maxActivationDuration), to: "PT3H", source: { from: "edit" as const } }] };
        const result = compare("role", roleCsv([{ roleId: base.roleId, maxActivationDuration: "PT2H" }]), { otherBasket });
        expect(result.diffs).toEqual([]);
        expect(result.problems[0].message).toContain("already in your changes");
    });
});

describe("extensions and approvers of a role with both", () => {
    const ga = roleRows.find((r) => r.roleId === "role-ga")!;
    const edit = (patch: ExportRow) => compare("role", roleCsv([{ roleId: ga.roleId, ...patch }]));

    it("an empty id keeps the link, an Enabled cell alone switches the flag of the link there", () => {
        expect(edit({ preExtensionId: undefined, preExtensionEnabled: undefined }).diffs).toEqual([]);
        const off = edit({ preExtensionEnabled: false });
        expect(off.diffs).toHaveLength(1);
        expect(off.diffs[0].change).toMatchObject({ field: "customExtensions.preApproval", to: { customExtensionId: "ext-servicenow", isEnabled: false } });
        expect((off.diffs[0].change.to as { displayName?: string }).displayName).toBeUndefined();
    });

    it("links another extension of the tenant, refuses one that is not in it, and ignores the read-only names", () => {
        const other = edit({ preExtensionId: "ext-audit" });
        expect(other.diffs[0].change.to).toMatchObject({ customExtensionId: "ext-audit", isEnabled: true });
        expect(edit({ preExtensionId: "ext-gone" }).problems[0].message).toBe("Custom extension ext-gone is not in Contoso.");
        expect(edit({ preExtensionName: "Something else", approverNames: "Nobody", authContextName: "Nothing" }).diffs).toEqual([]);
    });

    it("approvers are compared by id and type in any order, a manager has no id", () => {
        expect(edit({ approvers: [{ type: "group", id: "g-secleads" }, { type: "user", id: "u-erik" }] }).diffs).toEqual([]);
        const result = edit({ approvers: [{ type: "manager", id: "" }] });
        expect(result.diffs).toHaveLength(1);
        expect(result.diffs[0].change.to).toEqual([{ type: "manager", id: "", displayName: undefined }]);
        expect(result.diffs[0].to).toBe("Manager");
    });

    it("approvers are ignored while approval goes off, and approval off takes them along", () => {
        const off = edit({ approvalRequired: false, approvers: [{ type: "manager", id: "" }] });
        expect(off.diffs.map((d) => d.change.field)).toEqual(["requireApproval"]);
    });

    it("names the approvers it has names for", () => {
        const result = compare("role", roleCsv([{ roleId: ga.roleId, approvers: [{ type: "user", id: "u-new" }] }]), { names: new Map([["u-new", "Megan Bowen"]]) });
        expect(result.diffs[0].to).toBe("Megan Bowen");
    });

    it("an approver id the tenant cannot know is a fix, never written (I-06)", () => {
        const result = compare("role", roleCsv([{ roleId: ga.roleId, approvers: [{ type: "user", id: "megan" }] }]));
        expect(result.diffs).toEqual([]);
        expect(result.problems.map((p) => p.message)).toEqual([expect.stringContaining("megan is not an id")]);
    });

    it("an approver id in other case is the same approver (I-07)", () => {
        const held = roleRows.find((r) => r.roleId === ga.roleId)!;
        const upper = (held.approvers as { type: string; id: string }[]).map((a) => ({ ...a, id: a.id.toUpperCase() }));
        expect(compare("role", roleCsv([{ ...held, approvers: upper }])).diffs).toEqual([]);
    });

    it("an error in a column the import never reads does not fail the row (I-08)", () => {
        const csv = roleCsv([{ roleId: ga.roleId, maxActivationDuration: "PT3H" }]).replace(/\r\n([^\r\n]+)\r\n$/, (_m, line: string) => `\r\n${line}\r\n`);
        const header = csv.split("\r\n")[0].split(",");
        const at = header.findIndex((h) => h.toLowerCase() === "eligible count");
        expect(at).toBeGreaterThan(-1);
        const cells = csv.split("\r\n")[1].split(",");
        cells[at] = "12a";
        const result = compare("role", `${header.join(",")}\r\n${cells.join(",")}\r\n`);
        expect(result.problems).toEqual([]);
    });
});

describe("an access model file", () => {
    const resolveContext = (slug: string) => { const m = matchContext(slug, EXPORT_AUTH_CONTEXTS, {}); return m.kind === "byName" || m.kind === "chosen" ? m.contextId : null; };
    const model = { ...ctx, resolveContext, templateOf: () => undefined, placementOf: () => null };

    it("reads the published PIM Monitor catalog as an access model file (R-02: the shape of 2026-10-03.1)", () => {
        const file = readImportFile(JSON.stringify(publishedCatalog), "eam-catalog.json");
        expect(file.kind).toBe("accessModel");
        const result = compareAccessModel(publishedCatalog, model);
        // Every entry is matched or named by why it is left alone; the only fixes are fixture roles whose policy the
        // fixture does not hold (tenant state), never the file's shape
        expect(result.problems.filter((p) => p.kind === "fix").map((p) => p.message)).toEqual(Array(2).fill("The settings of this target could not be read."));
        // The fixture tenant holds a few of the 145 roles: those compare, the rest and the four group cells (no group
        // placed) are left alone with their reason
        expect(result.diffs.length).toBeGreaterThan(0);
        const skipped = result.problems.filter((p) => p.kind === "skipped").map((p) => p.message);
        expect(skipped.every((m) => /^No role with the template |^No group is placed at |^The label /.test(m))).toBe(true);
        expect(skipped.filter((m) => m.startsWith("No group is placed at"))).toHaveLength(4);
    });

    it("sets the six fields an expectedConfig can carry, per role by template id, with the line of the entry", () => {
        const json = { schemaVersion: "1.0.0", roles: [{ templateId: "role-helpdesk", expectedConfig: { maxActivationDuration: "PT2H", requireMFA: true, requireJustification: true, requireApproval: false, allowPermanentEligible: false, allowPermanentActive: false } }] };
        const result = compareAccessModel(json, model);
        expect(result.unit).toBe("Entry");
        expect(result.diffs.map((d) => d.change.field).sort()).toEqual(["activationRequirement", "allowPermanentEligible", "maxActivationDuration", "requireJustificationOnActivation"].sort());
        expect(result.diffs.every((d) => d.line === 1 && d.change.source.from === "import")).toBe(true);
        expect(result.matches).toBe(2);
    });

    it("leaves the requirement alone for a label with no context, and says so", () => {
        const json = { roles: [{ templateId: "role-helpdesk", expectedConfig: { authContext: "phish-resistant-sif" } }] };
        const result = compareAccessModel(json, model);
        expect(result.diffs).toEqual([]);
        expect(result.problems[0]).toMatchObject({ kind: "skipped" });
        expect(result.problems[0].message).toContain("phish-resistant-sif");
    });

    it("marks Nothing from requireMFA false on a role that requires more now as weaker than now", () => {
        const json = { roles: [{ templateId: "role-ga", expectedConfig: { requireMFA: false } }] };
        const result = compareAccessModel(json, model);
        expect(result.diffs[0].warning).toBe("Weaker than now");
    });

    it("brings a duration outside 1 to 24 hours to the nearest value and says so", () => {
        const result = compareAccessModel({ roles: [{ templateId: "role-helpdesk", expectedConfig: { maxActivationDuration: "PT30M" } }] }, model);
        expect(result.diffs[0].change.to).toBe("PT1H");
        expect(result.problems[0].message).toContain("nearest value from 1 to 24 hours");
    });

    it("finds a role by a unique display name, refuses an unknown role and a role twice", () => {
        const result = compareAccessModel({ roles: [
            { displayName: "Helpdesk Administrator", expectedConfig: { maxActivationDuration: "PT2H" } },
            { templateId: "role-nope", expectedConfig: { maxActivationDuration: "PT2H" } },
            { templateId: "role-helpdesk", expectedConfig: { maxActivationDuration: "PT3H" } },
        ] }, model);
        expect(result.diffs).toHaveLength(1);
        expect(result.problems.map((p) => [p.line, p.kind])).toEqual([[2, "skipped"], [3, "fix"]]);
    });

    it("applies a group cell to the groups placed there, Member and Owner", () => {
        const placed = groups.find((g) => g.isManaged !== false && g.policies?.member && g.policies?.owner)!;
        const json = { groups: [{ plane: "Control", securityLevel: "Privileged", member: { maxActivationDuration: "PT2H" }, owner: { maxActivationDuration: "PT1H" } }] };
        const result = compareAccessModel(json, { ...model, placementOf: (id) => (id === placed.group.id ? { plane: "Control", securityLevel: "Privileged" } : null) });
        expect(result.diffs.map((d) => d.target.split(" · ")[1])).toEqual(expect.arrayContaining(["Member", "Owner"]));
        expect(result.diffs.every((d) => d.target.startsWith(placed.group.displayName))).toBe(true);
        const none = compareAccessModel(json, model);
        expect(none.problems[0].message).toContain("No group is placed at Control");
    });

    it("finds a group entry by id or by a unique name, and says so for one it does not know (N-012)", () => {
        const known = groups.find((g) => g.isManaged !== false && g.policies?.member)!;
        const byId = compareAccessModel({ groups: [{ groupId: known.group.id, member: { maxActivationDuration: "PT2H" } }] }, model);
        expect(byId.diffs.some((d) => d.target.startsWith(known.group.displayName))).toBe(true);
        const byName = compareAccessModel({ groups: [{ displayName: known.group.displayName, member: { maxActivationDuration: "PT2H" } }] }, model);
        expect(byName.diffs.some((d) => d.target.startsWith(known.group.displayName))).toBe(true);
        const unknown = compareAccessModel({ groups: [{ displayName: "No such group", member: { maxActivationDuration: "PT2H" } }] }, model);
        expect(unknown.diffs).toEqual([]);
        expect(unknown.problems[0]).toMatchObject({ target: "No such group", kind: "skipped" });
        // An entry with nothing to name it is "Group 1" (I-13)
        expect(compareAccessModel({ groups: [{ member: { maxActivationDuration: "PT2H" } }] }, model).problems[0].target).toBe("Group 1");
    });
});

describe("what the review of the code found (gate C of NG-72)", () => {
    const ga = roleRows.find((r) => r.roleId === "role-ga")!;
    const helpdesk = roleRows.find((r) => r.roleId === "role-helpdesk")!;
    const withApprovers = { type: "user" as const, id: "u-erik" };

    it("says what it ignores: approvers while approval is off, an older No, an extension without an id", () => {
        const approvers = compare("role", roleCsv([{ roleId: helpdesk.roleId, approvalRequired: false, approvers: [withApprovers] }]));
        expect(approvers.problems).toEqual([expect.objectContaining({ kind: "note", message: "Approver IDs are ignored while approval is off." })]);
        const legacy = compare("role", roleCsv([{ roleId: ga.roleId, mfaRequired: false }]));
        expect(legacy.problems.map((p) => p.kind)).toEqual(["note"]);
        expect(legacy.problems[0].message).toContain("MFA Required No keeps");
    });

    it("a locked target is a fix only when the row would write", () => {
        const locked = { access: buildFixtureAccess("none") };
        const same = compare("role", roleCsv([{ roleId: helpdesk.roleId, maxActivationDuration: helpdesk.maxActivationDuration }]), locked);
        expect(same.problems).toEqual([]);
        const writes = compare("role", roleCsv([{ roleId: helpdesk.roleId, maxActivationDuration: "PT2H" }]), locked);
        expect(writes.problems[0]).toMatchObject({ kind: "fix" });
        expect(writes.problems[0].message).toContain("You cannot change Helpdesk Administrator now.");
    });

    it("a group whose approvers wait in Edit's basket is not without approvers", () => {
        const row = groupRows.find((r) => r["member.approvalRequired"] === false && !r["member.approvers"])!;
        const edit = { kind: "setting" as const, target: { kind: "group" as const, id: String(row.groupId), access: "member" as const }, field: "approvers" as const, from: [], to: [{ id: "u-erik", type: "user" as const }], source: { from: "edit" as const } };
        const result = compare("group", groupCsv([{ groupId: row.groupId, "member.approvalRequired": true }]), { otherBasket: { changes: [edit] } });
        expect(result.problems.filter((p) => p.kind === "fix")).toEqual([]);
        expect(result.diffs.map((d) => d.change.field)).toEqual(["requireApproval"]);
    });

    it("says an extension the policy lacks is not in this policy", () => {
        const noExtensions = roles.map((r) => (r.definition.id === "role-helpdesk" ? { ...r, policy: r.policy && { ...r.policy, details: { ...r.policy.details, rules: (r.policy.details.rules ?? []).filter((x) => !String((x as { id?: string }).id).startsWith("CustomExtension")) } } } : r)) as typeof roles;
        const result = compare("role", roleCsv([{ roleId: helpdesk.roleId, preExtensionId: "ext-audit" }]), { roles: noExtensions });
        expect(result.problems.some((p) => p.message.includes("Not in this policy: custom extension before approval"))).toBe(true);
    });

    it("an access model group entry for the same group twice is left alone the second time", () => {
        const placed = groups.find((g) => g.isManaged !== false && g.policies?.member)!;
        const model = { ...ctx, resolveContext: () => null, templateOf: () => undefined, placementOf: (id: string) => (id === placed.group.id ? { plane: "Control" as const, securityLevel: "Privileged" as const } : null) };
        const cell = { plane: "Control", securityLevel: "Privileged", member: { maxActivationDuration: "PT2H" } };
        const result = compareAccessModel({ groups: [cell, { groupId: placed.group.id, member: { maxActivationDuration: "PT3H" } }] }, model);
        expect(result.diffs).toHaveLength(1);
        expect(result.problems.some((p) => p.message.startsWith("Already set by entry 1"))).toBe(true);
    });
});
