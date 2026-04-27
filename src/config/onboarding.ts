import { LucideIcon, Shield, LayoutDashboard, Puzzle, Wrench, FileDown, Filter, Download, Wand2, Settings, FileSpreadsheet } from "lucide-react";

// Manually bumped when there are noteworthy features to announce.
// Not every release needs highlights — only bump when there's something worth showing.
export const FEATURE_HIGHLIGHTS_VERSION = "2.0";

export interface TourGuideItem {
    text: string;
}

export interface TourStep {
    id: string;
    target: string;
    page: string;
    title: string;
    description: string;
    icon: LucideIcon;
    guides: TourGuideItem[];
    tooltipPosition?: "top" | "bottom" | "left" | "right";
}

// ---------------------------------------------------------------------------
// First-time onboarding tour — broad overview for brand new users
// ---------------------------------------------------------------------------
export const ONBOARDING_STEPS: TourStep[] = [
    // -- Dashboard --
    {
        id: "welcome",
        target: "app-title",
        page: "/dashboard",
        title: "Welcome to PIM Manager",
        description: "Let\u2019s take a quick tour of the key areas.",
        icon: Shield,
        guides: [
            { text: "PIM Manager runs entirely in your browser \u2014 no data leaves your session" },
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
        icon: LayoutDashboard,
        guides: [
            { text: "Toggle between Basic and Advanced view for more or less detail" },
            { text: "Click any stat card to jump to a filtered report" },
            { text: "Charts and stats update as you enable more workloads" },
        ],
        tooltipPosition: "bottom",
    },
    {
        id: "workloads",
        target: "workload-chips",
        page: "/dashboard",
        title: "Workloads & Consent",
        description: "PIM Manager uses incremental consent to access your data.",
        icon: Puzzle,
        guides: [
            { text: "Directory Roles load automatically after sign-in" },
            { text: "PIM Groups, Security Alerts and other workloads need additional consent" },
            { text: "Enable or disable workloads anytime via Settings or the workload chips" },
            { text: "Consent is remembered \u2014 workloads stay enabled across sessions" },
        ],
        tooltipPosition: "bottom",
    },
    {
        id: "dashboard-export",
        target: "dashboard-export-pdf",
        page: "/dashboard",
        title: "Dashboard PDF Export",
        description: "Share your security posture with stakeholders.",
        icon: FileDown,
        guides: [
            { text: "Export the full dashboard as a PDF report" },
            { text: "Choose which sections to include (charts, tables, stats)" },
            { text: "Includes your current view mode and workload selection" },
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
        icon: Filter,
        guides: [
            { text: "Filter by role type, assignment type, MFA, approval, scope, and more" },
            { text: "Search by role name or assigned user" },
            { text: "Active filters are shown as count \u2014 click Reset to clear all" },
        ],
        tooltipPosition: "bottom",
    },
    {
        id: "report-export",
        target: "report-export",
        page: "/report",
        title: "Report Export",
        description: "Get your data out of PIM Manager.",
        icon: Download,
        guides: [
            { text: "Export filtered results as CSV for analysis in Excel" },
            { text: "Export as JSON for automation or integration" },
            { text: "Only your currently visible and filtered data is exported" },
        ],
        tooltipPosition: "bottom",
    },
    // -- Configure --
    {
        id: "configure-modes",
        target: "configure-modes",
        page: "/configure",
        title: "Configure at Scale",
        description: "Three modes for different workflows.",
        icon: Wrench,
        guides: [
            { text: "Wizard \u2014 step-by-step guided flow with validation and preview" },
            { text: "Manual \u2014 direct access to individual role and group settings" },
            { text: "Bulk \u2014 upload a CSV to configure many roles at once" },
            { text: "Write permissions are only requested when you enter configure mode" },
        ],
        tooltipPosition: "bottom",
    },
];

// ---------------------------------------------------------------------------
// Feature highlights — in-depth spotlight tour for returning users
// Focused on what's new since the last FEATURE_HIGHLIGHTS_VERSION bump.
// ---------------------------------------------------------------------------
export const HIGHLIGHT_STEPS: TourStep[] = [
    {
        id: "hl-configure-intro",
        target: "configure-modes",
        page: "/configure",
        title: "New: Configure PIM at Scale",
        description: "The biggest addition to PIM Manager \u2014 a full configuration engine with three modes.",
        icon: Wrench,
        guides: [
            { text: "Wizard \u2014 guided step-by-step flow with backup, preview, and per-rule progress tracking" },
            { text: "Manual \u2014 direct policy and assignment management with a staged changes workflow" },
            { text: "Bulk \u2014 upload a CSV to configure many roles or groups at once, with compare view and selective apply" },
            { text: "Write permissions are requested only when you enter Configure \u2014 not at login" },
            { text: "Your account needs Privileged Role Administrator or equivalent to apply changes" },
        ],
        tooltipPosition: "bottom",
    },
    {
        id: "hl-pim-groups",
        target: "workload-chips",
        page: "/dashboard",
        title: "New: PIM Groups Workload",
        description: "Enable the PIM Groups workload to manage group-based privileged access alongside Directory Roles.",
        icon: Puzzle,
        guides: [
            { text: "Click the PIM Groups chip to grant consent and load group data" },
            { text: "Member and Owner policies are managed separately per group" },
            { text: "Dashboard and Report pages show unified stats across both workloads once enabled" },
            { text: "Consent is remembered across sessions \u2014 you only need to grant it once" },
        ],
        tooltipPosition: "bottom",
    },
    {
        id: "hl-pdf-export",
        target: "dashboard-export-pdf",
        page: "/dashboard",
        title: "New: Dashboard PDF Export",
        description: "Export a polished PDF report of your PIM security posture for stakeholders and compliance.",
        icon: FileDown,
        guides: [
            { text: "Choose which sections to include: stat cards, charts, and assignment tables" },
            { text: "Metadata such as tenant ID, user, and report timestamp are included automatically" },
            { text: "Export reflects your current workload selection and view mode" },
            { text: "Useful for periodic governance reviews or audit evidence" },
        ],
        tooltipPosition: "bottom",
    },
    {
        id: "hl-report-filters",
        target: "report-filters",
        page: "/report",
        title: "Improved: Advanced Report Filtering",
        description: "Multi-select filters let you slice your assignment data precisely across all workloads.",
        icon: Filter,
        guides: [
            { text: "Filter by role type, assignment type, MFA requirement, approval, scope, and more" },
            { text: "Select multiple values simultaneously for each filter dimension" },
            { text: "Active filter count is shown on the button \u2014 click Reset to clear all at once" },
            { text: "Filters apply across both Directory Roles and PIM Groups in a single view" },
        ],
        tooltipPosition: "bottom",
    },
];
