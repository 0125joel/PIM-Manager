import type { HelpPage } from "./types";

export const SETTINGS_HELP: HelpPage = {
    id: "settings",
    title: "Settings",
    intro: "Settings holds what the app may read and write, how it looks, and the accounts it should treat as emergency access.",
    blocks: [
        { title: "Permissions", text: "A table per workload with read and write consent. Grant a permission here before you need it, or when the app asks." },
        { title: "Display", text: "Theme, the default dashboard view and the Privileged or All roles scope." },
        { title: "Emergency access accounts", text: "Mark your break glass accounts. They are tagged everywhere and counted apart from permanent access." },
        { title: "Advanced", text: "The log level and Clear cached data, which makes the next load a full one." },
    ],
    terms: [
        { term: "Consent", text: "permission you or an admin gave the app to read or write PIM data." },
        { term: "Hide", text: "removes a workload from the screens but keeps the permission it was granted." },
    ],
    guide: [
        {
            title: "Workloads",
            paragraphs: ["Workloads are the data sources PIM Manager reads: Directory roles, PIM for Groups and Security alerts. Enabling one asks for extra permissions in a popup. Hiding removes it from the screens but never removes a granted permission; revoke consent in the Microsoft Entra admin center."],
        },
        {
            title: "Emergency access accounts",
            paragraphs: ["The list is stored per tenant in this browser. You can export and import it as JSON. Marked accounts get an emergency tag wherever they appear and are not counted as permanent access outside the emergency sentence."],
        },
    ],
};
