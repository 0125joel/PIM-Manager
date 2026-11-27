import { describe, expect, it } from "vitest";
import type { AuditEvent } from "@/types/audit.types";
import { AUDIT_DEFAULT_KINDS, type AuditUrlState } from "@/utils/auditUrlState";
import {
    auditDetailNote,
    auditDetailRows,
    auditPointText,
    auditRowBy,
    auditUsedForShort,
    auditZoneLabel,
    buildCoverageLine,
    countByKind,
    countFailed,
    countInPeriod,
    filterAuditEvents,
    formatMinutes,
    groupByDay,
    isEmergencyEvent,
    oldestAvailable,
    periodLimitHint,
} from "@/utils/auditView";

// Invented data only: Contoso names, made-up ids and tickets.
const NOW = new Date("2026-11-05T12:00:00Z");
const FORMAT = { timeZone: "UTC", locale: "en-GB" } as const;
const STATE: AuditUrlState = { days: 30, kinds: [...AUDIT_DEFAULT_KINDS], env: "both", failed: false, q: "" };

function event(overrides: Partial<AuditEvent> & Pick<AuditEvent, "id" | "time">): AuditEvent {
    return {
        kind: "usage",
        environment: "role",
        sentence: "Megan Bowen activated Security Administrator",
        actor: { name: "Megan Bowen", id: "u-megan", kind: "person" },
        role: { name: "Security Administrator", id: "r-sec" },
        scope: "Contoso",
        result: "success",
        source: "graph",
        correlationId: `c-${overrides.id}`,
        ...overrides,
    };
}

const EVENTS: AuditEvent[] = [
    event({ id: "a", time: "2026-11-05T09:42:00Z", ticket: "INC-4471" }),
    event({ id: "b", time: "2026-11-04T16:05:00Z", kind: "setting", sentence: "Setting changed for Global Administrator", actor: { name: "Alex Wilber", id: "u-alex", kind: "person" }, role: { name: "Global Administrator", id: "r-ga" }, newValue: "Set to 4 hours." }),
    event({ id: "c", time: "2026-11-02T11:20:00Z", kind: "assignment", environment: "group", sentence: "Lidia Holloway made eligible for member of Contoso-Finance-Admins", actor: { name: "Alex Wilber", id: "u-alex", kind: "person" }, target: { name: "Lidia Holloway", id: "u-lidia" }, role: { name: "member of Contoso-Finance-Admins", id: "g-fin" } }),
    event({ id: "d", time: "2026-10-30T14:31:00Z", kind: "outside", sentence: "Grady Archie added to Exchange Administrator outside PIM", actor: { name: "Pradeep Gupta", id: "u-pradeep", kind: "person" }, target: { name: "Grady Archie", id: "u-grady" }, role: { name: "Exchange Administrator", id: "r-ex" } }),
    event({ id: "e", time: "2026-10-28T01:00:00Z", kind: "system", sentence: "Daily expiry of Helpdesk Administrator", actor: { name: "Azure AD PIM", id: "", kind: "system" }, role: { name: "Helpdesk Administrator", id: "r-hd" } }),
    event({ id: "f", time: "2026-11-03T08:14:00Z", result: "failure", failureReason: "MFA required", sentence: "Activation of Intune Administrator by Diego Siciliani failed", actor: { name: "Diego Siciliani", id: "u-diego", kind: "person" }, role: { name: "Intune Administrator", id: "r-in" } }),
    event({ id: "g", time: "2026-10-10T08:00:00Z" }),
];

const ids = (list: AuditEvent[]) => list.map((e) => e.id);

