export interface WhatsNewEntry {
    title: string;
    text: string;
}

/** What the "What's new" view of the help panel shows for the running release. Edit with the changelog. */
export const WHATS_NEW_TITLE = "A new look for the whole app";

export const WHATS_NEW: WhatsNewEntry[] = [
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
];
