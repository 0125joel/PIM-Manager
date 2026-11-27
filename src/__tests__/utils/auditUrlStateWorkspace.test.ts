import { describe, expect, it } from "vitest";
import { AUDIT_DEFAULT_KINDS, buildAuditSearch, parseAuditUrlState, type AuditUrlState } from "@/utils/auditUrlState";

const DEFAULTS: AuditUrlState = { days: 30, kinds: [...AUDIT_DEFAULT_KINDS], env: "both", failed: false, q: "" };

describe("the period of the URL with workspaces", () => {
    it("allows a period up to the longest retention, and falls back to the default above it", () => {
        expect(parseAuditUrlState("days=180", 180).days).toBe(180);
        expect(parseAuditUrlState("days=181", 180).days).toBe(180);
        expect(parseAuditUrlState("days=730", 730).days).toBe(730);
        expect(parseAuditUrlState("days=99999", 730).days).toBe(180);
    });

    it("without a workspace 30 stays the longest", () => {
        expect(parseAuditUrlState("days=31").days).toBe(30);
        expect(parseAuditUrlState("days=31", 30).days).toBe(30);
    });

    it("writes a longer period, and still not 30", () => {
        expect(buildAuditSearch({ ...DEFAULTS, days: 180 })).toBe("days=180");
        expect(buildAuditSearch({ ...DEFAULTS, days: 30 })).toBe("");
    });
});

describe("the period a workspace opens on", () => {
    it("opens on 180 days with a workspace, on what it keeps when that is less, and on 30 without one", () => {
        expect(parseAuditUrlState("", 730).days).toBe(180);
        expect(parseAuditUrlState("", 90).days).toBe(90);
        expect(parseAuditUrlState("", 30).days).toBe(30);
    });

    it("writes 30 days with a workspace, so a chosen period survives, and leaves out the default", () => {
        const base = parseAuditUrlState("", 730);
        expect(buildAuditSearch({ ...base, days: 30 }, "", 730)).toContain("days=30");
        expect(buildAuditSearch({ ...base, days: 180 }, "", 730)).not.toContain("days");
        expect(buildAuditSearch({ ...base, days: 30 }, "", 30)).not.toContain("days");
    });
});