describe("filterAuditEvents", () => {
    it("shows the default kinds inside the period and hides System", () => {
        expect(ids(filterAuditEvents(EVENTS, STATE, NOW))).toEqual(["a", "b", "c", "d", "f", "g"]);
    });

    it("keeps the period in memory: 5 days drops the older events", () => {
        expect(ids(filterAuditEvents(EVENTS, { ...STATE, days: 5 }, NOW))).toEqual(["a", "b", "c", "f"]);
    });

    it("filters by kind, including System", () => {
        expect(ids(filterAuditEvents(EVENTS, { ...STATE, kinds: ["system"] }, NOW))).toEqual(["e"]);
        expect(ids(filterAuditEvents(EVENTS, { ...STATE, kinds: ["setting", "outside"] }, NOW))).toEqual(["b", "d"]);
    });

    it("filters by environment", () => {
        expect(ids(filterAuditEvents(EVENTS, { ...STATE, env: "group" }, NOW))).toEqual(["c"]);
        expect(ids(filterAuditEvents(EVENTS, { ...STATE, env: "role" }, NOW))).toEqual(["a", "b", "d", "f", "g"]);
    });

    it("filters failed only", () => {
        expect(ids(filterAuditEvents(EVENTS, { ...STATE, failed: true }, NOW))).toEqual(["f"]);
    });

    it("searches case-insensitively over sentence, actor, target, role and ticket", () => {
        const search = (q: string) => ids(filterAuditEvents(EVENTS, { ...STATE, kinds: [...STATE.kinds, "system"], q }, NOW));
        expect(search("MEGAN")).toEqual(["a", "g"]);
        expect(search("pradeep")).toEqual(["d"]);
        expect(search("lidia")).toEqual(["c"]);
        expect(search("exchange administrator")).toEqual(["d"]);
        expect(search("inc-4471")).toEqual(["a"]);
        expect(search("expiry")).toEqual(["e"]);
        expect(search("nobody")).toEqual([]);
        expect(search("  ")).toHaveLength(7);
    });

    it("searches the words Emergency access only for a marked account", () => {
        const breakGlass = event({ id: "bg", time: "2026-11-05T07:00:00Z", actor: { name: "Break Glass 01", id: "U-BG", kind: "person" } });
        const list = [...EVENTS, breakGlass];
        const marked = new Set(["u-bg"]);
        expect(ids(filterAuditEvents(list, { ...STATE, q: "emergency access" }, NOW, marked))).toEqual(["bg"]);
        expect(ids(filterAuditEvents(list, { ...STATE, q: "emergency access" }, NOW))).toEqual([]);
    });

    it("never throws on an event with a bad time and drops it", () => {
        const broken = event({ id: "x", time: "not a date" });
        expect(ids(filterAuditEvents([broken, ...EVENTS], STATE, NOW))).not.toContain("x");
    });
});

describe("countByKind and countFailed", () => {
    it("counts each kind under the other filters, so a chip shows what clicking it gives", () => {
        expect(countByKind(EVENTS, STATE, NOW)).toEqual({ usage: 3, assignment: 1, setting: 1, outside: 1, system: 1 });
        // System is off in the state but still counted: it is what turning the chip on would show
        expect(countByKind(EVENTS, { ...STATE, kinds: ["usage"] }, NOW).setting).toBe(1);
    });

    it("applies period, environment, failed and search to the counts", () => {
        expect(countByKind(EVENTS, { ...STATE, days: 5 }, NOW)).toEqual({ usage: 2, assignment: 1, setting: 1, outside: 0, system: 0 });
        expect(countByKind(EVENTS, { ...STATE, env: "group" }, NOW)).toEqual({ usage: 0, assignment: 1, setting: 0, outside: 0, system: 0 });
        expect(countByKind(EVENTS, { ...STATE, failed: true }, NOW)).toEqual({ usage: 1, assignment: 0, setting: 0, outside: 0, system: 0 });
        expect(countByKind(EVENTS, { ...STATE, q: "alex" }, NOW)).toEqual({ usage: 0, assignment: 1, setting: 1, outside: 0, system: 0 });
    });

    it("counts failed events under the kinds, not under the failed switch", () => {
        expect(countFailed(EVENTS, STATE, NOW)).toBe(1);
        expect(countFailed(EVENTS, { ...STATE, failed: true }, NOW)).toBe(1);
        expect(countFailed(EVENTS, { ...STATE, kinds: ["setting"] }, NOW)).toBe(0);
        expect(countFailed(EVENTS, { ...STATE, days: 1 }, NOW)).toBe(0);
        expect(countFailed(EVENTS, { ...STATE, env: "group" }, NOW)).toBe(0);
    });

    it("counts what lies in the period whatever the other filters say", () => {
        expect(countInPeriod(EVENTS, 30, NOW)).toBe(7);
        expect(countInPeriod(EVENTS, 5, NOW)).toBe(4);
        expect(countInPeriod([], 30, NOW)).toBe(0);
    });
});

