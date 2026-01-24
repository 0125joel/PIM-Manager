"use client";

import { useState, useMemo } from "react";
import { X, BookOpen, FileText, ChevronDown, ChevronRight, Search, User, Tag, Shield, Filter, Download, Users as UsersIcon, Settings, Info, LayoutDashboard, AlertTriangle, FileDown, HelpCircle } from "lucide-react";
import { HELP_CONTENT } from "@/config/locales/en";

interface HelpModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function HelpModal({ isOpen, onClose }: HelpModalProps) {
    const [activeTab, setActiveTab] = useState<"getting-started" | "dashboard" | "reports" | "settings">("getting-started");
    const [searchQuery, setSearchQuery] = useState("");

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
            <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-xl max-w-4xl w-full mx-4 h-[80vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="p-6 border-b border-zinc-200 dark:border-zinc-800 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <BookOpen className="h-6 w-6 text-blue-600" />
                        <h2 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Help</h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                    >
                        <X className="h-6 w-6" />
                    </button>
                </div>

                {/* Tabs */}
                <div className="border-b border-zinc-200 dark:border-zinc-800 px-6">
                    <div className="flex gap-1 overflow-x-auto" role="tablist">
                        <button
                            onClick={() => setActiveTab("getting-started")}
                            role="tab"
                            aria-selected={activeTab === "getting-started"}
                            title="Getting started"
                            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === "getting-started"
                                ? "border-blue-500 text-blue-600 dark:text-blue-400"
                                : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                                }`}
                        >
                            Getting started
                        </button>
                        <button
                            onClick={() => setActiveTab("settings")}
                            role="tab"
                            aria-selected={activeTab === "settings"}
                            title="Settings"
                            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === "settings"
                                ? "border-blue-500 text-blue-600 dark:text-blue-400"
                                : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                                }`}
                        >
                            Settings
                        </button>
                        <button
                            onClick={() => setActiveTab("dashboard")}
                            role="tab"
                            aria-selected={activeTab === "dashboard"}
                            title="Dashboard"
                            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === "dashboard"
                                ? "border-blue-500 text-blue-600 dark:text-blue-400"
                                : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                                }`}
                        >
                            Dashboard
                        </button>
                        <button
                            onClick={() => setActiveTab("reports")}
                            role="tab"
                            aria-selected={activeTab === "reports"}
                            title="Report page"
                            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === "reports"
                                ? "border-blue-500 text-blue-600 dark:text-blue-400"
                                : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                                }`}
                        >
                            Report page
                        </button>
                    </div>
                </div>

                {/* Search Bar */}
                <div className="px-6 py-3 border-b border-zinc-200 dark:border-zinc-800">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" aria-hidden="true" />
                        <input
                            type="text"
                            placeholder="Search help content..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            aria-label="Search help content"
                        />
                        {searchQuery && (
                            <button
                                onClick={() => setSearchQuery("")}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
                                aria-label="Clear search"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        )}
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 p-6 overflow-y-auto">
                    {activeTab === "getting-started" && <GettingStarted />}
                    {activeTab === "dashboard" && <DashboardHelp />}
                    {activeTab === "reports" && <ReportsHelp />}
                    {activeTab === "settings" && <SettingsHelp />}
                </div>
            </div>
        </div>
    );
}

