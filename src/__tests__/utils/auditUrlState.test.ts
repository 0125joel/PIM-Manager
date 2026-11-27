import { describe, expect, it } from "vitest";
import { AUDIT_DEFAULT_KINDS, buildAuditSearch, normalizeKinds, parseAuditUrlState, type AuditUrlState } from "@/utils/auditUrlState";

const DEFAULTS: AuditUrlState = { days: 30, kinds: [...AUDIT_DEFAULT_KINDS], env: "both", failed: false, q: "" };

describe("parseAuditUrlState", () => {
    it("gives the defaults for an empty URL", () => {
        expect(parseAuditUrlState("")).toEqual(DEFAULTS);
        expect(parseAuditUrlState("?")).toEqual(DEFAULTS);
    });

    it("reads every parameter", () => {
        const state = parseAuditUrlState("?days=7&kinds=system,usage&env=group&failed=1&q=megan&event=ev-1");
        expect(state).toEqual({ days: 7, kinds: ["usage", "system"], env: "group", failed: true, q: "megan", event: "ev-1" });
    });

    it("falls back to 30 days for rubbish, 0 and more than 30", () => {
        for (const value of ["abc", "", "-3", "0", "31", "1.5", "7days", "1e1", "99999"]) {
            expect(parseAuditUrlState(`days=${value}`).days, value).toBe(30);
        }
        expect(parseAuditUrlState("days=1").days).toBe(1);
        expect(parseAuditUrlState("days=30").days).toBe(30);
    });

    it("keeps the known kinds, in the order of the chips and without duplicates", () => {
        expect(parseAuditUrlState("kinds=outside,usage,usage,bogus").kinds).toEqual(["usage", "outside"]);
    });

    it("falls back to the default kinds when none is known", () => {
        expect(parseAuditUrlState("kinds=").kinds).toEqual([...AUDIT_DEFAULT_KINDS]);
        expect(parseAuditUrlState("kinds=bogus,other").kinds).toEqual([...AUDIT_DEFAULT_KINDS]);
    });

    it("reads env as role, group or both", () => {
        expect(parseAuditUrlState("env=role").env).toBe("role");
        expect(parseAuditUrlState("env=group").env).toBe("group");
        expect(parseAuditUrlState("env=both").env).toBe("both");
        expect(parseAuditUrlState("env=azure").env).toBe("both");
    });

    it("reads failed only as 1", () => {
        expect(parseAuditUrlState("failed=1").failed).toBe(true);
        for (const value of ["0", "true", "yes", ""]) expect(parseAuditUrlState(`failed=${value}`).failed, value).toBe(false);
    });

    it("leaves out an empty event", () => {
        expect(parseAuditUrlState("event=").event).toBeUndefined();
        expect(parseAuditUrlState("event=%20").event).toBeUndefined();
    });

    it("does not throw on malformed input", () => {
        expect(() => parseAuditUrlState("%E0%A4%A&days=%&kinds=%%&q=%")).not.toThrow();
    });
});

