import { describe, it, expect } from "vitest";
import { isWhatsNewUnseen } from "@/utils/whatsNew";

describe("isWhatsNewUnseen", () => {
    it("is unseen for a version the user has not opened", () => {
        expect(isWhatsNewUnseen("v3.2.0", null)).toBe(true);
        expect(isWhatsNewUnseen("v3.2.0", "v3.1.0")).toBe(true);
    });
    it("is seen for the same version", () => {
        expect(isWhatsNewUnseen("v3.2.0", "v3.2.0")).toBe(false);
    });
    it("never shows a dot without a known version", () => {
        expect(isWhatsNewUnseen(undefined, null)).toBe(false);
        expect(isWhatsNewUnseen("", "v1")).toBe(false);
    });
});
