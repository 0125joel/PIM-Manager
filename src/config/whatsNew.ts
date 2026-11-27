export interface WhatsNewEntry {
    title: string;
    text: string;
}

export interface WhatsNewRelease {
    /** As in the root CHANGELOG.md heading, without the "v" */
    version: string;
    /** Release date, `YYYY-MM-DD`; null until the release reaches main (a beta on Dev shows the version only) */
    date: string | null;
    /** One line under the version: what the release is about */
    title: string;
    entries: WhatsNewEntry[];
}

/** What the "What's new" view of the help panel shows, newest release first. Edit with the changelog. */
export const WHATS_NEW_RELEASES: WhatsNewRelease[] = [
    {
        version: "3.2.0",
        date: "2026-11-27",
        title: "Audit for Entra and Azure",
        entries: [
            { title: "Audit Entra role and group activity", text: "The Audit page brings activations, assignment and settings changes, and role changes outside PIM into one timeline, up to 30 days. Filter the events, open No activation for the activity in the selected period, and export the current view as CSV, JSON or PDF. No activation describes that period, not whether a role can be removed. The page asks for its own optional permission, and an admin must approve it once for your tenant." },
            { title: "Audit on Azure", text: "The same page on Azure, with the same timeline, filters and exports. See who activated what and what changed on the scopes you can read, up to 90 days, with no new permission. What could not be read is named instead of quietly missing." },
            { title: "Through a group counts too", text: "An activation or assignment through a group that holds a role now shows the role and the group, on Entra and on Azure. It makes no difference how someone got there." },
            { title: "One workspace choice for both logs", text: "Settings shows for each Log Analytics workspace what it holds of the Entra audit log and the Azure activity log, and how far back. With a workspace, Audit reaches past 30 days on Entra and up to a year on Azure. Workspaces are read with their own optional permission." },
            { title: "Your Azure roles through a group", text: "A role you hold through a PIM group now reads via that group, and the PIM groups you are an eligible member of are listed. Their Azure roles show once you activate the membership." },
            { title: "Removed Azure assignments stay gone", text: "Below a subscription you cannot read, an inherited assignment that was removed no longer shows, and a direct assignment the PIM list left out does." },
            { title: "Open it in the portal", text: "In the Report and the Azure Report, the name of a user, group or app opens it in the Entra admin center, and on Azure a scope name in the table opens that scope in the Azure portal. Both open in a new tab." },
            { title: "What was not read is named", text: "Audit names a Log Analytics table you may not read, or may read only in part, and the dashboard exports name settings, groups and subscriptions that did not load. They no longer look empty." },
            { title: "Import checks who it is about", text: "A row with an ID and a UPN of two different people is refused, and Import and Review show the UPN or ID under the name." },
        ],
    },
    {
        version: "3.1.1",
        date: "2026-11-10",
        title: "Fixes for self-hosted deploys",
        entries: [
            { title: "Self-hosted deploys on Azure", text: "Azure accepts the configuration of PIM Manager again, so a self-hosted copy deploys. If you host it yourself, run the template again to get this build." },
        ],
    },
    {
        version: "3.1.0",
        date: "2026-11-10",
        title: "Azure, tours and calmer pages",
        entries: [
            { title: "PIM for Azure resources", text: "Switch to Azure in the top bar for a Report and a dashboard of your Azure role assignments, from management groups down to single resources. You see only what your Azure roles let you read. Configure for Azure follows later." },
            { title: "The Azure Report", text: "A scope tree with the roles or the assignments of each scope, inherited ones included, with the filters and tags of the Entra Report and an export to CSV." },
            { title: "The Azure dashboard", text: "Basic and Advanced for Azure: eight cards, Easy to miss, PIM's own alerts per subscription, and a scope bar to narrow it down. Every number filters the page, and Open in report with this filter shows who it is." },
            { title: "A tour for every page", text: "The first time you open a part of the app, a short tour shows what you see, what it means and where to look next, on Entra and on Azure. Start the tour in Help lets you pick one per page, or walk through all of Entra or Azure. Turn them off in Settings when you know your way." },
            { title: "Calmer pages", text: "The dashboards and the Reports, Entra and Azure, now start with what counts. Show more details next to the title brings back the rest, and each page remembers your choice. Prefer everything at once? Set Details to More in Settings." },
            { title: "Safer Configure", text: "A setting another admin changed since your review is not written over, a write is never sent twice when Graph is busy, and Import refuses a group that cannot hold a directory role." },
        ],
    },
    {
        version: "3.0.0",
        date: "2026-10-17",
        title: "A new look for the whole app",
        entries: [
            { title: "AI agents", text: "PIM Manager now recognises agent identities and agent identity blueprint principals of Microsoft Entra Agent ID. The Report shows them with Microsoft's names and has the filter Who with the value Agents, and the dashboard counts Agents with a role. The chip Agents leaves them out of every number." },
            { title: "Configure, rebuilt around a review", text: "Edit roles and groups, follow Guided steps or Import a file: every change waits in one basket, is checked, and is written only after you apply. A snapshot lets you undo one of the last ten applies." },
            { title: "Import with a reference", text: "A CSV or an access model file opens with every column explained, and every row or value is compared with your tenant before it becomes a change." },
            { title: "The access model", text: "See the PIM Monitor catalog of roles by plane and level, place your groups, and use the recommended settings as a template." },
            { title: "A shared filter", text: "Click a card, a legend row or an Easy to miss row and the dashboard filters. The filter lives in the address bar, and the Report opens with the same roles." },
            { title: "A dashboard built around questions", text: "Basic answers who has access, on what terms and what is easy to miss. Advanced adds activation charts, custom extensions, PIM for Groups, the most privileged accounts and what is happening right now." },
            { title: "A new Report", text: "A list of roles or groups next to the detail of the one you pick, with search, a filter panel and an address you can share. Old Report links are converted." },
            { title: "A new export", text: "One dialog for PDF and CSV. Choose detail, audience, names, bars or donuts, and which blocks go in. The Report has its own export for an overview, for Configure Import and as a backup." },
            { title: "PIM custom extensions (Preview)", text: "The Report and the dashboard show which custom extension a role or group calls, and Configure can link one. Listing the tenant's extensions asks for a permission the first time you need it." },
            { title: "Honest loading and failures", text: "A number that is not known yet shows a placeholder, never zero. A block that failed says why and offers Try again." },
        ],
    },
];
