import { describe, expect, it } from "vitest";
import { getHelpForPath } from "@/config/help";
import { AZURE_DASHBOARD_HELP } from "@/config/help/azureDashboard";
import { AZURE_REPORT_HELP } from "@/config/help/azureReport";
import { REPORT_HELP } from "@/config/help/report";
import { DASHBOARD_HELP } from "@/config/help/dashboard";

describe("Azure dashboard help", () => {
    it("gives /azure the Azure dashboard topic", () => {
        expect(getHelpForPath("/azure")).toBe(AZURE_DASHBOARD_HELP);
        expect(getHelpForPath("/azure/")).toBe(AZURE_DASHBOARD_HELP);
    });

    it("keeps the Azure Report and the Entra Report topics", () => {
        expect(getHelpForPath("/azure/report")).toBe(AZURE_REPORT_HELP);
        expect(getHelpForPath("/report")).toBe(REPORT_HELP);
    });

    it("reuses the Entra dashboard text of the emergency access account", () => {
        const term = AZURE_DASHBOARD_HELP.terms.find((t) => t.term === "Emergency access account");
        expect(term).toEqual(DASHBOARD_HELP.terms.find((t) => t.term === "Emergency access account"));
    });
});
