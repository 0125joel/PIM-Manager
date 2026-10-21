import { describe, expect, it } from "vitest";
import { HEADLINE_ROLES, WIDE_HEADLINE_ROLES, msUntilNextHour, pickRole } from "@/utils/rotatingRole";

describe("pickRole", () => {
    it("never returns the previous name", () => {
        for (let i = 0; i < 50; i += 1) {
            expect(pickRole(HEADLINE_ROLES, "Global Admin", () => i / 50)).not.toBe("Global Admin");
        }
    });

    it("can return every other name", () => {
        const seen = new Set<string>();
        for (let i = 0; i < HEADLINE_ROLES.length * 4; i += 1) {
            seen.add(pickRole(HEADLINE_ROLES, "Global Admin", () => i / (HEADLINE_ROLES.length * 4)));
        }
        expect(seen.size).toBe(HEADLINE_ROLES.length - 1);
    });

    it("works with one name and with nothing shown before", () => {
        expect(pickRole(["Only"], "Only", () => 0.9)).toBe("Only");
        expect(HEADLINE_ROLES).toContain(pickRole(HEADLINE_ROLES, null, () => 0.999999));
    });
});

describe("headline names", () => {
    it("keep the short names within 17 characters and the wide ones within 21", () => {
        for (const role of HEADLINE_ROLES) expect(role.length).toBeLessThanOrEqual(17);
        for (const role of WIDE_HEADLINE_ROLES) expect(role.length).toBeLessThanOrEqual(21);
    });

    it("have no duplicates", () => {
        const all = [...HEADLINE_ROLES, ...WIDE_HEADLINE_ROLES];
        expect(new Set(all).size).toBe(all.length);
    });
});

describe("msUntilNextHour", () => {
    it("counts to the next full hour", () => {
        expect(msUntilNextHour(new Date(2026, 9, 11, 14, 30, 0, 0))).toBe(30 * 60 * 1000);
        expect(msUntilNextHour(new Date(2026, 9, 11, 23, 59, 59, 0))).toBe(1000);
    });
});
