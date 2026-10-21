import { CONFIGURE_HELP } from "./configure";
import { DASHBOARD_HELP } from "./dashboard";
import { REPORT_HELP } from "./report";
import { SETTINGS_HELP } from "./settings";
import type { HelpPage } from "./types";

export type { GuideSection, HelpBlock, HelpPage, HelpPageId, HelpTerm } from "./types";

export const HELP_PAGES: HelpPage[] = [DASHBOARD_HELP, REPORT_HELP, CONFIGURE_HELP, SETTINGS_HELP];

/** The help of the page at `pathname`; the dashboard's when the page has none of its own. */
export function getHelpForPath(pathname: string | null | undefined): HelpPage {
    const first = (pathname ?? "").split("/")[1] ?? "";
    return HELP_PAGES.find((page) => page.id === first) ?? DASHBOARD_HELP;
}
