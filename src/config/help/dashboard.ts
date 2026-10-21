import type { HelpPage } from "./types";

export const DASHBOARD_HELP: HelpPage = {
    id: "dashboard",
    title: "Dashboard",
    intro: "The dashboard shows who can use privileged access in this tenant and on which terms. Every number filters the page when you select it.",
    blocks: [
        { title: "The cards", text: "Totals with their breakdown. Permanent means active without an end date; eligible means it has to be activated first." },
        { title: "Has access", text: "All assignments by type. The number to watch is permanent, apart from your emergency access accounts." },
        { title: "On activation", text: "What privileged roles ask for when someone activates them: MFA or an authentication context, approval, a reason, and how long." },
        { title: "Groups outside PIM", text: "Role-assignable groups that PIM does not manage. Their members hold the role permanently." },
        { title: "From Microsoft", text: "PIM's own security alerts, read only. Resolve them in the Microsoft Entra admin center." },
        { title: "Easy to miss", text: "Details that are hard to spot in the totals, grouped in three categories. A zero turns grey." },
    ],
    terms: [
        { term: "Activation", text: "switching on an eligible assignment for a limited time." },
        { term: "Authentication context", text: "a Conditional Access tag that decides what activation requires." },
        { term: "Emergency access account", text: "a break glass account you marked in Settings. It is counted apart, never dropped." },
    ],
    guide: [
        {
            title: "Basic and Advanced",
            paragraphs: ["The switch next to the title changes the level of detail. Basic answers the first questions: who has access, on what terms, what is easy to miss. Advanced adds five sections: has access and how, activation charts, PIM for Groups, the most privileged accounts and who approves, and what is happening right now."],
            items: [{ label: "Privileged or All roles", text: "Advanced counts privileged roles by default. The switch in the title bar counts every role instead." }],
        },
        {
            title: "Filtering",
            paragraphs: ["Click a card, a legend row or an Easy to miss row and every block that the filter is about changes. The filter sits in the address bar (the f parameter), so you can share the view. Escape or the bar above the cards clears it. Blocks that a filter does not apply to are dimmed and say so."],
        },
        {
            title: "What is counted",
            paragraphs: ["The chips under the title decide which workloads count: Directory roles, PIM for Groups, Unmanaged groups, Agents and Security alerts. Agents switches AI agents (Microsoft Entra Agent ID) on or off in every number; it is on by default. A number that is not known yet shows a placeholder, never zero. A block that failed to load says why and offers Try again."],
        },
        {
            title: "Refresh",
            paragraphs: ["Refresh picks up new or removed assignments and keeps the policies it already loaded. To reload every policy, clear the cached data in Settings and reload the page."],
        },
        {
            title: "Export",
            paragraphs: ["Export opens one dialog for a PDF report or a CSV of all assignments. Choose Summary, Full or Full with appendix, an Admin or Management audience, whether names of people are replaced, bars, donuts or tables, what is counted, and which blocks go in. The header of the document says what is counted, when the data was read, the filter, who exported and the version."],
        },
    ],
};