function DashboardHelp() {
    return (
        <div className="space-y-6 max-w-3xl">
            <div>
                <h3 className="text-xl font-semibold mb-2 text-zinc-900 dark:text-zinc-100">💻 Security Dashboard Guide</h3>
                <p className="text-zinc-600 dark:text-zinc-400">
                    Your central hub for monitoring PIM status, security alerts, and role details.
                </p>
            </div>

            <CollapsibleSection
                title="View Modes"
                icon={<LayoutDashboard className="h-5 w-5" />}
            >
                <div className="space-y-3">
                    <p className="text-sm text-zinc-700 dark:text-zinc-300">
                        Toggle between two view modes using the switch in the top right:
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                            <h5 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-1">Basic View</h5>
                            <p className="text-sm text-zinc-600 dark:text-zinc-400">
                                Focuses on high-level security alerts and a simplified role list. Ideal for quick status checks.
                            </p>
                        </div>
                        <div className="p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                            <h5 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-1">Advanced View</h5>
                            <p className="text-sm text-zinc-600 dark:text-zinc-400">
                                Displays detailed assignment metrics, recent activations, configuration errors, and expiring assignments.
                            </p>
                        </div>
                    </div>
                </div>
            </CollapsibleSection>

            <CollapsibleSection
                title={HELP_CONTENT.dashboard.securityAlerts.title}
                icon={<AlertTriangle className="h-5 w-5" />}
            >
                <p className="text-sm text-zinc-700 dark:text-zinc-300 mb-4">
                    {HELP_CONTENT.dashboard.securityAlerts.description}
                </p>
                <ul className="space-y-2 text-sm text-zinc-600 dark:text-zinc-400 list-disc ml-4">
                    {HELP_CONTENT.dashboard.securityAlerts.items.map((item, i) => (
                        <li key={i}>{item}</li>
                    ))}
                </ul>
                <div className="mt-4 flex items-center gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300 rounded text-sm">
                    <Info className="h-4 w-4" />
                    <span>{HELP_CONTENT.dashboard.securityAlerts.note}</span>
                </div>
            </CollapsibleSection>

            <CollapsibleSection
                title="Role Overview & Navigation"
                icon={<Shield className="h-5 w-5" />}
            >
                <p className="text-sm text-zinc-700 dark:text-zinc-300 mb-4">
                    The Role Overview list provides a quick summary of your roles.
                </p>
                <div className="space-y-3">
                    <div className="flex items-start gap-3 p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                        <div className="mt-1 bg-white dark:bg-zinc-700 p-1 rounded shadow-sm">
                            <ChevronRight className="h-4 w-4 text-zinc-400" />
                        </div>
                        <div>
                            <h5 className="font-medium text-sm text-zinc-900 dark:text-zinc-100">Drill-down navigation</h5>
                            <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">
                                Click on any role in the list (or the arrow icon) to instantly navigate to the <strong>Report Page</strong> with that role selected. This allows you to immediately view the role's deep configuration details.
                            </p>
                        </div>
                    </div>
                    <div className="flex items-start gap-3 p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                        <Search className="h-5 w-5 text-zinc-400 mt-1" />
                        <div>
                            <h5 className="font-medium text-sm text-zinc-900 dark:text-zinc-100">Quick filter</h5>
                            <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">
                                Use the dropdown to filter the list by "Privileged Only" or "PIM Configured" roles.
                            </p>
                        </div>
                    </div>
                </div>
            </CollapsibleSection>

            <CollapsibleSection
                title="PDF export"
                icon={<FileDown className="h-5 w-5" />}
            >
                <p className="text-sm text-zinc-700 dark:text-zinc-300 mb-4">
                    Export your dashboard data as a customizable PDF report.
                </p>
                <div className="space-y-3">
                    <div className="flex items-start gap-3 p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                        <Settings className="h-5 w-5 text-zinc-400 mt-1" />
                        <div>
                            <h5 className="font-medium text-sm text-zinc-900 dark:text-zinc-100">Customizable sections</h5>
                            <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">
                                Toggle which sections to include: Overview Summary, Assignment Distribution, MFA & CA Enforcement, and more.
                            </p>
                        </div>
                    </div>
                    <div className="flex items-start gap-3 p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                        <FileText className="h-5 w-5 text-zinc-400 mt-1" />
                        <div>
                            <h5 className="font-medium text-sm text-zinc-900 dark:text-zinc-100">Charts & data tables</h5>
                            <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">
                                Include chart images and/or data tables. <strong>Data tables have selectable text</strong> for easy copy/paste.
                            </p>
                        </div>
                    </div>

                </div>
            </CollapsibleSection>

            <CollapsibleSection
                title="Unmanaged Groups"
                icon={<AlertTriangle className="h-5 w-5" />}
            >
                <div className="space-y-3">
                    <p className="text-sm text-zinc-700 dark:text-zinc-300">
                        <strong>Unmanaged Groups</strong> are security groups or M365 groups that are capable of having roles assigned to them (isAssignableToRole=true) but are <strong>not yet managed by PIM</strong>.
                    </p>
                    <p className="text-sm text-zinc-700 dark:text-zinc-300">
                        These enable you to identify potential blind spots in your security configuration. Enable them via the <strong>View Chips</strong> at the top of the dashboard.
                    </p>
                </div>
            </CollapsibleSection>

            <CollapsibleSection
                title="View Chips"
                icon={<LayoutDashboard className="h-5 w-5" />}
            >
                <div className="space-y-3">
                    <p className="text-sm text-zinc-700 dark:text-zinc-300">
                        The chip bar on the Dashboard lets you quickly toggle which data is visible:
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="p-2 bg-zinc-50 dark:bg-zinc-800/50 rounded flex items-center gap-2">
                            <span className="w-3 h-3 rounded-full bg-blue-500"></span>
                            <span className="text-sm font-medium">Directory Roles</span>
                        </div>
                        <div className="p-2 bg-zinc-50 dark:bg-zinc-800/50 rounded flex items-center gap-2">
                            <span className="w-3 h-3 rounded-full bg-emerald-500"></span>
                            <span className="text-sm font-medium">PIM Groups</span>
                        </div>
                        <div className="p-2 bg-zinc-50 dark:bg-zinc-800/50 rounded flex items-center gap-2">
                            <span className="w-3 h-3 rounded-full bg-amber-500"></span>
                            <span className="text-sm font-medium">Unmanaged Groups</span>
                        </div>
                        <div className="p-2 bg-zinc-50 dark:bg-zinc-800/50 rounded flex items-center gap-2">
                            <span className="w-3 h-3 rounded-full bg-red-500"></span>
                            <span className="text-sm font-medium">Security Alerts</span>
                        </div>
                    </div>
                    <ul className="space-y-1 text-sm text-zinc-600 dark:text-zinc-400 list-disc ml-4">
                        <li><strong>Click a chip</strong> to hide/show that workload's data.</li>
                        <li><strong>Grayed chips</strong> indicate hidden data.</li>
                        <li>Data for hidden chips is still fetched but not displayed.</li>
                    </ul>
                </div>
            </CollapsibleSection>
        </div>
    );
}

