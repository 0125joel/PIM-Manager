import { describe, expect, it } from "vitest";
import type { AuditEvent } from "@/types/audit.types";
import {
    AUDIT_EXPORT_COLUMNS,
    AUDIT_PDF_CLOSING_NOTE,
    AZURE_PDF_CLOSING_NOTE,
    auditExportStem,
    describeAuditFilter,
    describeAuditScope,
    parseStoredAuditExportChoice,
    planAuditExport,
    type AuditExportChoice,
    type AuditExportInput,
} from "@/utils/auditExportPlan";

// Invented data only: Contoso names, made-up ids and tickets.
const HEADERS = [
    "Time (UTC)", "Kind", "Environment", "Action", "By", "By id", "Target", "Target id", "Role or group", "Role id", "Scope", "Scope id", "Result", "Failure reason",
    "Reason", "Ticket", "Approved by", "Denied by", "New value", "Requested minutes", "Used minutes", "Ended by", "Ended at (UTC)", "Ends (UTC)", "MFA",
    "Emergency access", "Source", "Workspace", "Event id", "Correlation id", "Through group", "Roles through the group",
];

const MEGAN = { name: "Megan Bowen", id: "00000000-0000-4000-8000-00000000a001", kind: "person" as const };
const ALEX = { name: "Alex Wilber", id: "00000000-0000-4000-8000-00000000a002", kind: "person" as const };
const GRADY = { name: "Grady Archie", id: "00000000-0000-4000-8000-00000000a003", kind: "person" as const };
const BREAK_GLASS = { name: "Break Glass 01", id: "00000000-0000-4000-8000-00000000a004", kind: "person" as const };

const EVENTS: AuditEvent[] = [
    {
        id: "ev-1",
        time: "2026-11-04T08:42:00Z",
        kind: "usage",
        environment: "role",
        sentence: "Megan Bowen activated Security Administrator",
        actor: MEGAN,
        role: { name: "Security Administrator", id: "r-sec" },
        scope: "Directory",
        result: "success",
        reason: "Investigate sign-in alert for Grady Archie",
        ticket: "INC-4471",
        approver: "Alex Wilber",
        requestedDuration: 60,
        usedMinutes: 19,
        endedBy: ALEX,
        endedAt: "2026-11-04T09:01:00Z",
        mfa: true,
        source: "graph",
        correlationId: "corr-1",
    },
    {
        id: "ev-2",
        time: "2026-11-03T15:05:00Z",
        kind: "setting",
        environment: "role",
        sentence: "Maximum activation duration set for Global Administrator",
        actor: ALEX,
        role: { name: "Global Administrator", id: "r-ga" },
        scope: "Directory",
        result: "success",
        newValue: "=HYPERLINK(\"https://example.invalid\")",
        source: "graph",
        correlationId: "corr-2",
    },
    {
        id: "ev-3",
        time: "2026-10-30T13:31:00Z",
        kind: "outside",
        environment: "role",
        sentence: "Grady Archie added to Exchange Administrator outside PIM",
        actor: BREAK_GLASS,
        target: { name: "Grady Archie", id: GRADY.id },
        role: { name: "Exchange Administrator", id: "r-ex" },
        scope: "Directory",
        result: "failure",
        failureReason: "RoleAssignmentExists",
        reason: "+1 call with Megan Bowen",
        source: "graph",
        correlationId: "corr-3",
    },
];

const EMERGENCY = new Set([BREAK_GLASS.id]);

const INPUT: AuditExportInput = {
    events: EVENTS,
    period: { from: new Date("2026-10-06T11:58:00Z"), to: new Date("2026-11-05T11:58:00Z") },
    filterSentence: "System events off",
    searchTerm: "",
    readAt: "2026-11-05T11:58:00Z",
    oldestAvailable: new Date("2026-10-06T11:58:00Z"),
    source: "graph",
    tenant: { id: "3f2a91c4-7d1e-4b6a-9e0f-5c8d2a1b7e63", name: "Contoso Ltd" },
    exporter: "Alex Wilber (alexw@contoso.com)",
    emergencyIds: EMERGENCY,
    exportedAt: new Date("2026-11-05T12:05:00Z"),
};