describe("groupByDay", () => {
    it("groups newest day first and newest event first in a day", () => {
        const list = [
            event({ id: "1", time: "2026-11-05T09:00:00Z" }),
            event({ id: "2", time: "2026-11-05T10:00:00Z" }),
            event({ id: "3", time: "2026-11-03T23:30:00Z" }),
        ];
        const days = groupByDay(list, "UTC", "en-GB");
        expect(days.map((d) => d.key)).toEqual(["2026-11-05", "2026-11-03"]);
        expect(days.map((d) => d.label)).toEqual(["5 Nov 2026", "3 Nov 2026"]);
        expect(ids(days[0].events)).toEqual(["2", "1"]);
    });

    it("cuts the day in the zone that is shown", () => {
        const list = [event({ id: "1", time: "2026-11-05T23:30:00Z" }), event({ id: "2", time: "2026-11-05T22:30:00Z" })];
        expect(groupByDay(list, "UTC", "en-GB").map((d) => d.key)).toEqual(["2026-11-05"]);
        const tokyo = groupByDay(list, "Asia/Tokyo", "en-GB");
        expect(tokyo.map((d) => d.key)).toEqual(["2026-11-06"]);
        expect(ids(tokyo[0].events)).toEqual(["1", "2"]);
    });

    it("gives no days for no events and skips an invalid time", () => {
        expect(groupByDay([], "UTC")).toEqual([]);
        expect(groupByDay([event({ id: "x", time: "nonsense" })], "UTC")).toEqual([]);
    });

    it("does not change the list it is given", () => {
        const list = [event({ id: "1", time: "2026-11-01T09:00:00Z" }), event({ id: "2", time: "2026-11-02T09:00:00Z" })];
        groupByDay(list, "UTC");
        expect(ids(list)).toEqual(["1", "2"]);
    });
});

describe("formatMinutes", () => {
    it("writes minutes, hours and days", () => {
        expect(formatMinutes(0)).toBe("0 min");
        expect(formatMinutes(19)).toBe("19 min");
        expect(formatMinutes(60)).toBe("1 hour");
        expect(formatMinutes(120)).toBe("2 hours");
        expect(formatMinutes(72)).toBe("1 h 12 min");
        expect(formatMinutes(1440)).toBe("1 day");
        expect(formatMinutes(2880)).toBe("2 days");
    });

    it("gives nothing for a value that is not a length", () => {
        expect(formatMinutes(-1)).toBe("");
        expect(formatMinutes(Number.NaN)).toBe("");
    });
});

describe("row helpers", () => {
    it("names the actor unless the sentence does, or the row is System, or the actor has no name", () => {
        expect(auditRowBy(event({ id: "1", time: "2026-11-05T09:00:00Z" }))).toBeNull();
        expect(auditRowBy(EVENTS[1])).toBe("by Alex Wilber");
        expect(auditRowBy(EVENTS[4])).toBeNull();
        expect(auditRowBy(event({ id: "2", time: "2026-11-05T09:00:00Z", actor: { name: "", id: "", kind: "system" } }))).toBeNull();
    });

    it("tells how long a role was used only when the end is in the log", () => {
        expect(auditUsedForShort(event({ id: "1", time: "2026-11-05T09:00:00Z", usedMinutes: 19 }))).toBe("Used for 19 min");
        expect(auditUsedForShort(event({ id: "2", time: "2026-11-05T09:00:00Z" }))).toBeNull();
    });

    it("marks an event by or about an emergency access account", () => {
        const ids = new Set(["u-bg"]);
        expect(isEmergencyEvent(event({ id: "1", time: "2026-11-05T09:00:00Z", actor: { name: "Break Glass 01", id: "U-BG", kind: "person" } }), ids)).toBe(true);
        expect(isEmergencyEvent(event({ id: "2", time: "2026-11-05T09:00:00Z", target: { name: "Break Glass 01", id: "u-bg" } }), ids)).toBe(true);
        expect(isEmergencyEvent(event({ id: "3", time: "2026-11-05T09:00:00Z" }), ids)).toBe(false);
        expect(isEmergencyEvent(event({ id: "4", time: "2026-11-05T09:00:00Z", actor: { name: "", id: "", kind: "system" } }), new Set([""]))).toBe(false);
        expect(isEmergencyEvent(event({ id: "5", time: "2026-11-05T09:00:00Z" }), undefined)).toBe(false);
    });
});

