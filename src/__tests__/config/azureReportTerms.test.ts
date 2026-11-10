import { describe, expect, it } from "vitest";
import { getHelpForPath } from "@/config/help";
import { AZURE_REPORT_HELP } from "@/config/help/azureReport";
import { AZURE_HELP_TERM_KEYS, AZURE_TERMS } from "@/config/help/azureReportTerms";
import { REPORT_TERMS } from "@/config/help/reportTerms";

describe("Azure Report help", () => {
    it("gives every Azure route the Azure Report help, and leaves the Entra routes alone", () => {
        expect(getHelpForPath("/azure/report").id).toBe("azure-report");
        expect(getHelpForPath("/azure").id).toBe("azure-dashboard");
        expect(getHelpForPath("/azure/").id).toBe("azure-dashboard");
        expect(getHelpForPath("/azure/configure").id).toBe("azure-report");
        expect(getHelpForPath("/report").id).toBe("report");
        expect(getHelpForPath("/").id).toBe("dashboard");
    });

    it("lists each help term once with the text its tag shows", () => {
        expect(new Set(AZURE_HELP_TERM_KEYS).size).toBe(AZURE_HELP_TERM_KEYS.length);
        expect(AZURE_REPORT_HELP.terms).toEqual(AZURE_HELP_TERM_KEYS.map((key) => ({ term: AZURE_TERMS[key].label, text: AZURE_TERMS[key].text })));
    });

    it("reuses the Entra text where the term means the same", () => {
        expect(AZURE_TERMS.permanent).toBe(REPORT_TERMS.permanent);
        expect(AZURE_TERMS.activated).toBe(REPORT_TERMS.activated);
        expect(AZURE_TERMS.emergency).toBe(REPORT_TERMS.emergency);
    });

    it("gives the scope tags their labels", () => {
        expect(AZURE_TERMS.partial.label).toBe("Partial");
        expect(AZURE_TERMS.scopeLoading.label).toBe("Loading");
        expect(AZURE_TERMS.scopeFailed.label).toBe("Not loaded");
    });

    it("lists Partial right after Delegated in the help", () => {
        expect(AZURE_HELP_TERM_KEYS[AZURE_HELP_TERM_KEYS.indexOf("delegated") + 1]).toBe("partial");
    });

    it("has no em dash in any term text", () => {
        for (const term of Object.values(AZURE_TERMS)) {
            expect(term.text).not.toContain("\u2014");
            expect(term.label).not.toContain("\u2014");
        }
    });
});