function GettingStarted() {
    return (
        <div className="space-y-6 max-w-3xl">
            <div>
                <h3 className="text-xl font-semibold mb-2 text-zinc-900 dark:text-zinc-100">Welcome to PIM Manager</h3>
                <p className="text-zinc-600 dark:text-zinc-400">
                    View and analyze your Entra ID roles, PIM policies, and role assignments in one place.
                </p>
            </div>

            <CollapsibleSection
                title={HELP_CONTENT.gettingStarted.auth.title}
                icon={<Shield className="h-5 w-5" aria-hidden="true" />}
            >
                <p className="text-sm text-zinc-700 dark:text-zinc-300 mb-3">
                    {HELP_CONTENT.gettingStarted.auth.description}
                </p>

                {/* Core Permissions (Always Required) */}
                <h5 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-2">Core Permissions</h5>
                <div className="grid grid-cols-1 gap-2 text-sm mb-4">
                    <PermissionItem code="User.Read" description="Read your profile" />
                    <PermissionItem code="RoleManagement.Read.Directory" description="Read role definitions" />
                    <PermissionItem code="RoleAssignmentSchedule.Read.Directory" description="Read PIM active assignments" />
                    <PermissionItem code="RoleEligibilitySchedule.Read.Directory" description="Read PIM eligible assignments" />
                    <PermissionItem code="RoleManagementPolicy.Read.Directory" description="Read PIM policies" />
                    <PermissionItem code="Policy.Read.ConditionalAccess" description="Read authentication contexts" />
                    <PermissionItem code="User.Read.All" description="Read user display names" />
                    <PermissionItem code="Group.Read.All" description="Read group display names" />
                    <PermissionItem code="AdministrativeUnit.Read.All" description="Read administrative unit names" />
                    <PermissionItem code="Application.Read.All" description="Read application names" />
                </div>

                {/* Optional Permissions */}
                <h5 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-2 flex items-center gap-2">
                    Optional Permissions
                    <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">(only needed if you enable these workloads)</span>
                </h5>
                <div className="grid grid-cols-1 gap-2 text-sm">
                    <PermissionItem code="PrivilegedAccess.Read.AzureADGroup" description="PIM for Groups assignments" optional />
                    <PermissionItem code="PrivilegedAccess.Read.AzureAD" description="Security Alerts" optional />
                </div>

                <TipBox>
                    {HELP_CONTENT.gettingStarted.auth.tip}
                </TipBox>
            </CollapsibleSection>

            <CollapsibleSection
                title="Navigation"
                icon={<FileText className="h-5 w-5" />}
            >
                <div className="space-y-3">
                    <div className="flex items-start gap-3">
                        <div className="mt-0.5">
                            <LayoutDashboard className="h-5 w-5 text-blue-600" />
                        </div>
                        <div>
                            <h5 className="font-medium text-zinc-900 dark:text-zinc-100">Dashboard</h5>
                            <p className="text-sm text-zinc-600 dark:text-zinc-400">
                                Your central hub for monitoring PIM status, security alerts, and role overview.
                            </p>
                        </div>
                    </div>
                    <div className="flex items-start gap-3">
                        <div className="mt-0.5">
                            <FileText className="h-5 w-5 text-blue-600" />
                        </div>
                        <div>
                            <h5 className="font-medium text-zinc-900 dark:text-zinc-100">{HELP_CONTENT.gettingStarted.navigation.report.title}</h5>
                            <p className="text-sm text-zinc-600 dark:text-zinc-400">
                                {HELP_CONTENT.gettingStarted.navigation.report.description}
                            </p>
                        </div>
                    </div>
                </div>
            </CollapsibleSection>

            <CollapsibleSection
                title="Troubleshooting"
                icon={<HelpCircle className="h-5 w-5" aria-hidden="true" />}
            >
                <div className="space-y-3">
                    <p className="text-sm text-zinc-700 dark:text-zinc-300 mb-3">
                        Common issues and how to resolve them:
                    </p>
                    <div className="space-y-3">
                        <TroubleshootItem
                            problem={'Fetching role configuration stays at 0%'}
                            solution="API throttling or network issues. Wait 2-3 minutes, then click Refresh. Check browser console (F12) for 429 errors."
                        />
                        <TroubleshootItem
                            problem={'Roles show but policies say Loading...'}
                            solution="Background policy fetch is in progress. Wait for the progress indicator (17/135) to complete."
                        />
                        <TroubleshootItem
                            problem={'Access Denied error'}
                            solution="Missing permissions. Ask your admin to grant the required scopes in Microsoft Entra Admin Center."
                        />
                        <TroubleshootItem
                            problem="Data seems outdated"
                            solution="Cache not refreshed. Click the Refresh button or wait 5 minutes for automatic cache expiry."
                        />
                        <TroubleshootItem
                            problem="Security Alerts section is empty"
                            solution="Feature not enabled. Go to Settings, then Workloads, and enable Security Alerts."
                        />
                    </div>
                </div>
            </CollapsibleSection>

            <TipBox>
                <strong>Smart Refresh:</strong> After the initial load, PIM Manager uses differential queries to fetch only what has changed, making subsequent updates significantly faster.
            </TipBox>
        </div>
    );
}

