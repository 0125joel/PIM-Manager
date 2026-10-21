import { describe, expect, it } from "vitest";
import { isDemoStartPath } from "@/demo/runtime/session";

describe("isDemoStartPath", () => {
    it("accepts the start pages, with a query or hash and sub-paths", () => {
        expect(isDemoStartPath("/dashboard")).toBe(true);
        expect(isDemoStartPath("/report?tab=roles")).toBe(true);
        expect(isDemoStartPath("/configure?mode=edit&role=abc")).toBe(true);
        expect(isDemoStartPath("/settings#display")).toBe(true);
        expect(isDemoStartPath("/help/configure")).toBe(true);
    });

    it("refuses protocol-relative paths, other pages and relative paths", () => {
        expect(isDemoStartPath("//evil.example/dashboard")).toBe(false);
        expect(isDemoStartPath("https://evil.example/")).toBe(false);
        expect(isDemoStartPath("/redirect")).toBe(false);
        expect(isDemoStartPath("/")).toBe(false);
        expect(isDemoStartPath("/dashboards")).toBe(false);
        expect(isDemoStartPath("dashboard")).toBe(false);
    });
});
