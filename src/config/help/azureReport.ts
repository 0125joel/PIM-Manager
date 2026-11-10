import type { HelpPage } from "./types";
import { AZURE_HELP_TERM_KEYS, AZURE_TERMS } from "./azureReportTerms";

export const AZURE_REPORT_HELP: HelpPage = {
    id: "azure-report",
    title: "Azure Report",
    intro: "The Azure Report lists the PIM role assignments on Azure resources that your Azure roles let you read: who holds which role, on which scope, how and until when.",
    blocks: [
        { title: "Head", text: "Refresh reads the data again; the sync time next to it says how old the data is. The line under the title names the selected scope and whether inherited assignments are included. Show more details next to the title adds every tag and the Origin column; without it a row shows only what deviates, and one sentence with What you can read replaces the Partial view box. The report remembers your choice in this browser." },
        { title: "Scopes", text: "The tree on the left holds root, management groups, subscriptions, resource groups and resources. Select a scope to see its assignments and those below it; on a narrow screen the tree opens from the Scope button." },
        { title: "Visibility", text: "You only see the scopes your Azure roles let you read, so the report is never a total for the tenant. A subscription you cannot read as a whole shows the resource groups and resources you can read, marked Partial. When there are too many to read in about a minute, the page says how many are not read yet, and Read the rest reads the next part. Without any readable scope, the page shows your own Azure roles. Azure can take up to 10 minutes to apply a role change; if a role you just gave or activated is missing, wait a moment and choose Refresh." },
        { title: "Filters", text: "Open Filters for three groups of controls: Assignments, Role properties and Scope. Origin starts on This scope; choose All to add what is inherited from above. Active filters show as chips with names." },
        { title: "Assignments", text: "One row per assignment with a tag for the type, the state, the end and where it came from. Hover or focus a tag for what it means. Select a role to see its PIM settings at that scope." },
        { title: "Roles", text: "Roles lists the roles with an assignment on the selected scope, with their counts. Select a role for its assignments, grouped Eligible and Active, and its PIM settings at this scope; Settings on a row opens the settings of the scope that row is on. Choose on the Settings page which view the report opens in." },
        { title: "Export", text: "Overview gives two CSV files: one row per assignment, and one row per role and scope with its PIM settings, read when you export. Apply the current scope and filter, or export every scope you can read; replace names before you share a file. Configure Import and Backup come with Azure Configure." },
    ],
    terms: AZURE_HELP_TERM_KEYS.map((key) => ({ term: AZURE_TERMS[key].label, text: AZURE_TERMS[key].text })),
    guide: [
        {
            title: "Settings per scope",
            paragraphs: ["In Azure, PIM settings belong to one role on one scope and are not inherited: a rule on a subscription does not reach its resource groups. The settings you open always say which scope they belong to."],
        },
        {
            title: "Filtering and search",
            items: [
                { label: "Search", text: "matches the name of a principal or a role." },
                { label: "Filters", text: "one select per key; the badge counts the active keys." },
                { label: "Clear all", text: "returns to the start, Origin on This scope; the search stays until you clear it." },
            ],
            paragraphs: ["The view, the scope, the role, the search and the filters are in the address: send the link and the other person sees the same view, as far as their Azure roles allow."],
        },
    ],
};
