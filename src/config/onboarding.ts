import type { IconName } from "@/components/icons/Icon";

// Manually bumped when there are noteworthy features to announce.
// Not every release needs highlights, only bump when there's something worth showing.
export const FEATURE_HIGHLIGHTS_VERSION = "3.0";

export interface TourGuideItem {
    text: string;
}

export interface TourStep {
    id: string;
    target: string;
    page: string;
    title: string;
    description: string;
    icon: IconName;
    guides: TourGuideItem[];
    tooltipPosition?: "top" | "bottom" | "left" | "right";
}

// ---------------------------------------------------------------------------
// First-time onboarding tour, broad overview for brand new users
// ---------------------------------------------------------------------------
export const ONBOARDING_STEPS: TourStep[] = [
    // -- Dashboard --
    {
        id: "welcome",
        target: "app-title",
        page: "/dashboard",
        title: "Welcome to PIM Manager",
        description: "Let\u2019s take a quick tour of the key areas.",
        icon: "shield",
        guides: [
            { text: "PIM Manager runs entirely in your browser, no data leaves your session" },
            { text: "All data comes from Microsoft Graph API using your credentials" },
            { text: "You can explore read-only before enabling any write features" },
        ],
        tooltipPosition: "bottom",
    },
    {
        id: "view-mode",
        target: "view-mode",
        page: "/dashboard",
        title: "Security Dashboard",
        description: "Your starting point for PIM posture insights.",
        icon: "dashboard",
        guides: [
            { text: "Basic answers the first questions, Advanced adds activation charts, groups, accounts and what is happening now" },
            { text: "Click a card, a legend row or an Easy to miss row to filter the whole page" },
            { text: "Numbers that are not known yet show a placeholder, never zero" },
        ],
        tooltipPosition: "bottom",
    },
    {
        id: "workloads",
        target: "workload-chips",
        page: "/dashboard",
        title: "Workloads & Consent",
        description: "PIM Manager uses incremental consent to access your data.",
        icon: "extension",
        guides: [
            { text: "Directory Roles load automatically after sign-in" },
            { text: "PIM for Groups, Security Alerts and other workloads need additional consent" },
            { text: "Enable workloads with the workload chips, permissions are listed under Settings" },
            { text: "Consent is remembered, workloads stay enabled across sessions" },
        ],
        tooltipPosition: "bottom",
    },
    {
        id: "dashboard-export",
        target: "dashboard-export-pdf",
        page: "/dashboard",
        title: "Export",
        description: "Share your security posture with stakeholders.",
        icon: "export",
        guides: [
            { text: "One dialog for a PDF report or a CSV of all assignments" },
            { text: "Choose Summary, Full or Full with appendix, an Admin or Management audience, and bars, donuts or tables" },
            { text: "Names of people can be replaced, and the current filter can be applied" },
        ],
        tooltipPosition: "bottom",
    },
    // -- Report --
    {
        id: "report-filters",
        target: "report-filters",
        page: "/report",
        title: "Filters & Search",
        description: "Narrow down exactly what you need to see.",
        icon: "filter",
        guides: [
            { text: "Three groups of filters per view, for roles and for groups" },
            { text: "Search a role, a group or a person" },
            { text: "Active filters show as chips, Clear all removes them" },
        ],
        tooltipPosition: "bottom",
    },
    {
        id: "report-export",
        target: "report-export",
        page: "/report",
        title: "Report Export",
        description: "Get your data out of PIM Manager.",
        icon: "export",
        guides: [
            { text: "Overview as CSV for Excel or an auditor" },
            { text: "A file that opens in Configure\u2019s Import, with every column and ID" },
            { text: "A complete JSON backup before you change anything" },
        ],
        tooltipPosition: "bottom",
    },
    // -- Configure --
    {
        id: "configure-modes",
        target: "nav-configure",
        page: "/configure",
        title: "Configure with a review",
        description: "Change settings and assignments in three ways, and see everything before it is written.",
        icon: "configure",
        guides: [
            { text: "Edit: pick a role or group and change its settings, or the people who have it" },
            { text: "Guided: the same rules on several roles or groups, step by step" },
            { text: "Import: a CSV or an access model file, checked against your tenant first" },
            { text: "Nothing is written until you review and apply; Undo this apply brings it back" },
        ],
        tooltipPosition: "bottom",
    },
];

