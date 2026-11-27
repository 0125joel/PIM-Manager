import type { HelpPage } from "./types";

export const SETTINGS_HELP: HelpPage = {
    id: "settings",
    title: "Settings",
    intro: "Settings holds what the app may read and write, the Log Analytics workspaces Audit reads, how it looks, and the accounts it should treat as emergency access.",
    blocks: [
        { title: "Workloads and permissions", text: "A table per workload with read and write consent. Grant a permission here before you need it, or when the app asks. Audit log and Log Analytics are read only; Log Analytics shows Not asked yet until you choose a workspace." },
        { title: "Display", text: "Theme, the view the dashboard and the Azure Report open in, and Details. With Fewer, each page remembers its own Show more details; with More, every page shows everything. Changing Details resets the pages. Tours On starts a short tour the first time you open a part of the app; Off stops that, and Start the tour in Help still works." },
        { title: "Log Analytics workspace", text: "Choose one or more workspaces so the Audit page reads further back than the Entra audit log keeps (30 days) and the Azure activity log (90 days). Each workspace shows which of the two logs it holds, or that you may not read it, and what that means for the history. The marks Receives Entra audit logs and Receives Azure activity logs are a convenience only: the check decides the status. A workspace shows what it holds, also on scopes your Azure roles do not reach. Choose workspaces lists the workspaces your account can see, with Grant Azure access, or you enter a workspace ID. Reading them asks for Data.Read on Log Analytics, which your tenant may need an admin to approve, and read access to each workspace, such as Log Analytics Reader. Your choice stays in this browser, and each person chooses for themselves." },
        { title: "Emergency access accounts", text: "Mark your break glass accounts. They are tagged everywhere and counted apart from permanent access." },
        { title: "Access model labels", text: "Which authentication context of your tenant stands for each label of the PIM Monitor access model. Configure asks once and uses it for Guided and Import; change or clear it here. Nothing is written to the tenant." },
        { title: "Advanced", text: "The log level and Clear cached data, which makes the next load a full one." },
    ],
    terms: [
        { term: "Consent", text: "permission you or an admin gave the app to read or write PIM data." },
        { term: "Hide", text: "removes a workload from the screens but keeps the permission it was granted." },
    ],
    guide: [
        {
            title: "Workloads",
            paragraphs: ["Workloads are the data sources PIM Manager reads: Directory roles, PIM for Groups, Security alerts, the Custom extension list, the Conditional Access check, the Audit log and Log Analytics. Enabling one asks for extra permissions in a popup. Hiding removes it from the screens but never removes a granted permission; revoke consent in the Microsoft Entra admin center."],
        },
        {
            title: "Emergency access accounts",
            paragraphs: ["The list is stored per tenant in this browser. You can export and import it as JSON. Marked accounts get an emergency tag wherever they appear and are not counted as permanent access outside the emergency sentence."],
        },
    ],
};