const CSV: AuditExportChoice = { format: "csv", replaceNames: false };
const JSON_: AuditExportChoice = { format: "json", replaceNames: false };
const PDF: AuditExportChoice = { format: "pdf", replaceNames: false };

function content(input: AuditExportInput, choice: AuditExportChoice): string {
    const file = planAuditExport(input, choice);
    if (file.format === "pdf") return JSON.stringify(file.pdf);
    return file.content;
}

function csvLines(input: AuditExportInput, choice: AuditExportChoice = CSV): { heading: string[]; header: string[]; rows: string[][] } {
    const lines = content(input, choice).split("\r\n").filter((line) => line !== "");
    const heading = lines.filter((line) => line.startsWith("#") || line.startsWith('"#'));
    const [header, ...rows] = lines.slice(heading.length).map((line) => line.split(","));
    return { heading, header, rows };
}

describe("columns and order", () => {
    it("has the 28 columns in the agreed order, as CSV headers and as JSON keys", () => {
        expect(AUDIT_EXPORT_COLUMNS.map((column) => column.header)).toEqual(HEADERS);
        expect(csvLines(INPUT).header).toEqual(HEADERS);
        const parsed = JSON.parse(content(INPUT, JSON_)) as { events: Record<string, unknown>[] };
        const keys = Object.keys(parsed.events[0]);
        expect(keys).toEqual(HEADERS.filter((header) => keys.includes(header)));
        expect(keys).toContain("Event id");
    });

    it("lists the events newest first with ISO 8601 times in UTC", () => {
        const { rows } = csvLines(INPUT);
        expect(rows.map((row) => row[0])).toEqual(["2026-11-04T08:42:00.000Z", "2026-11-03T15:05:00.000Z", "2026-10-30T13:31:00.000Z"]);
        expect(rows[0][HEADERS.indexOf("Ended at (UTC)")]).toBe("2026-11-04T09:01:00.000Z");
    });

    it("writes Yes and No in CSV and booleans in JSON, and nothing when the log has no MFA value", () => {
        const { rows } = csvLines(INPUT);
        expect(rows[0][HEADERS.indexOf("MFA")]).toBe("Yes");
        expect(rows[1][HEADERS.indexOf("MFA")]).toBe("");
        expect(rows[0][HEADERS.indexOf("Emergency access")]).toBe("No");
        expect(rows[2][HEADERS.indexOf("Emergency access")]).toBe("Yes");
        const parsed = JSON.parse(content(INPUT, JSON_)) as { events: Record<string, unknown>[] };
        expect(parsed.events[0]["MFA"]).toBe(true);
        expect("MFA" in parsed.events[1]).toBe(false);
        expect(parsed.events[0]["Emergency access"]).toBe(false);
        expect(parsed.events[2]["Emergency access"]).toBe(true);
        expect(parsed.events[0]["Requested minutes"]).toBe(60);
    });

    it("leaves a missing value empty in CSV and out of JSON, never Unknown or None", () => {
        const { rows } = csvLines(INPUT);
        expect(rows[1][HEADERS.indexOf("Target")]).toBe("");
        expect(rows[1][HEADERS.indexOf("Reason")]).toBe("");
        const parsed = JSON.parse(content(INPUT, JSON_)) as { events: Record<string, unknown>[] };
        expect("Target" in parsed.events[1]).toBe(false);
        expect("Reason" in parsed.events[1]).toBe(false);
        for (const text of [content(INPUT, CSV), content(INPUT, JSON_)]) {
            expect(text).not.toMatch(/Unknown|None/);
        }
    });

    it("holds every field, whatever the page shows", () => {
        const { rows } = csvLines(INPUT);
        expect(rows[0].slice(HEADERS.indexOf("Ticket"), HEADERS.indexOf("Approved by") + 1)).toEqual(["INC-4471", "Alex Wilber"]);
        expect(rows[0][HEADERS.indexOf("Used minutes")]).toBe("19");
    });
});

describe("an assignment to a group", () => {
    it("keeps the group's name when names are replaced, in the column and the sentence", () => {
        const toGroup: AuditEvent = { ...EVENTS[0], sentence: "PIM-Helpdesk made eligible for Security Administrator", target: { name: "PIM-Helpdesk", id: "g-2" }, targetIsGroup: true };
        const text = content({ ...INPUT, events: [toGroup] }, { format: "csv", replaceNames: true });
        expect(text).toContain("PIM-Helpdesk made eligible");
        expect(text).not.toContain("g-2");
    });
});

