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
        description: "The biggest addition to PIM Manager \u2014 a full configuration engine.",
        icon: Wrench,
        guides: [
            { text: "Apply PIM policies and create assignments across many roles or groups at once" },
            { text: "Three distinct modes to match your workflow: Wizard, Manual, or Bulk" },
            { text: "Write permissions are requested only when you enter configure mode \u2014 not on login" },
            { text: "Your admin account needs appropriate PIM roles (e.g. Privileged Role Administrator)" },
        ],
        tooltipPosition: "bottom",
    },
    {
        id: "hl-wizard",
        target: "configure-mode-wizard",
        page: "/configure",
        title: "Wizard Mode",
        description: "Guided step-by-step configuration with validation at each stage.",
        icon: Wand2,
        guides: [
            { text: "Starts with a backup prompt \u2014 download your current config as JSON before making changes" },
            { text: "Select which workloads (Directory Roles, PIM Groups) and what to configure (policies, assignments, or both)" },
            { text: "Pick specific roles or groups, then configure activation rules, assignment rules, and notifications" },
            { text: "Review all changes in a diff-style preview before applying anything" },
            { text: "Best for: first-time configuration or applying changes across multiple roles at once" },
        ],
        tooltipPosition: "right",
    },
    {
        id: "hl-manual",
        target: "configure-mode-manual",
        page: "/configure",
        title: "Manual Mode",
        description: "Direct access to individual role and group settings.",
        icon: Settings,
        guides: [
            { text: "Select a role or group \u2014 its current PIM policy loads automatically" },
            { text: "Edit activation rules (MFA, approval, justification, max duration) directly" },
            { text: "Stage changes across multiple roles, then apply them all in one batch" },
            { text: "Create or remove eligible and active assignments from the same view" },
            { text: "Best for: targeted changes when you know exactly what to adjust" },
        ],
        tooltipPosition: "right",
    },
    {
        id: "hl-bulk",
        target: "configure-mode-bulk",
        page: "/configure",
        title: "Bulk Mode",
        description: "Upload a CSV to configure many roles or groups at once.",
        icon: FileSpreadsheet,
        guides: [
            { text: "Supports 4 CSV types: Role Policies, Group Policies, Role Assignments, and Group Assignments" },
            { text: "CSV type is auto-detected from column headers \u2014 no manual selection needed" },
            { text: "Compare view shows a side-by-side diff of current vs. proposed settings" },
            { text: "Select which rows to apply \u2014 skip rows you want to leave unchanged" },
            { text: "Best for: applying an exported baseline or managing configuration as code" },
        ],
        tooltipPosition: "right",
    },
];
