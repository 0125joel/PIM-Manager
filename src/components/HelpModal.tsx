"use client";

import { useState } from "react";
import { X, BookOpen, FileText, ChevronDown, ChevronRight, Search, User, Tag, Shield, Filter, Download, Users as UsersIcon, Settings, Info, LayoutDashboard, AlertTriangle, FileDown, HelpCircle, Wrench, Wand2, FileSpreadsheet, Calendar } from "lucide-react";
import { format } from "date-fns";
import { HELP_CONTENT } from "@/config/locales/en";

interface HelpModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function HelpModal({ isOpen, onClose }: HelpModalProps) {
    const [activeTab, setActiveTab] = useState<"getting-started" | "dashboard" | "reports" | "settings" | "configure">("getting-started");
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
                        <button
                            onClick={() => setActiveTab("configure")}
                            role="tab"
                            aria-selected={activeTab === "configure"}
                            title="Configure"
                            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === "configure"
                                ? "border-blue-500 text-blue-600 dark:text-blue-400"
                                : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                                }`}
                        >
                            Configure
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
                    {activeTab === "configure" && <ConfigureHelp />}
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
                title={HELP_CONTENT.dashboard.viewModes.title}
                icon={<LayoutDashboard className="h-5 w-5" />}
            >
                <div className="space-y-3">
                    <p className="text-sm text-zinc-700 dark:text-zinc-300">
                        {HELP_CONTENT.dashboard.viewModes.intro}
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                            <h5 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-1">{HELP_CONTENT.dashboard.viewModes.basic.title}</h5>
                            <p className="text-sm text-zinc-600 dark:text-zinc-400">
                                {HELP_CONTENT.dashboard.viewModes.basic.description}
                            </p>
                        </div>
                        <div className="p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                            <h5 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-1">{HELP_CONTENT.dashboard.viewModes.advanced.title}</h5>
                            <p className="text-sm text-zinc-600 dark:text-zinc-400">
                                {HELP_CONTENT.dashboard.viewModes.advanced.description}
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
                title={HELP_CONTENT.dashboard.roleOverview.title}
                icon={<Shield className="h-5 w-5" />}
            >
                <p className="text-sm text-zinc-700 dark:text-zinc-300 mb-4">
                    {HELP_CONTENT.dashboard.roleOverview.description}
                </p>
                <div className="space-y-3">
                    <div className="flex items-start gap-3 p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                        <div className="mt-1 bg-white dark:bg-zinc-700 p-1 rounded shadow-sm">
                            <ChevronRight className="h-4 w-4 text-zinc-400" />
                        </div>
                        <div>
                            <h5 className="font-medium text-sm text-zinc-900 dark:text-zinc-100">{HELP_CONTENT.dashboard.roleOverview.drillDown.title}</h5>
                            <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">
                                {HELP_CONTENT.dashboard.roleOverview.drillDown.description}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-start gap-3 p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                        <Search className="h-5 w-5 text-zinc-400 mt-1" />
                        <div>
                            <h5 className="font-medium text-sm text-zinc-900 dark:text-zinc-100">{HELP_CONTENT.dashboard.roleOverview.quickFilter.title}</h5>
                            <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">
                                {HELP_CONTENT.dashboard.roleOverview.quickFilter.description}
                            </p>
                        </div>
                    </div>
                </div>
            </CollapsibleSection>

            <CollapsibleSection
                title={HELP_CONTENT.dashboard.pdfExport.title}
                icon={<FileDown className="h-5 w-5" />}
            >
                <p className="text-sm text-zinc-700 dark:text-zinc-300 mb-4">
                    {HELP_CONTENT.dashboard.pdfExport.description}
                </p>
                <div className="space-y-3">
                    <div className="flex items-start gap-3 p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                        <Settings className="h-5 w-5 text-zinc-400 mt-1" />
                        <div>
                            <h5 className="font-medium text-sm text-zinc-900 dark:text-zinc-100">{HELP_CONTENT.dashboard.pdfExport.sections.title}</h5>
                            <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">
                                {HELP_CONTENT.dashboard.pdfExport.sections.description}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-start gap-3 p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                        <FileText className="h-5 w-5 text-zinc-400 mt-1" />
                        <div>
                            <h5 className="font-medium text-sm text-zinc-900 dark:text-zinc-100">{HELP_CONTENT.dashboard.pdfExport.charts.title}</h5>
                            <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">
                                {HELP_CONTENT.dashboard.pdfExport.charts.description}
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
                        <li><strong>Click a chip</strong> to hide/show that workload&apos;s data.</li>
                        <li><strong>Grayed chips</strong> indicate hidden data.</li>
                        <li>Data for hidden chips is still fetched but not displayed.</li>
                    </ul>
                </div>
            </CollapsibleSection>
        </div>
    );
}

function GettingStarted() {
    const handleRestartTour = () => {
        localStorage.removeItem("pim_onboarding_completed");
        localStorage.removeItem("pim_highlights_seen_version");
        window.location.href = "/dashboard";
    };

    return (
        <div className="space-y-6 max-w-3xl">
            <div>
                <h3 className="text-xl font-semibold mb-2 text-zinc-900 dark:text-zinc-100">Welcome to PIM Manager</h3>
                <p className="text-zinc-600 dark:text-zinc-400">
                    {HELP_CONTENT.gettingStarted.description}
                </p>
                {process.env.NEXT_PUBLIC_APP_VERSION && (
                    <div className="mt-3 flex items-center gap-2 text-xs text-zinc-400 dark:text-zinc-500">
                        <Calendar className="h-3.5 w-3.5" />
                        <span>
                            {process.env.NEXT_PUBLIC_APP_VERSION}
                            {process.env.NEXT_PUBLIC_APP_RELEASE_DATE && (
                                <> · {format(new Date(process.env.NEXT_PUBLIC_APP_RELEASE_DATE), "MMM d, yyyy")}</>
                            )}
                        </span>
                    </div>
                )}
                <button
                    onClick={handleRestartTour}
                    className="mt-3 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 underline underline-offset-2 transition-colors"
                >
                    Restart onboarding tour
                </button>
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
                    <PermissionItem code="RoleManagementAlert.Read.Directory" description="Security Alerts" optional />
                    <PermissionItem code="PrivilegedAccess.Read.AzureADGroup" description="PIM for Groups assignments" optional />
                    <PermissionItem code="RoleManagementPolicy.Read.AzureADGroup" description="PIM for Groups policies" optional />
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
                            <h5 className="font-medium text-zinc-900 dark:text-zinc-100">{HELP_CONTENT.gettingStarted.navigation.dashboard.title}</h5>
                            <p className="text-sm text-zinc-600 dark:text-zinc-400">
                                {HELP_CONTENT.gettingStarted.navigation.dashboard.description}
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
                    <div className="flex items-start gap-3">
                        <div className="mt-0.5">
                            <Wrench className="h-5 w-5 text-blue-600" />
                        </div>
                        <div>
                            <h5 className="font-medium text-zinc-900 dark:text-zinc-100">{HELP_CONTENT.gettingStarted.navigation.configure.title}</h5>
                            <p className="text-sm text-zinc-600 dark:text-zinc-400">
                                {HELP_CONTENT.gettingStarted.navigation.configure.description}
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
                            solution="Cache not refreshed. Click the Refresh button or wait 60 minutes for automatic cache expiry."
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
                title={HELP_CONTENT.reports.badges.title}
                icon={<Tag className="h-5 w-5" />}
            >
                <p className="text-sm text-zinc-700 dark:text-zinc-300 mb-4">
                    {HELP_CONTENT.reports.badges.description}
                </p>
                <div className="space-y-3">
                    <BadgeExample
                        badge={<span className="px-2 py-0.5 text-xs rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400">Built-in</span>}
                        description={HELP_CONTENT.reports.badges.items.builtIn}
                    />
                    <BadgeExample
                        badge={<span className="px-2 py-0.5 text-xs rounded bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 flex items-center gap-1 w-fit"><Shield className="h-3 w-3" />Privileged</span>}
                        description={HELP_CONTENT.reports.badges.items.privileged}
                    />
                    <BadgeExample
                        badge={<span className="px-2 py-0.5 text-xs rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">PIM configured</span>}
                        description={HELP_CONTENT.reports.badges.items.pimConfigured}
                    />
                </div>
            </CollapsibleSection>

            <CollapsibleSection
                title={HELP_CONTENT.reports.details.title}
                icon={<Info className="h-5 w-5" />}
            >
                <p className="text-sm text-zinc-700 dark:text-zinc-300 mb-4">
                    {HELP_CONTENT.reports.details.description}
                </p>
                <div className="space-y-4">
                    <DetailSection
                        icon={<UsersIcon className="h-5 w-5 text-blue-600" />}
                        title={HELP_CONTENT.reports.details.assignments.title}
                        description={HELP_CONTENT.reports.details.assignments.description}
                    />
                    <DetailSection
                        icon={<Settings className="h-5 w-5 text-blue-600" />}
                        title={HELP_CONTENT.reports.details.config.title}
                        description={HELP_CONTENT.reports.details.config.description}
                        items={[
                            { label: "Activation", detail: HELP_CONTENT.reports.details.config.activation },
                            { label: "Assignment", detail: HELP_CONTENT.reports.details.config.assignment },
                            { label: "Notification", detail: HELP_CONTENT.reports.details.config.notification }
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
                title={HELP_CONTENT.reports.export.title}
                icon={<Download className="h-5 w-5" />}
            >
                <p className="text-sm text-zinc-700 dark:text-zinc-300 mb-3">
                    {HELP_CONTENT.reports.export.description}
                </p>
                <div className="space-y-2">
                    <ExportOption
                        format="JSON"
                        description={HELP_CONTENT.reports.export.json}
                    />
                    <ExportOption
                        format="PDF"
                        description={HELP_CONTENT.reports.export.pdf}
                    />
                    <ExportOption
                        format="CSV"
                        description={HELP_CONTENT.reports.export.csv}
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
                    {HELP_CONTENT.settings.modal.workloads.description}
                </p>
            </div>

            <CollapsibleSection
                title={HELP_CONTENT.settings.modal.workloads.title}
                icon={<Shield className="h-5 w-5" />}
            >
                <div className="space-y-3">
                    <p className="text-sm text-zinc-700 dark:text-zinc-300">
                        Workloads are the data sources that PIM Manager can read from your tenant.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                            <h5 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-1">{HELP_CONTENT.settings.modal.items.directoryRoles.name}</h5>
                            <p className="text-sm text-zinc-600 dark:text-zinc-400">
                                {HELP_CONTENT.settings.modal.items.directoryRoles.description}
                            </p>
                        </div>
                        <div className="p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                            <h5 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-1">{HELP_CONTENT.settings.modal.items.pimGroups.name}</h5>
                            <p className="text-sm text-zinc-600 dark:text-zinc-400">
                                {HELP_CONTENT.settings.modal.items.pimGroups.description}
                            </p>
                        </div>
                        <div className="p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                            <h5 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-1">{HELP_CONTENT.settings.modal.items.directoryRoles.securityAlerts.name}</h5>
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
                            <h5 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-1">{HELP_CONTENT.settings.modal.actions.hide.label}</h5>
                            <p className="text-sm text-zinc-600 dark:text-zinc-400">
                                {HELP_CONTENT.settings.modal.actions.hide.tooltip}
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

function ConfigureHelp() {
    return (
        <div className="space-y-6 max-w-3xl">
            <div>
                <h3 className="text-xl font-semibold mb-2 text-zinc-900 dark:text-zinc-100">{HELP_CONTENT.configure.title}</h3>
                <p className="text-zinc-600 dark:text-zinc-400">
                    {HELP_CONTENT.configure.description}
                </p>
            </div>

            {/* Mode Overview */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-zinc-200 dark:border-zinc-700">
                    <div className="flex items-center gap-2 mb-1">
                        <Wand2 className="h-4 w-4 text-blue-500" />
                        <h5 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">{HELP_CONTENT.configure.modes.wizard.title}</h5>
                    </div>
                    <p className="text-xs text-zinc-600 dark:text-zinc-400">{HELP_CONTENT.configure.modes.wizard.description}</p>
                </div>
                <div className="p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-zinc-200 dark:border-zinc-700">
                    <div className="flex items-center gap-2 mb-1">
                        <Settings className="h-4 w-4 text-blue-500" />
                        <h5 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">{HELP_CONTENT.configure.modes.manual.title}</h5>
                    </div>
                    <p className="text-xs text-zinc-600 dark:text-zinc-400">{HELP_CONTENT.configure.modes.manual.description}</p>
                </div>
                <div className="p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-zinc-200 dark:border-zinc-700">
                    <div className="flex items-center gap-2 mb-1">
                        <FileSpreadsheet className="h-4 w-4 text-blue-500" />
                        <h5 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">{HELP_CONTENT.configure.modes.bulk.title}</h5>
                    </div>
                    <p className="text-xs text-zinc-600 dark:text-zinc-400">{HELP_CONTENT.configure.modes.bulk.description}</p>
                </div>
            </div>

            <CollapsibleSection
                title={HELP_CONTENT.configure.requiredPermissions.title}
                icon={<Shield className="h-5 w-5" />}
            >
                <div className="space-y-4">
                    <p className="text-sm text-zinc-700 dark:text-zinc-300">
                        {HELP_CONTENT.configure.requiredPermissions.description}
                    </p>

                    {/* Directory Roles Write Permissions */}
                    <div className="space-y-2">
                        <h5 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                            <span className="w-3 h-3 rounded-full bg-blue-500"></span>
                            {HELP_CONTENT.configure.requiredPermissions.directoryRoles}
                        </h5>
                        <div className="grid grid-cols-1 gap-2 text-sm">
                            <PermissionItem code="RoleManagementPolicy.ReadWrite.Directory" description="Update role policies" />
                            <PermissionItem code="RoleEligibilitySchedule.ReadWrite.Directory" description="Create eligible assignments" />
                            <PermissionItem code="RoleAssignmentSchedule.ReadWrite.Directory" description="Create active assignments" />
                        </div>
                    </div>

                    {/* PIM Groups Write Permissions */}
                    <div className="space-y-2">
                        <h5 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                            <span className="w-3 h-3 rounded-full bg-emerald-500"></span>
                            {HELP_CONTENT.configure.requiredPermissions.pimGroups}
                        </h5>
                        <div className="grid grid-cols-1 gap-2 text-sm">
                            <PermissionItem code="RoleManagementPolicy.ReadWrite.AzureADGroup" description="Update group policies" />
                            <PermissionItem code="PrivilegedEligibilitySchedule.ReadWrite.AzureADGroup" description="Create eligible assignments" />
                            <PermissionItem code="PrivilegedAssignmentSchedule.ReadWrite.AzureADGroup" description="Create active assignments" />
                        </div>
                    </div>

                    <TipBox>
                        Write permissions are requested via <strong>incremental consent</strong> when you start configuration. You don&apos;t need to grant them upfront.
                    </TipBox>
                </div>
            </CollapsibleSection>

            <CollapsibleSection
                title={HELP_CONTENT.configure.wizard.stepsOverview.title}
                icon={<Wand2 className="h-5 w-5" />}
            >
                <div className="space-y-3">
                    <p className="text-sm text-zinc-700 dark:text-zinc-300 mb-4">
                        {HELP_CONTENT.configure.wizard.stepsOverview.description}
                    </p>
                    <div className="space-y-2">
                        <WizardStepItem number={1} title="Backup" description="Refresh data, download a JSON backup, and confirm before proceeding" />
                        <WizardStepItem number={2} title="Workload Selection" description="Choose Directory Roles, PIM Groups, or both" />
                        <WizardStepItem number={3} title="Configuration Type" description="Policies only, Assignments only, or Both" />
                        <WizardStepItem number={4} title="Scope Selection" description="Select roles/groups and optionally clone settings" />
                        <WizardStepItem number={5} title="Policies" description="Activation, assignment, and notification settings" />
                        <WizardStepItem number={6} title="Assignments" description="Add new members and manage existing assignments" />
                        <WizardStepItem number={7} title="Review" description="Preview all changes before applying" />
                        <WizardStepItem number={8} title="Apply" description="Execute changes with progress tracking" />
                    </div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-3">
                        {HELP_CONTENT.configure.wizard.stepsOverview.checkpointNote}
                    </p>
                </div>
            </CollapsibleSection>

            <CollapsibleSection
                title={HELP_CONTENT.configure.wizard.scopeSelection.title}
                icon={<Filter className="h-5 w-5" />}
            >
                <div className="space-y-4">
                    <p className="text-sm text-zinc-700 dark:text-zinc-300">
                        {HELP_CONTENT.configure.wizard.scopeSelection.description}
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div className="p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                            <h5 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-1 text-sm">{HELP_CONTENT.configure.wizard.scopeSelection.startFresh.title}</h5>
                            <p className="text-xs text-zinc-600 dark:text-zinc-400">
                                {HELP_CONTENT.configure.wizard.scopeSelection.startFresh.description}
                            </p>
                        </div>
                        <div className="p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                            <h5 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-1 text-sm">{HELP_CONTENT.configure.wizard.scopeSelection.loadCurrent.title}</h5>
                            <p className="text-xs text-zinc-600 dark:text-zinc-400">
                                {HELP_CONTENT.configure.wizard.scopeSelection.loadCurrent.description}
                            </p>
                        </div>
                        <div className="p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border-2 border-blue-200 dark:border-blue-800">
                            <h5 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-1 text-sm">{HELP_CONTENT.configure.wizard.scopeSelection.cloneFrom.title}</h5>
                            <p className="text-xs text-zinc-600 dark:text-zinc-400">
                                {HELP_CONTENT.configure.wizard.scopeSelection.cloneFrom.description}
                            </p>
                        </div>
                    </div>
                    <div>
                        <h5 className="font-medium text-sm mb-2 text-zinc-900 dark:text-zinc-100">{HELP_CONTENT.configure.wizard.scopeSelection.filteringTitle}</h5>
                        <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-2">
                            {HELP_CONTENT.configure.wizard.scopeSelection.filteringDescription}
                        </p>
                        <ul className="space-y-1 text-sm text-zinc-600 dark:text-zinc-400 list-disc ml-4">
                            <li><strong>Roles:</strong> Type (Built-in / Custom) · Privilege · Assignments (With / Without)</li>
                            <li><strong>Groups:</strong> Group type (Security / M365 / Mail-enabled)</li>
                        </ul>
                        <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-2">
                            {HELP_CONTENT.configure.wizard.scopeSelection.selectAllNote}
                        </p>
                    </div>
                </div>
            </CollapsibleSection>

            <CollapsibleSection
                title={HELP_CONTENT.configure.wizard.policySettings.title}
                icon={<Settings className="h-5 w-5" />}
            >
                <div className="space-y-4">
                    <div>
                        <h5 className="font-medium text-sm mb-2 text-zinc-900 dark:text-zinc-100">{HELP_CONTENT.configure.wizard.policySettings.activationTitle}</h5>
                        <ul className="space-y-1 text-sm text-zinc-600 dark:text-zinc-400 list-disc ml-4">
                            <li>Maximum activation duration (30 min - 24 hours)</li>
                            <li>Authentication: None, MFA, or Conditional Access</li>
                            <li>Require justification and/or ticket information</li>
                            <li>Require approval with approver selection</li>
                        </ul>
                    </div>
                    <div>
                        <h5 className="font-medium text-sm mb-2 text-zinc-900 dark:text-zinc-100">{HELP_CONTENT.configure.wizard.policySettings.assignmentTitle}</h5>
                        <ul className="space-y-1 text-sm text-zinc-600 dark:text-zinc-400 list-disc ml-4">
                            <li>Allow permanent eligible/active assignments</li>
                            <li>Maximum assignment durations</li>
                            <li>MFA and justification requirements on active assignment</li>
                        </ul>
                    </div>
                    <div>
                        <h5 className="font-medium text-sm mb-2 text-zinc-900 dark:text-zinc-100">{HELP_CONTENT.configure.wizard.policySettings.notificationTitle}</h5>
                        <p className="text-sm text-zinc-600 dark:text-zinc-400">
                            {HELP_CONTENT.configure.wizard.policySettings.notificationDescription}
                        </p>
                    </div>
                    <TipBox>
                        {HELP_CONTENT.configure.wizard.policySettings.pimGroupsTip}
                    </TipBox>
                </div>
            </CollapsibleSection>

            <CollapsibleSection
                title={HELP_CONTENT.configure.wizard.assignments.title}
                icon={<UsersIcon className="h-5 w-5" />}
            >
                <div className="space-y-4">
                    <div>
                        <h5 className="font-medium text-sm mb-2 text-zinc-900 dark:text-zinc-100">{HELP_CONTENT.configure.wizard.assignments.createTitle}</h5>
                        <ul className="space-y-1 text-sm text-zinc-600 dark:text-zinc-400 list-disc ml-4">
                            <li><strong>Type:</strong> Eligible (recommended) or Active</li>
                            <li><strong>Members:</strong> Search and select users or groups</li>
                            <li><strong>Duration:</strong> Permanent or time-bound with dates</li>
                            <li><strong>Scope:</strong> Directory-wide or Administrative Unit</li>
                        </ul>
                    </div>
                    <div>
                        <h5 className="font-medium text-sm mb-2 text-zinc-900 dark:text-zinc-100">{HELP_CONTENT.configure.wizard.assignments.manageTitle}</h5>
                        <ul className="space-y-1 text-sm text-zinc-600 dark:text-zinc-400 list-disc ml-4">
                            <li>View all current assignments for selected items</li>
                            <li>Filter by Eligible, Active, or Expired</li>
                            <li>Mark assignments for removal</li>
                        </ul>
                    </div>
                </div>
            </CollapsibleSection>

            <CollapsibleSection
                title={HELP_CONTENT.configure.wizard.applyProcess.title}
                icon={<Wrench className="h-5 w-5" />}
            >
                <div className="space-y-3">
                    <p className="text-sm text-zinc-700 dark:text-zinc-300">
                        {HELP_CONTENT.configure.wizard.applyProcess.description}
                    </p>
                    <div className="space-y-2">
                        <div className="flex items-center gap-3 p-2 bg-zinc-50 dark:bg-zinc-800/50 rounded">
                            <span className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 flex items-center justify-center text-xs font-bold">1</span>
                            <span className="text-sm text-zinc-700 dark:text-zinc-300"><strong>Policies</strong> - Updates PIM settings for each item</span>
                        </div>
                        <div className="flex items-center gap-3 p-2 bg-zinc-50 dark:bg-zinc-800/50 rounded">
                            <span className="w-6 h-6 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 flex items-center justify-center text-xs font-bold">2</span>
                            <span className="text-sm text-zinc-700 dark:text-zinc-300"><strong>Assignments</strong> - Creates new role/group assignments</span>
                        </div>
                        <div className="flex items-center gap-3 p-2 bg-zinc-50 dark:bg-zinc-800/50 rounded">
                            <span className="w-6 h-6 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 flex items-center justify-center text-xs font-bold">3</span>
                            <span className="text-sm text-zinc-700 dark:text-zinc-300"><strong>Removals</strong> - Removes marked assignments</span>
                        </div>
                    </div>
                    <TipBox>
                        {HELP_CONTENT.configure.wizard.applyProcess.retryTip}
                    </TipBox>
                </div>
            </CollapsibleSection>

            <CollapsibleSection
                title={HELP_CONTENT.configure.manual.title}
                icon={<Settings className="h-5 w-5" />}
            >
                <div className="space-y-4">
                    <p className="text-sm text-zinc-700 dark:text-zinc-300">
                        {HELP_CONTENT.configure.manual.description}
                    </p>
                    <div className="space-y-3">
                        <div className="flex items-start gap-3 p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                            <Shield className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                            <div>
                                <h5 className="font-medium text-sm text-zinc-900 dark:text-zinc-100">{HELP_CONTENT.configure.manual.column1.title}</h5>
                                <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">
                                    {HELP_CONTENT.configure.manual.column1.description}
                                </p>
                            </div>
                        </div>
                        <div className="flex items-start gap-3 p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                            <Settings className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                            <div>
                                <h5 className="font-medium text-sm text-zinc-900 dark:text-zinc-100">{HELP_CONTENT.configure.manual.column2.title}</h5>
                                <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">
                                    <strong>Policy tab:</strong> Full activation, assignment, and notification settings. PIM Groups shows both Member and Owner policies.<br />
                                    <strong>Assignment tab:</strong> Create eligible/active assignments, set scope and duration, and manage existing assignments (view, remove).
                                </p>
                            </div>
                        </div>
                        <div className="flex items-start gap-3 p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                            <FileText className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                            <div>
                                <h5 className="font-medium text-sm text-zinc-900 dark:text-zinc-100">{HELP_CONTENT.configure.manual.column3.title}</h5>
                                <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">
                                    {HELP_CONTENT.configure.manual.column3.description}
                                </p>
                            </div>
                        </div>
                    </div>
                    <TipBox>
                        {HELP_CONTENT.configure.manual.permissionsTip}
                    </TipBox>
                </div>
            </CollapsibleSection>

            <CollapsibleSection
                title={HELP_CONTENT.configure.bulk.title}
                icon={<FileSpreadsheet className="h-5 w-5" />}
            >
                <div className="space-y-4">
                    <p className="text-sm text-zinc-700 dark:text-zinc-300">
                        {HELP_CONTENT.configure.bulk.description}
                    </p>
                    <div className="space-y-2">
                        <div className="flex items-center gap-3 p-2 bg-zinc-50 dark:bg-zinc-800/50 rounded">
                            <span className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 flex items-center justify-center text-xs font-bold flex-shrink-0">1</span>
                            <span className="text-sm text-zinc-700 dark:text-zinc-300"><strong>Upload</strong> — Select CSV type and upload your file. Use template buttons to download the correct format.</span>
                        </div>
                        <div className="flex items-center gap-3 p-2 bg-zinc-50 dark:bg-zinc-800/50 rounded">
                            <span className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 flex items-center justify-center text-xs font-bold flex-shrink-0">2</span>
                            <span className="text-sm text-zinc-700 dark:text-zinc-300"><strong>Compare / Preview</strong> — Policy CSVs show a diff of current vs desired settings. Assignment CSVs show a row-by-row preview with validation errors.</span>
                        </div>
                        <div className="flex items-center gap-3 p-2 bg-zinc-50 dark:bg-zinc-800/50 rounded">
                            <span className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 flex items-center justify-center text-xs font-bold flex-shrink-0">3</span>
                            <span className="text-sm text-zinc-700 dark:text-zinc-300"><strong>Select & Apply</strong> — Choose which rows to apply, then confirm. Failed rows can be retried individually.</span>
                        </div>
                    </div>
                    <div className="space-y-2 text-sm text-zinc-600 dark:text-zinc-400">
                        <p><strong>Action column (add / remove):</strong> Each row in an assignment CSV can have <code>Action = add</code> (default, creates the assignment) or <code>Action = remove</code> (deletes the assignment). Rows already matching the desired state are skipped automatically.</p>
                        <p><strong>Export → Edit → Import roundtrip:</strong> Export assignments from the Report page — the CSV already contains Role ID / Group ID and Principal ID columns with <code>Action = add</code>. Change rows you want to delete to <code>Action = remove</code>, then upload to Bulk mode.</p>
                        <p><strong>UPN vs Principal ID:</strong> UPN lookup only works for users. Groups and service principals require a Principal ID (Object ID).</p>
                        <p><strong>Permanent assignments:</strong> Set <em>Duration Days</em> to <code>permanent</code>. The policy must allow no-expiration; rows where permanent is blocked show a <em>Permanent not allowed</em> status badge.</p>
                    </div>
                    <TipBox>
                        {HELP_CONTENT.configure.bulk.templateTip}
                    </TipBox>
                </div>
            </CollapsibleSection>

            <CollapsibleSection
                title={HELP_CONTENT.configure.requiredEntraRoles.title}
                icon={<UsersIcon className="h-5 w-5" />}
            >
                <div className="space-y-4">
                    <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
                        <div className="flex items-start gap-2">
                            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                            <p className="text-sm text-amber-900 dark:text-amber-200">
                                <strong>Important:</strong> {HELP_CONTENT.configure.requiredEntraRoles.importantNote}
                            </p>
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
                            <thead className="bg-zinc-50 dark:bg-zinc-800">
                                <tr>
                                    <th className="px-3 py-2 text-left font-semibold text-zinc-900 dark:text-zinc-100">Workload</th>
                                    <th className="px-3 py-2 text-left font-semibold text-zinc-900 dark:text-zinc-100">Required Entra Role</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
                                <tr>
                                    <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">Directory Roles</td>
                                    <td className="px-3 py-2">
                                        <span className="px-2 py-0.5 text-xs rounded bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">
                                            Privileged Role Administrator
                                        </span>
                                    </td>
                                </tr>
                                <tr>
                                    <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">PIM Groups (role-assignable)</td>
                                    <td className="px-3 py-2">
                                        <span className="px-2 py-0.5 text-xs rounded bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">
                                            Privileged Role Administrator
                                        </span>
                                    </td>
                                </tr>
                                <tr>
                                    <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">PIM Groups (non-role-assignable)</td>
                                    <td className="px-3 py-2">
                                        <span className="px-2 py-0.5 text-xs rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400">
                                            Owner of the group
                                        </span>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </CollapsibleSection>

            <CollapsibleSection
                title={HELP_CONTENT.configure.safetyFeatures.title}
                icon={<AlertTriangle className="h-5 w-5" />}
            >
                <div className="space-y-3">
                    <ul className="space-y-2 text-sm text-zinc-600 dark:text-zinc-400 list-disc ml-4">
                        <li><strong>Data Refresh Gate:</strong> Wizard blocks until data is fully refreshed.</li>
                        <li><strong>Backup Export:</strong> Download current configuration as JSON before making changes.</li>
                        <li><strong>Preview Step:</strong> Review all pending changes before applying.</li>
                        <li><strong>Independent Failures:</strong> If one item fails, others continue. Failed items can be retried.</li>
                        <li><strong>Navigation Guard:</strong> Warns when leaving with unsaved changes.</li>
                    </ul>
                </div>
            </CollapsibleSection>
        </div>
    );
}

function WizardStepItem({ number, title, description }: { number: number; title: string; description: string }) {
    return (
        <div className="flex items-start gap-3 p-2 bg-zinc-50 dark:bg-zinc-800/50 rounded">
            <span className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 flex items-center justify-center text-xs font-bold flex-shrink-0">
                {number}
            </span>
            <div>
                <span className="font-medium text-sm text-zinc-900 dark:text-zinc-100">{title}</span>
                <span className="text-sm text-zinc-500 dark:text-zinc-400"> — {description}</span>
            </div>
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