describe("a denied request", () => {
    const denied: AuditEvent = { ...EVENTS[0], result: "failure", denied: true, approver: "Alex Wilber", usedMinutes: undefined, endedBy: undefined, endedAt: undefined };

    it("says Denied and names the approver under Denied by, not Approved by", () => {
        const { rows } = csvLines({ ...INPUT, events: [denied] });
        expect(rows[0][HEADERS.indexOf("Result")]).toBe("Denied");
        expect(rows[0][HEADERS.indexOf("Denied by")]).toBe("Alex Wilber");
        expect(rows[0][HEADERS.indexOf("Approved by")]).toBe("");
    });

    it("replaces the approver's name when names are replaced", () => {
        const plan = content({ ...INPUT, events: [denied] }, { format: "csv", replaceNames: true });
        expect(plan).not.toContain("Alex Wilber");
        expect(plan).toMatch(/,Denied,/);
        expect(plan).toMatch(/User \d/);
    });
});

describe("CSV cells", () => {
    it("defuses a reason or new value that starts with = + - or @", () => {
        const events = EVENTS.map((event, index) => ({ ...event, reason: ["=cmd|' /C calc'!A0", "+1 call", "@SUM(1)"][index], newValue: index === 0 ? "-2+3" : event.newValue }));
        const text = content({ ...INPUT, events }, CSV);
        for (const line of text.split("\r\n").slice(8)) {
            for (const cell of line.split(",")) expect(cell).not.toMatch(/^[=+\-@]/);
        }
        expect(text).toContain("'=cmd");
        expect(text).toContain("'+1 call");
        expect(text).toContain("'@SUM(1)");
        expect(text).toContain("'-2+3");
        expect(text).toContain("'=HYPERLINK");
    });

    it("quotes a cell with a comma or a line break", () => {
        const events = [{ ...EVENTS[0], reason: "Line one,\nline two" }];
        expect(content({ ...INPUT, events }, CSV)).toContain('"Line one,\nline two"');
    });
});

describe("heading", () => {
    it("states tenant, period, source, oldest event, read time, export time, exporter, filters and what was not read in the CSV", () => {
        const { heading } = csvLines(INPUT);
        expect(heading.join("\n")).toContain("# Tenant: Contoso Ltd (3f2a91c4-7d1e-4b6a-9e0f-5c8d2a1b7e63)");
        expect(heading.join("\n")).toContain("# Period (UTC): 2026-10-06T11:58:00.000Z to 2026-11-05T11:58:00.000Z");
        expect(heading.join("\n")).toContain("# Source: Entra audit log. Oldest event available: 2026-10-06");
        expect(heading.join("\n")).toContain("# Read (UTC): 2026-11-05T11:58:00.000Z");
        expect(heading.join("\n")).toContain("# Exported (UTC): 2026-11-05T12:05:00.000Z by Alex Wilber (alexw@contoso.com)");
        expect(heading.join("\n")).toContain("# Filters: System events off");
        expect(heading.join("\n")).toContain("# Not read: Nothing. Events from the last few minutes can be missing.");
    });

    it("states the same facts in the JSON meta object, with schemaVersion 1", () => {
        const { meta } = JSON.parse(content(INPUT, JSON_)) as { meta: Record<string, unknown> };
        expect(meta).toMatchObject({
            schemaVersion: 1,
            tenant: { id: "3f2a91c4-7d1e-4b6a-9e0f-5c8d2a1b7e63", name: "Contoso Ltd" },
            period: { from: "2026-10-06T11:58:00.000Z", to: "2026-11-05T11:58:00.000Z" },
            source: "Entra audit log",
            oldestEventAvailable: "2026-10-06",
            readAt: "2026-11-05T11:58:00.000Z",
            exportedAt: "2026-11-05T12:05:00.000Z",
            exportedBy: "Alex Wilber (alexw@contoso.com)",
            filters: "System events off",
            notRead: "Nothing",
            eventCount: 3,
        });
    });

    it("writes none without a filter, adds the search words, and takes what the workspace could not read", () => {
        expect(csvLines({ ...INPUT, filterSentence: "" }).heading.join("\n")).toContain("# Filters: none");
        expect(csvLines({ ...INPUT, filterSentence: "Failed only", searchTerm: "megan" }).heading.join("\n")).toContain('"# Filters: Failed only, Search ""megan"""');
        expect(csvLines({ ...INPUT, notRead: "Workspace Contoso-Logs" }).heading.join("\n")).toContain("# Not read: Workspace Contoso-Logs.");
    });

    it("describes filters, selection and scope", () => {
        expect(describeAuditFilter({ kinds: ["usage", "assignment", "setting", "outside"], env: "both", failed: false })).toBe("System events off");
        expect(describeAuditFilter({ kinds: ["usage", "assignment", "setting", "outside", "system"], env: "both", failed: false })).toBe("");
        expect(describeAuditFilter({ kinds: ["usage", "setting", "outside", "system"], env: "group", failed: true }, { from: Date.UTC(2026, 9, 28), to: Date.UTC(2026, 10, 2) }))
            .toBe("Assignments off, PIM for Groups only, Failed or denied, Selection 2026-10-28 00:00 UTC to 2026-11-02 00:00 UTC");
        expect(describeAuditFilter({ kinds: ["usage", "assignment", "setting", "outside", "system"], env: "role", failed: false, who: "group", privileged: true }))
            .toBe("Entra roles only, Groups only, Privileged only");
        expect(describeAuditFilter({ kinds: ["usage", "assignment", "setting", "outside", "system"], env: "both", failed: false, privileged: true }, undefined, 2))
            .toBe("Privileged only (2 kept: role could not be judged)");
        expect(describeAuditScope(1, INPUT.period)).toBe("1 action, 2026-10-06 to 2026-11-05, with the current filters.");
        expect(describeAuditScope(12, INPUT.period)).toBe("12 actions, 2026-10-06 to 2026-11-05, with the current filters.");
    });
});

