import { describe, expect, it } from "vitest";
import { escapeODataString } from "@/utils/odataUtils";

describe("escapeODataString", () => {
    it("doubles single quotes so they cannot terminate the literal", () => {
        expect(escapeODataString("o'connor@contoso.com")).toBe("o''connor@contoso.com");
        expect(escapeODataString("a'b'c")).toBe("a''b''c");
    });

    it("leaves values without quotes untouched", () => {
        expect(escapeODataString("plain@contoso.com")).toBe("plain@contoso.com");
        expect(escapeODataString("")).toBe("");
    });

    it("neutralises an injection attempt", () => {
        const injected = "x' or userPrincipalName ne '";
        expect(escapeODataString(injected)).toBe("x'' or userPrincipalName ne ''");
    });
});
