import { LucideIcon, Shield, LayoutDashboard, Puzzle, Wrench, FileDown, Filter, Download, Wand2, Settings, FileSpreadsheet, AlertTriangle, Zap } from "lucide-react";

// Manually bumped when there are noteworthy features to announce.
// Not every release needs highlights — only bump when there's something worth showing.
export const FEATURE_HIGHLIGHTS_VERSION = "2.1";

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
        id: "hl-policy-preflight",
        target: "configure-modes",
        page: "/configure",
        title: "New: Policy Preflight Validation",
        description: "PIM Manager now catches incoherent settings before any write is attempted.",
        icon: AlertTriangle,
        guides: [
            { text: "Approval enabled without approvers configured is flagged before you apply" },
            { text: "Activation duration exceeding the max assignment duration is detected and shown inline" },
            { text: "Conflicting constraint combinations are surfaced as warnings in the configure flow" },
            { text: "Preflight runs automatically in Wizard and Manual mode before the apply step" },
            { text: "Fixing a warning is optional but recommended to avoid Graph API rejections" },
        ],
        tooltipPosition: "bottom",
    },
    {
        id: "hl-policy-conflict-detection",
        target: "configure-modes",
        page: "/configure",
        title: "New: Policy Conflict Detection",
        description: "Existing assignments that would violate a pending policy change are now identified before apply.",
        icon: Shield,
        guides: [
            { text: "Active assignments exceeding a new max eligible duration are surfaced at Review step" },
            { text: "Conflicts are shown per-assignment so you can decide whether to proceed" },
            { text: "Apply step repeats conflict warnings before executing writes" },
            { text: "Works for both Directory Roles and PIM Groups in Wizard and Manual mode" },
            { text: "No change is blocked outright: you retain full control over what gets applied" },
        ],
        tooltipPosition: "bottom",
    },
    {
        id: "hl-throttle-aware-client",
        target: "configure-modes",
        page: "/configure",
        title: "Improved: Throttle-Aware Graph Client",
        description: "A sliding-window rate limiter now wraps all Graph API calls to prevent cascading 429 errors.",
        icon: Zap,
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
        target: "configure-modes",
        page: "/configure",
        title: "Improved: Friendly Graph API Error Messages",
        description: "Raw Graph API error codes are now translated to clear, actionable messages in the apply flow.",
        icon: Wrench,
        guides: [
            { text: "Error codes like RoleAssignmentExists or PolicyViolation show a plain-language explanation" },
            { text: "Actionable guidance is shown alongside each error so you know what to fix" },
            { text: "Applies to all apply operations in Wizard, Manual, and Bulk modes" },
            { text: "Technical error codes are still logged to the browser console for debugging" },
        ],
        tooltipPosition: "bottom",
    },
];