describe("file names", () => {
    it("follows the Report: pim-audit, the tenant slug and the day", () => {
        expect(auditExportStem("Contoso Ltd", new Date("2026-11-05T23:59:00Z"))).toBe("pim-audit-contoso-ltd-2026-11-05");
        expect(auditExportStem(undefined, new Date("2026-11-05T01:00:00Z"))).toBe("pim-audit-tenant-2026-11-05");
        expect(planAuditExport(INPUT, CSV).fileName).toBe("pim-audit-contoso-ltd-2026-11-05.csv");
        expect(planAuditExport(INPUT, JSON_).fileName).toBe("pim-audit-contoso-ltd-2026-11-05.json");
        expect(planAuditExport(INPUT, PDF).fileName).toBe("pim-audit-contoso-ltd-2026-11-05.pdf");
        // With replaced names the tenant is still named
        expect(planAuditExport(INPUT, { ...CSV, replaceNames: true }).fileName).toBe("pim-audit-contoso-ltd-2026-11-05.csv");
    });
});

describe("nothing beyond the model", () => {
    it("holds no ipaddr, user agent, oid, tid, wids or acct in a serialised export", () => {
        for (const choice of [CSV, JSON_, PDF]) {
            const text = content(INPUT, choice).toLowerCase();
            for (const word of ["ipaddr", "user agent", "useragent", "\"oid\"", "\"tid\"", "wids", "acct"]) expect(text).not.toContain(word);
        }
    });
});

