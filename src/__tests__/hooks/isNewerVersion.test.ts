import { describe, expect, it } from "vitest";
import { isNewerVersion, safeReleaseUrl } from "@/hooks/useUpdateCheck";

describe("isNewerVersion", () => {
    it("is true only when latest is strictly newer", () => {
        expect(isNewerVersion("v2.1.0", "v2.1.1")).toBe(true);
        expect(isNewerVersion("v2.1.0", "v2.2.0")).toBe(true);
        expect(isNewerVersion("v2.1.0", "v3.0.0")).toBe(true);
        expect(isNewerVersion("v2.1.0", "v2.1.0")).toBe(false);
    });

    it("never reports an older release as an update (dev build ahead of public)", () => {
        expect(isNewerVersion("v2.2.0", "v2.1.0")).toBe(false);
        expect(isNewerVersion("v2.10.0", "v2.9.9")).toBe(false);
    });

    it("accepts tags with or without the v prefix and compares numerically", () => {
        expect(isNewerVersion("2.1.0", "v2.1.10")).toBe(true);
        expect(isNewerVersion("v2.1.9", "2.1.10")).toBe(true);
    });

    it("returns false for missing or pre-release tags", () => {
        expect(isNewerVersion(undefined, "v2.1.0")).toBe(false);
        expect(isNewerVersion("v2.1.0", null)).toBe(false);
        expect(isNewerVersion("v2.1.0", "v2.2.0-beta.1")).toBe(false);
    });
});

describe("safeReleaseUrl", () => {
    const releases = "https://github.com/0125joel/PIM-Manager/releases";

    it("keeps a link inside the project's releases page", () => {
        expect(safeReleaseUrl(`${releases}/tag/v3.0.0`)).toBe(`${releases}/tag/v3.0.0`);
        expect(safeReleaseUrl(releases)).toBe(releases);
    });

    it("falls back to the releases page for anything else", () => {
        expect(safeReleaseUrl("javascript:alert(1)")).toBe(releases);
        expect(safeReleaseUrl("https://evil.example/releases/tag/v9")).toBe(releases);
        expect(safeReleaseUrl("https://github.com/0125joel/PIM-Manager/releases.evil.example")).toBe(releases);
        expect(safeReleaseUrl("https://github.com/other/repo/releases/tag/v1")).toBe(releases);
        expect(safeReleaseUrl(undefined)).toBe(releases);
    });
});