describe("buildAuditSearch", () => {
    it("writes nothing for the defaults", () => {
        expect(buildAuditSearch(DEFAULTS)).toBe("");
    });

    it("does not write 30 days, writes a shorter period", () => {
        expect(buildAuditSearch({ ...DEFAULTS, days: 30 })).toBe("");
        expect(buildAuditSearch({ ...DEFAULTS, days: 7 })).toBe("days=7");
    });

    it("writes kinds only when they differ from the default set", () => {
        expect(buildAuditSearch({ ...DEFAULTS, kinds: ["outside", "setting", "assignment", "usage"] })).toBe("");
        expect(buildAuditSearch({ ...DEFAULTS, kinds: ["usage", "system"] })).toBe("kinds=usage%2Csystem");
        expect(buildAuditSearch({ ...DEFAULTS, kinds: ["system", "usage", "assignment", "setting", "outside"] })).toBe("kinds=usage%2Cassignment%2Csetting%2Coutside%2Csystem");
    });

    it("writes env, failed, q and event", () => {
        expect(buildAuditSearch({ ...DEFAULTS, env: "role", failed: true, q: "megan", event: "ev-1" })).toBe("env=role&failed=1&q=megan&event=ev-1");
    });

    it("does not write a blank search or an empty kinds list", () => {
        expect(buildAuditSearch({ ...DEFAULTS, q: "   " })).toBe("");
        expect(buildAuditSearch({ ...DEFAULTS, kinds: [] })).toBe("");
    });

    it("leaves other parameters alone, and takes from and to (the selection, own parameters since AU-4) from the state", () => {
        const search = buildAuditSearch({ ...DEFAULTS, days: 7 }, "?from=2026-10-30T00:00:00Z&to=2026-11-02T00:00:00Z&days=14&other=1");
        const params = new URLSearchParams(search);
        expect(params.get("from")).toBeNull();
        expect(params.get("to")).toBeNull();
        expect(params.get("other")).toBe("1");
        expect(params.get("days")).toBe("7");
        const kept = new URLSearchParams(buildAuditSearch({ ...DEFAULTS, from: "2026-10-30T00:00:00.000Z", to: "2026-11-02T00:00:00.000Z" }, "other=1"));
        expect(kept.get("from")).toBe("2026-10-30T00:00:00.000Z");
        expect(kept.get("other")).toBe("1");
    });

    it("removes its own parameters that are back at the default", () => {
        expect(buildAuditSearch(DEFAULTS, "days=7&kinds=system&env=role&failed=1&q=x&event=e&keep=1")).toBe("keep=1");
    });

    it("round-trips every state", () => {
        const states: AuditUrlState[] = [
            DEFAULTS,
            { days: 1, kinds: ["usage"], env: "group", failed: true, q: "a b&c", event: "id/1" },
            { days: 12, kinds: ["setting", "system"], env: "role", failed: false, q: "x", event: undefined },
        ];
        for (const state of states) {
            const parsed = parseAuditUrlState(buildAuditSearch(state));
            expect(parsed.days).toBe(state.days);
            expect(parsed.kinds).toEqual(normalizeKinds(state.kinds));
            expect(parsed.env).toBe(state.env);
            expect(parsed.failed).toBe(state.failed);
            expect(parsed.q).toBe(state.q);
            expect(parsed.event).toBe(state.event);
        }
    });
});

describe("the selection of the timeline (from and to)", () => {
    const FROM = "2026-11-01T00:00:00.000Z";
    const TO = "2026-11-03T12:00:00.000Z";

    it("reads from and to as ISO times", () => {
        const state = parseAuditUrlState(`from=${FROM}&to=${TO}`);
        expect(state.from).toBe(FROM);
        expect(state.to).toBe(TO);
    });

    it("has no selection without both, for rubbish, or when from is not before to", () => {
        for (const search of [`from=${FROM}`, `to=${TO}`, `from=rubbish&to=${TO}`, `from=${FROM}&to=rubbish`, `from=${TO}&to=${FROM}`, `from=${FROM}&to=${FROM}`, "from=&to="]) {
            const state = parseAuditUrlState(search);
            expect(state.from, search).toBeUndefined();
            expect(state.to, search).toBeUndefined();
        }
    });

    it("writes from and to only when something is selected, and keeps other parameters", () => {
        expect(buildAuditSearch({ ...DEFAULTS })).toBe("");
        expect(buildAuditSearch({ ...DEFAULTS, from: FROM, to: TO })).toBe(`from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}`);
        expect(buildAuditSearch({ ...DEFAULTS, from: FROM })).toBe("");
        expect(buildAuditSearch({ ...DEFAULTS }, `from=${FROM}&to=${TO}&utm=1`)).toBe("utm=1");
    });

    it("round-trips through the URL", () => {
        const state: AuditUrlState = { ...DEFAULTS, days: 7, from: FROM, to: TO, event: "ev-1" };
        expect(parseAuditUrlState(buildAuditSearch(state))).toEqual(state);
    });
});

describe("the view parameter", () => {
    it("reads view=idle and leaves Events (the default) unset", () => {
        expect(parseAuditUrlState("view=idle").view).toBe("idle");
        expect(parseAuditUrlState("").view).toBeUndefined();
        for (const value of ["events", "IDLE", "", "x"]) expect(parseAuditUrlState(`view=${value}`).view, value).toBeUndefined();
    });

    it("writes view=idle only for that view and keeps event, from and to", () => {
        const state = { ...DEFAULTS, view: "idle" as const, event: "ev-1", from: "2026-10-28T00:00:00.000Z", to: "2026-11-02T00:00:00.000Z" };
        const search = buildAuditSearch(state);
        expect(search).toContain("view=idle");
        expect(parseAuditUrlState(search)).toEqual(state);
        expect(buildAuditSearch(DEFAULTS)).toBe("");
    });
});