describe("PDF data", () => {
    it("holds the block, four totals, the actions and the closing note literally", () => {
        const file = planAuditExport(INPUT, PDF);
        if (file.format !== "pdf") throw new Error("pdf expected");
        const { pdf } = file;
        expect(pdf.title).toBe("Audit report");
        expect(pdf.subtitle).toBe("Activations and changes in Entra roles and PIM for Groups, for tenant Contoso Ltd.");
        expect(pdf.meta.map((item) => item.label)).toEqual(["Tenant", "Period", "Source", "Read", "Exported", "Filters", "Not read"]);
        expect(pdf.meta.find((item) => item.label === "Period")?.value).toBe("2026-10-06 11:58 UTC to 2026-11-05 11:58 UTC");
        expect(pdf.meta.find((item) => item.label === "Exported")?.value).toBe("2026-11-05 12:05 UTC by Alex Wilber (alexw@contoso.com)");
        expect(pdf.totals).toEqual([
            { label: "Activations", value: 1, note: "" },
            { label: "Assignments", value: 0, note: "" },
            { label: "Settings", value: 1, note: "" },
            { label: "Outside PIM", value: 1, note: "Without a request or approval" },
        ]);
        expect(pdf.rows.map((row) => row.time)).toEqual(["2026-11-04 08:42", "2026-11-03 15:05", "2026-10-30 13:31"]);
        expect(pdf.rows[0]).toMatchObject({ by: "Megan Bowen", reasonAndTicket: "Investigate sign-in alert for Grady Archie. INC-4471", result: "Succeeded. Approved by Alex Wilber. Used for 19 min of 1 hour" });
        expect(pdf.rows[2]).toMatchObject({ by: "Break Glass 01 (emergency access)", result: "Failed: RoleAssignmentExists" });
        expect(pdf.closingNote).toBe(AUDIT_PDF_CLOSING_NOTE);
        expect(pdf.closingNote).toBe("This report shows what the Microsoft log held when it was read. PIM Manager does not store the log and cannot prove it was not changed afterwards. Activation shows that a role was switched on, not what it was used for.");
    });
});

describe("replace names", () => {
    const REPLACED: AuditExportInput = { ...INPUT, searchTerm: "Megan", filterSentence: "System events off" };
    const choices: AuditExportChoice[] = [
        { format: "csv", replaceNames: true },
        { format: "json", replaceNames: true },
        { format: "pdf", replaceNames: true },
    ];

    it("does not call a request without a completion a success", () => {
        const input = { ...INPUT, events: [{ ...EVENTS[0], requestOnly: true }] };
        const csv = JSON.stringify(planAuditExport(input, { format: "csv", replaceNames: false }));
        expect(csv).toContain("Requested");
        expect(csv).not.toContain("Succeeded");
        expect(JSON.stringify(planAuditExport(input, { format: "pdf", replaceNames: false }))).toContain("Requested; no completion in the log");
    });

    it("drops a failure reason without spaces that is no code, such as an address, when names are replaced", () => {
        const event: AuditEvent = { ...EVENTS[0], result: "failure", failureReason: "adele@contoso.example" };
        const text = content({ ...INPUT, events: [event] }, { format: "csv", replaceNames: true });
        expect(text).not.toContain("adele@contoso.example");
    });

    it("keeps a failure code but drops a failure reason in free text when names are replaced", () => {
        const failed = (id: string, failureReason: string): AuditEvent => ({ ...EVENTS[0], id, result: "failure", failureReason });
        const input = { ...INPUT, events: [failed("a", "RoleAssignmentExists"), failed("b", "Patch run for Lynne")] };
        for (const format of ["csv", "json", "pdf"] as const) {
            const out = JSON.stringify(planAuditExport(input, { format, replaceNames: true }));
            expect(out).toContain("RoleAssignmentExists");
            expect(out).not.toContain("Lynne");
        }
        expect(JSON.stringify(planAuditExport(input, { format: "csv", replaceNames: false }))).toContain("Lynne");
    });

    it("leaves no input name, UPN or person id in any format, also where a reason holds a name", () => {
        const forbidden = [MEGAN.name, ALEX.name, GRADY.name, BREAK_GLASS.name, "alexw@contoso.com", MEGAN.id, ALEX.id, GRADY.id, BREAK_GLASS.id, "Investigate sign-in alert"];
        for (const choice of choices) {
            const text = content(REPLACED, choice);
            for (const word of forbidden) expect(text, `${choice.format} holds ${word}`).not.toContain(word);
            expect(text.toLowerCase()).not.toContain("megan");
        }
    });

    it("gives the same person the same number across actor, target, ended by, approver and the sentence", () => {
        const text = content(REPLACED, choices[1]);
        const parsed = JSON.parse(text) as { events: Record<string, string>[] };
        const [first, , third] = parsed.events;
        expect(first.By).toBe("User 1");
        expect(first.Action).toBe("User 1 activated Security Administrator");
        // Alex Wilber: ended by and approver of the first event
        expect(first["Ended by"]).toBe(first["Approved by"]);
        expect(first["Ended by"]).not.toBe(first.By);
        const grady = third.Target;
        expect(third.Action).toContain(`${grady} added to`);
        expect(new Set([first.By, first["Ended by"], grady, third.By]).size).toBe(4);
    });

    it("leaves out the ids of people, Reason, New value and Ticket, and the exporter and the search words", () => {
        const { header } = csvLines(REPLACED, choices[0]);
        for (const left of ["By id", "Target id", "Reason", "Ticket", "New value"]) expect(header).not.toContain(left);
        expect(header).toContain("Role id");
        expect(header).toContain("Event id");
        const parsed = JSON.parse(content(REPLACED, choices[1])) as { meta: Record<string, unknown>; events: Record<string, unknown>[] };
        expect("exportedBy" in parsed.meta).toBe(false);
        expect(parsed.meta.filters).toBe("System events off");
        expect(JSON.stringify(parsed)).not.toContain("INC-4471");
        expect(content(REPLACED, choices[0])).not.toContain("alexw");
        const file = planAuditExport(REPLACED, choices[2]);
        if (file.format !== "pdf") throw new Error("pdf expected");
        expect(file.pdf.meta.find((item) => item.label === "Exported")?.value).toBe("2026-11-05 12:05 UTC");
        expect(file.pdf.rows[0].reasonAndTicket).toBe("");
    });

    it("keeps role and group names and the tenant name", () => {
        const text = content(REPLACED, choices[0]);
        expect(text).toContain("Security Administrator");
        expect(text).toContain("Contoso Ltd");
    });

    it("keeps a system actor's name", () => {
        const system: AuditEvent = { ...EVENTS[0], id: "sys", actor: { name: "Azure AD PIM", id: "", kind: "system" }, sentence: "Activation of Security Administrator ended", reason: undefined, approver: undefined, endedBy: undefined };
        const text = content({ ...REPLACED, events: [system] }, choices[0]);
        expect(text).toContain("Azure AD PIM");
    });
});