function ReportsHelp() {
    return (
        <div className="space-y-6 max-w-3xl">
            <div>
                <h3 className="text-xl font-semibold mb-2 text-zinc-900 dark:text-zinc-100">📊 Report Page Guide</h3>
                <p className="text-zinc-600 dark:text-zinc-400">
                    Comprehensive view of all Entra ID roles with real-time loading and progressive rendering.
                </p>
            </div>

            <CollapsibleSection
                title={HELP_CONTENT.reports.filtering.title}
                icon={<Search className="h-5 w-5" />}
            >
                <p className="text-sm text-zinc-700 dark:text-zinc-300 mb-4">
                    {HELP_CONTENT.reports.filtering.description}
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <FilterItem icon={<Search className="h-4 w-4" />} label="Search" description={HELP_CONTENT.reports.filtering.items.search} />
                    <FilterItem icon={<User className="h-4 w-4" />} label="User" description={HELP_CONTENT.reports.filtering.items.user} />
                    <FilterItem icon={<Tag className="h-4 w-4" />} label="Role Type" description={HELP_CONTENT.reports.filtering.items.roleType} />
                    <FilterItem icon={<Shield className="h-4 w-4" />} label="Privileged" description={HELP_CONTENT.reports.filtering.items.privileged} />
                    <FilterItem icon={<Filter className="h-4 w-4" />} label="Assignment Type" description={HELP_CONTENT.reports.filtering.items.assignmentType} />
                    <FilterItem icon={<UsersIcon className="h-4 w-4" />} label="Assignment Method" description={HELP_CONTENT.reports.filtering.items.assignmentMethod} />
                </div>
                <TipBox>
                    {HELP_CONTENT.reports.filtering.tip}
                </TipBox>
            </CollapsibleSection>

            <CollapsibleSection
                title="Understanding badges & status"
                icon={<Tag className="h-5 w-5" />}
            >
                <p className="text-sm text-zinc-700 dark:text-zinc-300 mb-4">
                    Roles display badges to indicate their status:
                </p>
                <div className="space-y-3">
                    <BadgeExample
                        badge={<span className="px-2 py-0.5 text-xs rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400">Built-in</span>}
                        description="Standard Entra ID roles"
                    />
                    <BadgeExample
                        badge={<span className="px-2 py-0.5 text-xs rounded bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 flex items-center gap-1 w-fit"><Shield className="h-3 w-3" />Privileged</span>}
                        description="High-impact roles requiring extra security"
                    />
                    <BadgeExample
                        badge={<span className="px-2 py-0.5 text-xs rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">PIM configured</span>}
                        description="Role has an active PIM policy"
                    />
                </div>
            </CollapsibleSection>

            <CollapsibleSection
                title="Viewing role details"
                icon={<Info className="h-5 w-5" />}
            >
                <p className="text-sm text-zinc-700 dark:text-zinc-300 mb-4">
                    Click any role card to expand and view detailed information:
                </p>
                <div className="space-y-4">
                    <DetailSection
                        icon={<UsersIcon className="h-5 w-5 text-blue-600" />}
                        title="Role assignments"
                        description="View all users and groups assigned to this role, including permanent, eligible, and active assignments."
                    />
                    <DetailSection
                        icon={<Settings className="h-5 w-5 text-blue-600" />}
                        title="Role configuration"
                        description="PIM policy settings organized into tabs:"
                        items={[
                            { label: "Activation", detail: "Max duration, MFA, approval workflows, approvers" },
                            { label: "Assignment", detail: "Expiration settings for eligible and active assignments" },
                            { label: "Notification", detail: "Email notifications table with recipients and critical status" }
                        ]}
                    />
                </div>
            </CollapsibleSection>

            <CollapsibleSection
                title="Assignment types explained"
                icon={<UsersIcon className="h-5 w-5" />}
            >
                <div className="space-y-4">
                    <div>
                        <h5 className="font-medium text-sm mb-2 text-zinc-900 dark:text-zinc-100">{HELP_CONTENT.reports.assignmentTypes.method.title}</h5>
                        <div className="space-y-2 text-sm">
                            <AssignmentType
                                badge={<span className="px-2 py-0.5 rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs">Direct</span>}
                                description={HELP_CONTENT.reports.assignmentTypes.method.direct}
                            />
                            <AssignmentType
                                badge={<span className="px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-xs">Via group</span>}
                                description={HELP_CONTENT.reports.assignmentTypes.method.group}
                            />
                        </div>
                    </div>
                    <div>
                        <h5 className="font-medium text-sm mb-2 text-zinc-900 dark:text-zinc-100">{HELP_CONTENT.reports.assignmentTypes.duration.title}</h5>
                        <div className="space-y-2 text-sm">
                            <AssignmentType
                                badge={<span className="text-zinc-600 dark:text-zinc-400 text-xs">Permanent</span>}
                                description={HELP_CONTENT.reports.assignmentTypes.duration.permanent}
                            />
                            <AssignmentType
                                badge={<span className="text-zinc-600 dark:text-zinc-400 text-xs">Time-bound</span>}
                                description={HELP_CONTENT.reports.assignmentTypes.duration.timeBound}
                            />
                        </div>
                    </div>
                </div>
            </CollapsibleSection>

            <CollapsibleSection
                title="Exporting data"
                icon={<Download className="h-5 w-5" />}
            >
                <p className="text-sm text-zinc-700 dark:text-zinc-300 mb-3">
                    Export filtered data for external analysis:
                </p>
                <div className="space-y-2">
                    <ExportOption
                        format="JSON"
                        description="Full structured data including policies and rules"
                    />
                    <ExportOption
                        format="PDF"
                        description="Professional report with security alerts, charts, and executive summaries"
                    />
                    <ExportOption
                        format="CSV"
                        description="Flat list with summary counts and status flags"
                    />
                </div>
            </CollapsibleSection>
        </div>
    );
}

