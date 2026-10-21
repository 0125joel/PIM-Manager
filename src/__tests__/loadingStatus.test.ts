import { describe, it, expect } from "vitest";
import { buildLoadingSentence, combineLoadingProgress, formatSyncedAgo, type LoadingSnapshot } from "@/utils/loadingStatus";

const idle: LoadingSnapshot = {
    rolesLoading: false,
    rolesProgress: 0,
    policiesLoading: false,
    policyProgress: { current: 0, total: 0 },
    groupsLoading: false,
    groupsProgress: null,
};

describe("combineLoadingProgress", () => {
    it("is null when nothing loads", () => {
        expect(combineLoadingProgress(idle)).toBeNull();
    });
    it("shows the fast phase alone", () => {
        expect(combineLoadingProgress({ ...idle, rolesLoading: true, rolesProgress: 40 })).toBe(40);
    });
    it("clamps the fast phase to 0 to 100", () => {
        expect(combineLoadingProgress({ ...idle, rolesLoading: true, rolesProgress: 140 })).toBe(100);
    });
    it("uses the policy progress when only roles load in the background", () => {
        const value = combineLoadingProgress({ ...idle, policiesLoading: true, policyProgress: { current: 45, total: 130 } });
        // roles 34.6% at weight 0.7, groups finished at weight 0.3
        expect(value).toBeCloseTo((45 / 130) * 100 * 0.7 + 30, 5);
    });
    it("weights roles 70 and groups 30 when both load", () => {
        const value = combineLoadingProgress({
            ...idle,
            policiesLoading: true,
            policyProgress: { current: 50, total: 100 },
            groupsLoading: true,
            groupsProgress: { current: 10, total: 20 },
        });
        expect(value).toBeCloseTo(50, 5);
    });
    it("counts a workload that has no total yet as not started rather than complete", () => {
        const value = combineLoadingProgress({ ...idle, groupsLoading: true, groupsProgress: { current: 0, total: 0 } });
        // roles count as finished at weight 0.7; groups without a total are left out, so the result is 100
        expect(value).toBe(100);
    });
});

describe("buildLoadingSentence", () => {
    it("is null when nothing loads", () => {
        expect(buildLoadingSentence(idle)).toBeNull();
    });
    it("names the role settings with a count", () => {
        expect(buildLoadingSentence({ ...idle, policiesLoading: true, policyProgress: { current: 45, total: 130 } })).toBe(
            "Loading role settings, 45 of 130. Numbers that need them show a placeholder until they arrive.",
        );
    });
    it("says nothing about roles during the fast phase", () => {
        expect(buildLoadingSentence({ ...idle, rolesLoading: true })).toBeNull();
    });
    it("joins role settings and groups into one sentence block", () => {
        expect(
            buildLoadingSentence({
                ...idle,
                policiesLoading: true,
                policyProgress: { current: 1, total: 2 },
                groupsLoading: true,
                groupsProgress: { current: 3, total: 24 },
            }),
        ).toBe("Loading role settings, 1 of 2. Numbers that need them show a placeholder until they arrive. Loading PIM for Groups, 3 of 24.");
    });
    it("omits the count while the total is unknown", () => {
        expect(buildLoadingSentence({ ...idle, groupsLoading: true })).toBe("Loading PIM for Groups.");
    });
});

describe("formatSyncedAgo", () => {
    const now = new Date("2026-10-01T12:00:00Z");
    it("handles just now, minutes, hours and days", () => {
        expect(formatSyncedAgo(new Date("2026-10-01T11:59:40Z"), now)).toBe("synced just now");
        expect(formatSyncedAgo(new Date("2026-10-01T11:48:00Z"), now)).toBe("synced 12 min ago");
        expect(formatSyncedAgo(new Date("2026-10-01T09:00:00Z"), now)).toBe("synced 3 h ago");
        expect(formatSyncedAgo(new Date("2026-09-29T12:00:00Z"), now)).toBe("synced 2 d ago");
    });
    it("never reports a negative age", () => {
        expect(formatSyncedAgo(new Date("2026-10-01T12:05:00Z"), now)).toBe("synced just now");
    });
});

describe("buildLoadingSentence subject", () => {
    it("names settings instead of numbers for the Report", () => {
        expect(buildLoadingSentence({ ...idle, policiesLoading: true, policyProgress: { current: 3, total: 9 } }, "settings")).toBe("Loading role settings, 3 of 9. Settings show a placeholder until they arrive.");
        expect(buildLoadingSentence({ ...idle, policiesLoading: true }, "settings")).toBe("Loading role settings. Settings show a placeholder until they arrive.");
    });
});
