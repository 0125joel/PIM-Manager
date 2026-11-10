import { describe, it, expect } from "vitest";
import { WHATS_NEW_RELEASES } from "@/config/whatsNew";
import pkg from "../../../package.json";

const parts = (version: string) => version.split(".").map(Number);
const isNewer = (a: string, b: string) => {
    const [x, y] = [parts(a), parts(b)];
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
    return false;
};

describe("WHATS_NEW_RELEASES", () => {
    it("starts with the running version", () => {
        expect(WHATS_NEW_RELEASES[0].version).toBe(pkg.version);
    });
    it("lists releases newest first, each version once", () => {
        for (let i = 1; i < WHATS_NEW_RELEASES.length; i++) {
            expect(isNewer(WHATS_NEW_RELEASES[i - 1].version, WHATS_NEW_RELEASES[i].version)).toBe(true);
        }
    });
    it("gives a released version a date as YYYY-MM-DD; only the newest may still wait for one", () => {
        WHATS_NEW_RELEASES.forEach((release, index) => {
            if (release.date === null) expect(index).toBe(0);
            else expect(release.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        });
    });
    it("has a title and at least one entry per release", () => {
        for (const release of WHATS_NEW_RELEASES) {
            expect(release.title.length).toBeGreaterThan(0);
            expect(release.entries.length).toBeGreaterThan(0);
        }
    });
});