describe("auditDetailRows", () => {
    const labels = (rows: { label: string }[]) => rows.map((r) => r.label);
    const value = (rows: { label: string; value: string }[], label: string) => rows.find((r) => r.label === label)?.value;

    it("gives the always rows of an activation", () => {
        const rows = auditDetailRows(EVENTS[0], false, false, FORMAT);
        expect(labels(rows)).toEqual(["What", "By", "Role", "When", "Result", "Through", "Reason", "Ticket", "Approved by", "Old value", "Ends", "Account", "New value"]);
        expect(value(rows, "What")).toBe("Activation");
        expect(value(rows, "When")).toBe("5 Nov 2026, 09:42 UTC");
        expect(value(rows, "Result")).toBe("Succeeded");
    });

    it("keeps a field without a value empty, never Unknown", () => {
        const bare = event({ id: "1", time: "2026-11-05T09:00:00Z", actor: { name: "", id: "", kind: "system" }, role: { name: "", id: "" }, scope: "" });
        const rows = auditDetailRows(bare, true, false, FORMAT);
        expect(rows.filter((row) => row.value !== "").map((row) => row.label)).toEqual(["What", "When", "Result", "Source"]);
        for (const row of rows) expect(row.value).not.toMatch(/unknown/i);
    });

    it("shows a failure with its reason, or alone", () => {
        expect(value(auditDetailRows(EVENTS[5], false, false, FORMAT), "Result")).toBe("Failed: MFA required");
        expect(value(auditDetailRows(event({ id: "1", time: "2026-11-05T09:00:00Z", result: "failure" }), false, false, FORMAT), "Result")).toBe("Failed");
    });

    it("shows New value and the old value that is not in the log for a setting", () => {
        const rows = auditDetailRows(EVENTS[1], false, false, FORMAT);
        expect(value(rows, "New value")).toBe("Set to 4 hours.");
        expect(value(rows, "Old value")).toBe("Not in the log");
        expect(value(rows, "Reason")).toBe("");
    });

    it("shows the reason of an assignment or activation, and approver and ticket when they are in the log", () => {
        const withAll = event({ id: "1", time: "2026-11-05T09:00:00Z", reason: "Investigate sign-in alert", ticket: "INC-4471", approver: "Alex Wilber" });
        const rows = auditDetailRows(withAll, false, false, FORMAT);
        expect(value(rows, "Reason")).toBe("Investigate sign-in alert");
        expect(value(rows, "Ticket")).toBe("INC-4471");
        expect(value(rows, "Approved by")).toBe("Alex Wilber");
        expect(value(rows, "New value")).toBe("");
    });

    it("marks an emergency access account", () => {
        expect(value(auditDetailRows(EVENTS[0], false, true, FORMAT), "Account")).toBe("Emergency access");
        expect(value(auditDetailRows(EVENTS[0], false, false, FORMAT), "Account")).toBe("");
    });

    it("keeps Used for, Requested duration, MFA, Where and Source behind the details", () => {
        const used = event({ id: "1", time: "2026-11-05T09:42:00Z", usedMinutes: 19, endedAt: "2026-11-05T10:01:00Z", endedBy: { name: "Megan Bowen", id: "u-megan", kind: "person" }, requestedDuration: 60, mfa: true });
        const calm = auditDetailRows(used, false, false, FORMAT);
        for (const label of ["Used for", "Starts", "Approved after", "Requested duration", "MFA on activation", "Where", "Source"]) expect(labels(calm)).not.toContain(label);
        const more = auditDetailRows(used, true, false, FORMAT);
        expect(value(more, "Used for")).toBe("19 min, ended by Megan Bowen at 10:01");
        expect(value(more, "Requested duration")).toBe("1 hour");
        expect(value(more, "MFA on activation")).toBe("Yes");
        expect(value(more, "Where")).toBe("Contoso");
        expect(value(more, "Source")).toBe("Entra audit log");
    });

    it("says expired when nobody ended it, and only the length when the end time is missing", () => {
        const expired = event({ id: "1", time: "2026-11-05T09:10:00Z", usedMinutes: 60, endedAt: "2026-11-05T10:10:00Z" });
        expect(value(auditDetailRows(expired, true, false, FORMAT), "Used for")).toBe("1 hour, expired at 10:10");
        const noEnd = event({ id: "2", time: "2026-11-05T09:10:00Z", usedMinutes: 47 });
        expect(value(auditDetailRows(noEnd, true, false, FORMAT), "Used for")).toBe("47 min");
        expect(value(auditDetailRows(event({ id: "3", time: "2026-11-05T09:10:00Z" }), true, false, FORMAT), "Used for")).toBe("");
    });

    it("shows MFA for an activation of a role only, and No when the log says so", () => {
        const group = event({ id: "1", time: "2026-11-05T09:10:00Z", environment: "group", mfa: true });
        expect(value(auditDetailRows(group, true, false, FORMAT), "MFA on activation")).toBe("");
        const assignment = event({ id: "2", time: "2026-11-05T09:10:00Z", kind: "assignment", mfa: true });
        expect(value(auditDetailRows(assignment, true, false, FORMAT), "MFA on activation")).toBe("");
        const no = event({ id: "3", time: "2026-11-05T09:10:00Z", mfa: false });
        expect(value(auditDetailRows(no, true, false, FORMAT), "MFA on activation")).toBe("No");
    });

    it("names a workspace as the source of a workspace event", () => {
        const fromWorkspace = event({ id: "1", time: "2026-11-05T09:10:00Z", source: "workspace" });
        expect(value(auditDetailRows(fromWorkspace, true, false, FORMAT), "Source")).toBe("Log Analytics workspace");
    });
});