// Helper Components

function CollapsibleSection({ title, icon, children, defaultOpen = false }: {
    title: string;
    icon: React.ReactNode;
    children: React.ReactNode;
    defaultOpen?: boolean;
}) {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    return (
        <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between p-4 bg-zinc-50 dark:bg-zinc-800/50 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
                <div className="flex items-center gap-3">
                    <div className="text-blue-600 dark:text-blue-400">
                        {icon}
                    </div>
                    <h4 className="font-semibold text-zinc-900 dark:text-zinc-100">{title}</h4>
                </div>
                {isOpen ? (
                    <ChevronDown className="h-5 w-5 text-zinc-500" />
                ) : (
                    <ChevronRight className="h-5 w-5 text-zinc-500" />
                )}
            </button>
            {isOpen && (
                <div className="p-4 bg-white dark:bg-zinc-900">
                    {children}
                </div>
            )}
        </div>
    );
}

function PermissionItem({ code, description, optional }: { code: string; description: string; optional?: boolean }) {
    return (
        <div className="flex items-start gap-2 p-2 rounded bg-zinc-50 dark:bg-zinc-800/50">
            <code className="text-xs font-mono text-blue-600 dark:text-blue-400 mt-0.5">{code}</code>
            <span className="text-zinc-600 dark:text-zinc-400">- {description}</span>
            {optional && (
                <span className="ml-auto text-xs px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">Optional</span>
            )}
        </div>
    );
}