describe("remembered choice", () => {
    it("reads only a known format and a boolean", () => {
        expect(parseStoredAuditExportChoice(null)).toEqual({ format: "csv", replaceNames: false });
        expect(parseStoredAuditExportChoice('{"format":"pdf","replaceNames":true}')).toEqual({ format: "pdf", replaceNames: true });
        expect(parseStoredAuditExportChoice('{"format":"xml","replaceNames":"yes","tenant":"x"}')).toEqual({ format: "csv", replaceNames: false });
        expect(parseStoredAuditExportChoice("not json")).toEqual({ format: "csv", replaceNames: false });
        expect(parseStoredAuditExportChoice("[1]")).toEqual({ format: "csv", replaceNames: false });
    });
});

describe("Azure export", () => {
    const SUBSCRIPTION = "/subscriptions/00000000-0000-4000-8000-0000000000b1";
    const AZURE_EVENT: AuditEvent = {
        id: "az-1",
        time: "2026-11-04T10:00:00Z",
        kind: "usage",
        environment: "role",
        sentence: "Megan Bowen activated Contributor on Contoso Production",
        actor: MEGAN,
        role: { name: "Contributor", id: "b24988ac-6180-42a0-ab88-20f7382dd24c" },
        scope: "Contoso Production",
        result: "success",
        reason: "Fix the failing deployment for Grady Archie",
        ticket: "INC-9001",
        approver: "Alex Wilber",
        viaGroup: "Contoso Cloud Admins",
        source: "arm",
        correlationId: "corr-az-1",
        azure: { scopeId: SUBSCRIPTION, scopeName: "Contoso Production", scopeLevel: "subscription", subscriptionId: "00000000-0000-4000-8000-0000000000b1" },
    };
    const AZURE: AuditExportInput = { ...INPUT, events: [AZURE_EVENT], source: "arm", sourceLabel: "Azure activity log and PIM requests" };
    const REPLACED: AuditExportChoice = { format: "csv", replaceNames: true };

    it("adds Scope level and Subscription, and reads Scope id from the Azure scope", () => {
        const { header, rows } = csvLines(AZURE);
        expect(header.slice(10, 14)).toEqual(["Scope", "Scope level", "Scope id", "Subscription"]);
        expect(rows[0].slice(10, 14)).toEqual(["Contoso Production", "Subscription", SUBSCRIPTION, "00000000-0000-4000-8000-0000000000b1"]);
        const json = JSON.parse(content(AZURE, JSON_)) as { events: Record<string, unknown>[]; meta: { source: string } };
        expect(json.events[0]).toMatchObject({ Scope: "Contoso Production", "Scope level": "Subscription", "Scope id": SUBSCRIPTION });
        expect(json.meta.source).toBe("Azure activity log and PIM requests");
    });

    it("leaves Entra files as they are", () => {
        const { header } = csvLines(INPUT);
        expect(header).toEqual(HEADERS);
        expect(header).not.toContain("Scope level");
        expect(header).not.toContain("Subscription");
    });

    it("leaves out object IDs, scope IDs and free text with names replaced", () => {
        const { header, rows } = csvLines(AZURE, REPLACED);
        for (const gone of ["By id", "Target id", "Scope id", "Subscription", "Reason", "Ticket", "New value"]) expect(header).not.toContain(gone);
        expect(header).toContain("Scope level");
        const text = JSON.stringify(rows) + content(AZURE, { format: "json", replaceNames: true });
        for (const word of [SUBSCRIPTION, "00000000-0000-4000-8000-0000000000b1", MEGAN.id, "INC-9001", "failing deployment"]) expect(text).not.toContain(word);
        expect(text).toContain("User 1");
        const pdf = planAuditExport(AZURE, { format: "pdf", replaceNames: true });
        if (pdf.format !== "pdf") throw new Error("pdf expected");
        expect(JSON.stringify(pdf.pdf)).not.toContain(SUBSCRIPTION);
        expect(pdf.pdf.rows[0].reasonAndTicket).toBe("");
    });

    it("draws the lines Scope, Approvers and Through, and a closing line in the third person", () => {
        const file = planAuditExport(AZURE, PDF);
        if (file.format !== "pdf") throw new Error("pdf expected");
        expect(file.pdf.subtitle).toBe("Activations and changes in Azure roles, for tenant Contoso Ltd.");
        expect(file.pdf.rows[0].action).toBe("Megan Bowen activated Contributor on Contoso Production\nScope: Contoso Production (Subscription)");
        expect(file.pdf.rows[0].by).toBe("Megan Bowen\nThrough: Contoso Cloud Admins");
        expect(file.pdf.rows[0].result).toBe("Succeeded\nApprovers: Alex Wilber");
        expect(file.pdf.meta.find((item) => item.label === "Source")?.value).toContain("Azure activity log and PIM requests");
        expect(file.pdf.closingNote).toBe(AZURE_PDF_CLOSING_NOTE);
        expect(file.pdf.closingNote).toContain("the exporter could read");
        expect(file.pdf.closingNote).not.toMatch(/\byou\b|\byour\b/i);
    });

    it("names the scope level and the scope bar in the filter sentence", () => {
        expect(describeAuditFilter({ kinds: ["usage", "assignment", "setting", "outside"], env: "both", failed: false, level: "resourceGroup" }, undefined, 0, 0, "Scope: Contoso Production (Subscription), Include inherited"))
            .toBe("System events off, Scope level: Resource group only, Scope: Contoso Production (Subscription), Include inherited");
        expect(describeAuditFilter({ kinds: ["usage", "assignment", "setting", "outside"], env: "both", failed: false })).toBe("System events off");
    });

    it("holds no field outside the allow list", () => {
        const forbidden = {
            ...AZURE_EVENT,
            httpRequest: { clientIpAddress: "203.0.113.7", method: "PUT" },
            authorization: { scope: "/secret-scope-marker", action: "secret-action-marker" },
            claims: { appid: "secret-claim-marker", ipaddr: "198.51.100.9" },
            ip: "192.0.2.44",
        } as unknown as AuditEvent;
        const input: AuditExportInput = { ...AZURE, events: [forbidden] };
        const texts = [
            content(input, CSV),
            content(input, JSON_),
            content(input, PDF),
            content(input, { format: "csv", replaceNames: true }),
        ].join("\n");
        for (const marker of ["203.0.113.7", "198.51.100.9", "192.0.2.44", "httpRequest", "clientIpAddress", "secret-scope-marker", "secret-action-marker", "secret-claim-marker", "appid", "authorization"]) expect(texts).not.toContain(marker);
    });
});