describe("auditDetailNote", () => {
    it("explains a setting and a change outside PIM, with or without details", () => {
        expect(auditDetailNote(EVENTS[1], false)).toBe("Microsoft logs only the new value of a setting, in its own words.");
        expect(auditDetailNote(EVENTS[3], true)).toBe("This did not go through PIM, so there is no request, reason or approval.");
    });

    it("says that requested and completed are one action only with details", () => {
        expect(auditDetailNote(EVENTS[0], true)).toBe("Requested and completed are shown as one action.");
        expect(auditDetailNote(EVENTS[0], false)).toBeNull();
    });
});

describe("the coverage line", () => {
    it("takes the later of the window start and today minus the days", () => {
        const start = "2026-10-06T11:58:00Z";
        expect(oldestAvailable(start, 30, NOW).toISOString()).toBe("2026-10-06T12:00:00.000Z");
        expect(oldestAvailable(start, 7, NOW).toISOString()).toBe("2026-10-29T12:00:00.000Z");
        // A shorter read (7 days) shown for 30 days: the window start is the later one
        expect(oldestAvailable("2026-10-29T11:58:00Z", 30, NOW).toISOString()).toBe("2026-10-29T11:58:00.000Z");
        expect(oldestAvailable(null, 30, NOW).toISOString()).toBe("2026-10-06T12:00:00.000Z");
        expect(oldestAvailable("garbage", 7, NOW).toISOString()).toBe("2026-10-29T12:00:00.000Z");
    });

    it("builds the sentence of the canvas", () => {
        const line = buildCoverageLine({ windowStart: "2026-10-06T11:58:00Z", readAt: "2026-11-05T11:58:00Z", days: 30, now: NOW, ...FORMAT });
        expect(line).toBe("Source: Entra audit log. Oldest event available: 6 Oct 2026. Read 11:58. Times in UTC. New events can take a few minutes to appear.");
    });

    it("moves the oldest date with the period", () => {
        const line = buildCoverageLine({ windowStart: "2026-10-06T11:58:00Z", readAt: "2026-11-05T11:58:00Z", days: 7, now: NOW, ...FORMAT });
        expect(line).toContain("Oldest event available: 29 Oct 2026.");
    });

    it("names the zone of a moment", () => {
        expect(auditZoneLabel("2026-11-05T11:58:00Z", FORMAT)).toBe("UTC");
        expect(auditZoneLabel("nonsense", FORMAT)).toBe("");
    });
});

describe("the selection of the timeline in the filters", () => {
    const events = [
        event({ id: "a", time: "2026-11-01T08:00:00Z" }),
        event({ id: "b", time: "2026-11-02T08:00:00Z", result: "failure" }),
        event({ id: "c", time: "2026-11-03T08:00:00Z", kind: "setting" }),
        event({ id: "d", time: "2026-11-04T08:00:00Z" }),
    ];
    const range = { from: Date.parse("2026-11-02T08:00:00Z"), to: Date.parse("2026-11-03T08:00:00Z") };

    it("keeps only the events inside the selection, the ends included", () => {
        expect(filterAuditEvents(events, STATE, NOW, undefined, range).map((e) => e.id)).toEqual(["b", "c"]);
        expect(filterAuditEvents(events, STATE, NOW).map((e) => e.id)).toEqual(["a", "b", "c", "d"]);
    });

    it("counts the kinds and the failures inside the selection", () => {
        expect(countByKind(events, STATE, NOW, undefined, range)).toMatchObject({ usage: 1, setting: 1 });
        expect(countByKind(events, STATE, NOW)).toMatchObject({ usage: 3, setting: 1 });
        expect(countFailed(events, STATE, NOW, undefined, range)).toBe(1);
        expect(countFailed(events, STATE, NOW, undefined, { from: range.to, to: range.to + 1000 })).toBe(0);
    });
});