function TipBox({ children }: { children: React.ReactNode }) {
    return (
        <div className="mt-4 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
            <div className="flex items-start gap-2">
                <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-blue-900 dark:text-blue-200">{children}</p>
            </div>
        </div>
    );
}

function FilterItem({ icon, label, description }: { icon: React.ReactNode; label: string; description: string }) {
    return (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50">
            <div className="text-blue-600 dark:text-blue-400 mt-0.5">
                {icon}
            </div>
            <div>
                <div className="font-medium text-sm text-zinc-900 dark:text-zinc-100">{label}</div>
                <div className="text-xs text-zinc-600 dark:text-zinc-400">{description}</div>
            </div>
        </div>
    );
}

function BadgeExample({ badge, description }: { badge: React.ReactNode; description: string }) {
    return (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50">
            {badge}
            <span className="text-sm text-zinc-600 dark:text-zinc-400">{description}</span>
        </div>
    );
}

function DetailSection({ icon, title, description, items }: {
    icon: React.ReactNode;
    title: string;
    description: string;
    items?: { label: string; detail: string }[];
}) {
    return (
        <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50">
            <div className="flex items-start gap-3 mb-2">
                {icon}
                <div>
                    <h5 className="font-medium text-sm text-zinc-900 dark:text-zinc-100">{title}</h5>
                    <p className="text-sm text-zinc-600 dark:text-zinc-400">{description}</p>
                </div>
            </div>
            {items && (
                <ul className="ml-8 mt-2 space-y-1 text-sm">
                    {items.map((item, idx) => (
                        <li key={idx} className="text-zinc-600 dark:text-zinc-400">
                            <strong className="text-zinc-900 dark:text-zinc-100">{item.label}:</strong> {item.detail}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function AssignmentType({ badge, description }: { badge: React.ReactNode; description: string }) {
    return (
        <div className="flex items-center gap-3 p-2 rounded bg-zinc-50 dark:bg-zinc-800/50">
            {badge}
            <span className="text-zinc-600 dark:text-zinc-400">{description}</span>
        </div>
    );
}

function ExportOption({ format, description }: { format: string; description: string }) {
    return (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50">
            <Download className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5" />
            <div>
                <div className="font-medium text-sm text-zinc-900 dark:text-zinc-100">Export {format}</div>
                <div className="text-xs text-zinc-600 dark:text-zinc-400">{description}</div>
            </div>
        </div>
    );
}

function SettingsHelp() {
    return (
        <div className="space-y-6 max-w-3xl">
            <div>
                <h3 className="text-xl font-semibold mb-2 text-zinc-900 dark:text-zinc-100">⚙️ Settings Guide</h3>
                <p className="text-zinc-600 dark:text-zinc-400">
                    Manage workloads, enable optional features, and control what data is displayed.
                </p>
            </div>

            <CollapsibleSection
                title="Workloads"
                icon={<Shield className="h-5 w-5" />}
            >
                <div className="space-y-3">
                    <p className="text-sm text-zinc-700 dark:text-zinc-300">
                        Workloads are the data sources that PIM Manager can read from your tenant.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                            <h5 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-1">Directory Roles</h5>
                            <p className="text-sm text-zinc-600 dark:text-zinc-400">
                                Core workload. Always enabled. Shows Entra ID Directory Role assignments and PIM policies.
                            </p>
                        </div>
                        <div className="p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                            <h5 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-1">PIM for Groups</h5>
                            <p className="text-sm text-zinc-600 dark:text-zinc-400">
                                Optional. Shows PIM-eligible group memberships.<br />
                                <span className="text-xs italic mt-1 block">Enabling this also allows detection of <strong>Unmanaged Groups</strong>.</span>
                            </p>
                        </div>
                        <div className="p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                            <h5 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-1">Security Alerts</h5>
                            <p className="text-sm text-zinc-600 dark:text-zinc-400">
                                Optional. Displays PIM security alerts (roles without MFA, stale accounts, etc.).
                            </p>
                        </div>
                    </div>
                </div>
            </CollapsibleSection>

            <CollapsibleSection
                title="Hide vs. Disable"
                icon={<Settings className="h-5 w-5" />}
            >
                <div className="space-y-3">
                    <p className="text-sm text-zinc-700 dark:text-zinc-300">
                        There are two ways to control workloads and features:
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border-l-4 border-blue-500">
                            <h5 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-1">Hide</h5>
                            <p className="text-sm text-zinc-600 dark:text-zinc-400">
                                Hides from UI only. Permission remains granted. Data is still fetched but not shown.
                            </p>
                        </div>
                        <div className="p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border-l-4 border-red-500">
                            <h5 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-1">Disable</h5>
                            <p className="text-sm text-zinc-600 dark:text-zinc-400">
                                Stops data fetching. To fully revoke permission, visit the Entra Admin Center.
                            </p>
                        </div>
                    </div>
                </div>
            </CollapsibleSection>


        </div>
    );
}

function TroubleshootItem({ problem, solution }: { problem: string; solution: string }) {
    return (
        <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 border-l-4 border-amber-500">
            <h6 className="font-medium text-sm text-zinc-900 dark:text-zinc-100 mb-1">{problem}</h6>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{solution}</p>
        </div>
    );
}
