import type { HelpPage } from "./types";

export const AZURE_DASHBOARD_HELP: HelpPage = {
    id: "azure-dashboard",
    title: "Dashboard",
    intro: "The Azure dashboard shows who can use privileged access on your Azure resources and on which terms, for the scopes you can read. Every number filters the page when you select it.",
    blocks: [
        { title: "The cards", text: "Totals with their breakdown. Role × scope counts each role once per scope where it is assigned. Permanent means active without an end date; eligible means it has to be activated first. Inherited counts assignments made higher up in the tree." },
        { title: "Has access", text: "All assignments by type. The number to watch is permanent, apart from your emergency access accounts." },
        { title: "On activation", text: "What privileged roles ask for when someone activates them, per scope: MFA or an authentication context, approval, a reason, and how long. In Azure, role settings are set per role and per scope; they do not inherit." },
        { title: "From Microsoft", text: "PIM's own alerts for Azure resources, per subscription, read only. A subscription Microsoft has not scanned yet shows no alert even when there is something to find. Resolve alerts in the Azure portal." },
        { title: "Easy to miss", text: "Details that are hard to spot in the totals, grouped in three categories. A zero turns grey. Apps, managed identities and agents can hold an Azure role only as an active assignment." },
    ],
    terms: [
        { term: "Role × scope", text: "one role on one scope (a management group, subscription, resource group or resource)." },
        { term: "Delegated subscription", text: "a subscription of another tenant that you manage through Azure Lighthouse." },
        { term: "Emergency access account", text: "a break glass account you marked in Settings. It is counted apart, never dropped." },
    ],
    guide: [
        {
            title: "Basic and Advanced",
            paragraphs: ["The switch next to the title changes the level of detail. Basic answers the first questions: who has access, on what terms, what is easy to miss. Advanced adds four sections: has access and how, activation charts, the most privileged accounts and who approves, and what is happening right now."],
            items: [{ label: "Privileged or All roles", text: "Advanced counts privileged roles by default: the five that Microsoft marks privileged, and every role whose actions let it change access. The switch in the title bar counts every role instead." }],
        },
        {
            title: "Scope",
            paragraphs: ["The scope bar decides what is counted. All you can read is every scope your account can read. Choose a scope to count it and what is below it. Include inherited also counts what is assigned above it. Delegated subscriptions are counted by default and marked; switch them off to leave them out."],
        },
        {
            title: "Show more details",
            paragraphs: ["The page starts calm: what counts and filters stays, the rest waits behind Show more details next to Basic and Advanced. Without it, the scope bar keeps the path and Delegated subscriptions, and one sentence under it says how many subscriptions you can read completely or in part, and how many resource groups and resources are not read yet; Read the rest reads the next part. What you can read lists them, with the role settings you cannot read. Easy to miss shows only rows that are not zero, From Microsoft and Right now are left out, and Advanced shows the first 5 accounts. Each view remembers its own choice in this browser. In Settings, Details set to More shows everything everywhere."],
        },
        {
            title: "Filtering",
            paragraphs: ["Click a card, a legend row or an Easy to miss row and every block that the filter is about changes. The filter sits in the address bar, so you can share the view, and Open in report with this filter shows the same assignments in the Report. Escape clears it. Blocks that a filter does not apply to are dimmed."],
        },
        {
            title: "Refresh",
            paragraphs: ["Refresh reads the assignments, the role settings and the role definitions again. Without a Refresh, role definitions are read once per session."],
        },
        {
            title: "Export",
            paragraphs: ["Export opens one dialog for a PDF report or a CSV of all assignments in the chosen scope."],
        },
    ],
};