describe("the fields of the detail", () => {
    const base = { id: "e", time: "2026-11-05T10:00:00Z", environment: "role", sentence: "s", actor: { name: "Megan Bowen", id: "u", kind: "person" }, role: { name: "Reports Reader", id: "r" }, scope: "", result: "success", source: "graph", correlationId: "c" } as const;
    const of = (kind: "usage" | "assignment" | "setting" | "outside" | "system", extra = {}, isDetailed = false) => auditDetailRows({ ...base, kind, ...extra }, isDetailed, false);
    const ALWAYS = ["What", "By", "Role", "When", "Result", "Through", "Reason", "Ticket", "Approved by", "Old value", "Ends", "Account", "New value"];
    const DETAILED = ["Used for", "Starts", "Approved after", "Requested duration", "MFA on activation", "Where", "Source"];
    const KINDS = ["usage", "assignment", "setting", "outside", "system"] as const;

    it("are the same fields in the same order for every kind, with and without details", () => {
        for (const kind of KINDS) {
            expect(of(kind).map((r) => r.label)).toEqual(ALWAYS);
            expect(of(kind, {}, true).map((r) => r.label)).toEqual([...ALWAYS.slice(0, -1), ...DETAILED, "New value"]);
        }
    });

    it("show a later start and the wait for a decision, under the right word (AU-17)", () => {
        const rows = of("usage", { startsAt: "2026-11-12T19:22:50Z", decidedAfterMinutes: 11 }, true);
        expect(rows.find((r) => r.label === "Starts")?.value).not.toBe("");
        expect(rows.find((r) => r.label === "Approved after")?.value).toBe(formatMinutes(11));
        const denied = of("usage", { denied: true, result: "failure", decidedAfterMinutes: 2 }, true);
        expect(denied.find((r) => r.label === "Denied after")?.value).toBe(formatMinutes(2));
    });

    it("stay empty without a value, never None or Unknown", () => {
        const rows = of("usage");
        expect(rows.find((r) => r.label === "Reason")?.value).toBe("");
        expect(rows.find((r) => r.label === "Ticket")?.value).toBe("");
        expect(rows.find((r) => r.label === "Old value")?.value).toBe("");
    });

    it("hold the value there is, and the approver of a denial under Denied by", () => {
        const rows = of("usage", { reason: "Monthly check", ticket: "INC-1 (TEST)" });
        expect(rows.find((r) => r.label === "Reason")?.value).toBe("Monthly check");
        expect(rows.find((r) => r.label === "Ticket")?.value).toBe("INC-1 (TEST)");
        const denied = of("usage", { denied: true, result: "failure", approver: "Alex Wilber" });
        expect(denied.find((r) => r.label === "Denied by")?.value).toBe("Alex Wilber");
        expect(denied.find((r) => r.label === "Approved by")).toBeUndefined();
        expect(of("setting", { newValue: "x" }).find((r) => r.label === "Old value")?.value).toBe("Not in the log");
    });
});

describe("periodLimitHint", () => {
    it("names the missing workspace when none is read", () => {
        expect(periodLimitHint(false, 30, 30)).toBe("The longest period without a workspace");
    });

    it("credits the workspaces when they keep longer than the own log", () => {
        expect(periodLimitHint(true, 365, 90)).toBe("The longest your workspaces keep their logs");
    });

    it("leaves the limit with the own log when the workspaces keep no more", () => {
        expect(periodLimitHint(true, 90, 90)).toBe("The longest the audit log keeps");
        expect(periodLimitHint(true, 30, 30)).toBe("The longest the audit log keeps");
    });
});

describe("auditPointText", () => {
    it("tells a success by its kind only", () => {
        expect(auditPointText({ kind: "usage", isFailed: false, isDenied: false }, false)).toEqual({ kind: "Activation", marks: [] });
    });

    it("tells a failure as Failed with the ring", () => {
        const text = auditPointText({ kind: "usage", isFailed: true, isDenied: false }, false);
        expect(text.result).toBe("Failed");
        expect(text.marks).toEqual(["Dashed red ring: failed or denied."]);
    });

    it("tells a denied request as Denied, never Failed", () => {
        const text = auditPointText({ kind: "assignment", isFailed: true, isDenied: true }, false);
        expect(text).toMatchObject({ kind: "Assignment", result: "Denied" });
    });

    it("adds a line about the outline of the shown event", () => {
        const text = auditPointText({ kind: "usage", isFailed: false, isDenied: false }, true);
        expect(text.marks).toHaveLength(1);
        expect(text.marks[0]).toContain("Outline");
    });
});
