import type { HelpPage } from "./types";
import { REPORT_HELP_TERM_KEYS, REPORT_TERMS } from "./reportTerms";

export const REPORT_HELP: HelpPage = {
    id: "report",
    title: "Report",
    intro: "The Report lists every role and group as it is now: who holds it, how, until when, and how PIM is set up for it. Use it to look into a number from the dashboard.",
    blocks: [
        { title: "Head", text: "Refresh reads the data again. The sync time says how old the data is." },
        { title: "Roles and groups", text: "Switch between Roles and Groups. The list is on the left, the selected item on the right; on a narrow screen the item opens as its own view with a back button. Search finds a role, a group or a person. Role-assignable groups outside PIM are a section of Groups: their members hold the group's roles all the time and are read when you open the group." },
        { title: "Filters", text: "Open Filters for three groups of controls per view. Active filters show as chips with names; a chip marked roles only or groups only waits for the other view. The dashboard opens here with the same filter." },
        { title: "Detail", text: "Assignments are listed as Eligible and Active with a tag for the type, how the access is held, the scope, the end and where it came from. Hover or focus a tag for what it means. A filter on assignments marks the rows that match." },
        { title: "Configuration", text: "The PIM settings in three tabs: Activation, Assignment and Notification. An amber dot says a tab needs attention. For a group, choose Member or Owner first." },
        { title: "Export", text: "Export opens one dialog: an overview for Excel, a file that opens in Configure’s Import, or a complete JSON backup. The current filter applies to the first two." },
    ],
    terms: REPORT_HELP_TERM_KEYS.map((key) => ({ term: REPORT_TERMS[key].label, text: REPORT_TERMS[key].text })),
    guide: [
        {
            title: "Reading a role",
            paragraphs: ["Select a role in the list. The assignments come first, the PIM configuration below them. A group that holds the role is one row with its members under it; an activation through a group is shown under its group when exactly one group can be the source."],
        },
        {
            title: "Filtering and search",
            items: [
                { label: "Search", text: "matches the name of a role or group and the name or UPN of a person; the rows of the person are marked in the detail." },
                { label: "Filters", text: "one select per key; the badge counts the keys of the current view." },
                { label: "Clear all", text: "removes every filter; the search stays until you clear it." },
            ],
            paragraphs: ["Everything is in the address: send the link and the other person sees the same list and selection."],
        },
        {
            title: "Exporting",
            items: [
                { label: "Overview", text: "one row per assignment and one per role or group with its settings, for Excel or an auditor." },
                { label: "For Configure Import", text: "the file Configure’s Import opens unchanged, with IDs, to apply the same settings or assignments elsewhere." },
                { label: "Backup", text: "everything as it is now in one JSON file, every policy with all its rules." },
            ],
        },
    ],
};
