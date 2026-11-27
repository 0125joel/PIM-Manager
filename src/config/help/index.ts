import { AZURE_DASHBOARD_HELP } from "./azureDashboard";
import { AZURE_AUDIT_HELP } from "./azureAudit";
import { AZURE_REPORT_HELP } from "./azureReport";
import { AUDIT_HELP } from "./audit";
import { CONFIGURE_HELP } from "./configure";
import { DASHBOARD_HELP } from "./dashboard";
import { REPORT_HELP } from "./report";
import { SETTINGS_HELP } from "./settings";
import type { HelpPage } from "./types";

export type { GuideSection, HelpBlock, HelpPage, HelpPageId, HelpTerm } from "./types";

export const HELP_PAGES: HelpPage[] = [DASHBOARD_HELP, REPORT_HELP, CONFIGURE_HELP, SETTINGS_HELP, AZURE_REPORT_HELP, AZURE_DASHBOARD_HELP, AUDIT_HELP, AZURE_AUDIT_HELP];

/**
 * The help of the page at `pathname`; the dashboard's when the page has none of its own. `/azure` gets the Azure
 * dashboard's help and `/azure/audit` the Azure Audit's; every other Azure page gets the Azure Report's (Azure Configure
 * says it comes later).
 */
export function getHelpForPath(pathname: string | null | undefined): HelpPage {
    const first = (pathname ?? "").split("/")[1] ?? "";
    if (first === "azure") {
        const second = (pathname ?? "").split("/")[2] ?? "";
        if (second === "audit") return AZURE_AUDIT_HELP;
        return second === "" ? AZURE_DASHBOARD_HELP : AZURE_REPORT_HELP;
    }
    return HELP_PAGES.find((page) => page.id === first) ?? DASHBOARD_HELP;
}