// ---------------------------------------------------------------------------
// Feature highlights, in-depth spotlight tour for returning users
// Focused on what's new since the last FEATURE_HIGHLIGHTS_VERSION bump.
// ---------------------------------------------------------------------------
export const HIGHLIGHT_STEPS: TourStep[] = [
    {
        id: "hl-configure-basket",
        target: "nav-configure",
        page: "/configure",
        title: "New: Configure collects changes first",
        description: "Edit, Guided and Import put their changes in one basket that you review before anything is written.",
        icon: "configure",
        guides: [
            { text: "The bar at the bottom counts the changes waiting; Leave out takes one out" },
            { text: "The basket stays in this tab through a reload or a permission popup" },
            { text: "Select several and Copy settings to... change many roles or groups at once" },
            { text: "Who has it adds, ends and removes people, and reads the policy of the tenant for the limits" },
        ],
        tooltipPosition: "bottom",
    },
    {
        id: "hl-configure-review",
        target: "nav-configure",
        page: "/configure",
        title: "New: Review, checks and Undo",
        description: "PIM Manager checks the changes before the first write and keeps a snapshot so an apply can be undone.",
        icon: "shield",
        guides: [
            { text: "Every new assignment is validated by Microsoft first; nothing is written by the check" },
            { text: "The review says what changes for the people who activate and what you would lose yourself" },
            { text: "The result shows every change, and the ones that failed can be tried again" },
            { text: "Undo this apply is on the result and on the start page, for the last ten applies" },
        ],
        tooltipPosition: "bottom",
    },
    {
        id: "hl-configure-import",
        target: "nav-configure",
        page: "/configure",
        title: "New: Import and the access model",
        description: "Import reads the files the Report exports, row by row, and the access model gives you a template to start from.",
        icon: "export",
        guides: [
            { text: "A reference lists every column of every file, with a template to download" },
            { text: "Each row says New, Already there, Will be removed or what to fix; settings show Now and then the file" },
            { text: "The access model page sorts all Entra roles into planes and levels with recommended settings" },
            { text: "Use as a template opens Guided with those values; you still review everything" },
        ],
        tooltipPosition: "bottom",
    },
    {
        id: "hl-throttle-aware-client",
        target: "workload-chips",
        page: "/dashboard",
        title: "Improved: Throttle-Aware Graph Client",
        description: "Loading these workloads is now paced by a sliding-window rate limiter that prevents cascading 429 errors.",
        icon: "active",
        guides: [
            { text: "A 500 RU/10s cap matches the Microsoft Graph tenant-level throttle budget" },
            { text: "Retry-After headers are respected: new requests pause automatically when the budget is exhausted" },
            { text: "Eliminates the cascading retry storms that could occur on large tenants" },
            { text: "No configuration needed: the limiter is active by default for all apply operations" },
        ],
        tooltipPosition: "bottom",
    },
    {
        id: "hl-friendly-graph-errors",
        target: "sidebar-help",
        page: "/dashboard",
        title: "Improved: Friendly Graph API Error Messages",
        description: "Raw Graph API error codes are now translated to clear, actionable messages in the apply flow. The Help guide explains each one.",
        icon: "configure",
        guides: [
            { text: "Error codes like RoleAssignmentExists or PolicyViolation show a plain-language explanation" },
            { text: "Actionable guidance is shown alongside each error so you know what to fix" },
            { text: "Applies to every apply in Configure, imports included" },
            { text: "Technical error codes are still logged to the browser console for debugging" },
        ],
        tooltipPosition: "bottom",
    },
];
