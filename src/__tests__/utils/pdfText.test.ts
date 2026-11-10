import { describe, expect, it } from "vitest";
import { pdfCellBreak } from "@/utils/pdfText";

describe("pdfCellBreak", () => {
    it.each([
        ["rg-web", ["rg-web"]],
        ["Contributor", ["Contributor"]],
        ["abcdefghijkl", ["abcdefghijkl"]],
        ["kv-contoso-01", ["k", "v-c", "o", "n", "t", "o", "s", "o-0", "1"]],
        ["abcdefghijklm", ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m"]],
        ["a--b-c.d_e/f!", ["a--b-c.d_e/f!"]],
    ])("breaks %s into %j", (word, expected) => {
        expect(pdfCellBreak(word)).toEqual(expected);
    });

    it.each([
        ["svc-contoso-production-westeurope-automation@contoso.onmicrosoft.com"],
        ["SG-PIM-Contoso-Production-Westeurope-Owners"],
        ["stcontosoproductionwesteurope0001diagnosticslogs"],
    ])("gives %s back whole, and never breaks next to a character that is not a letter or digit", (word) => {
        const parts = pdfCellBreak(word);
        expect(parts.join("")).toBe(word);
        for (const part of parts.slice(0, -1)) {
            expect(part.at(-1), part).toMatch(/[A-Za-z0-9]/);
        }
        for (const part of parts.slice(1)) {
            expect(part[0], part).toMatch(/[A-Za-z0-9]/);
        }
    });
});
