"use client";

import React, { useState, useEffect, useMemo } from "react";
import { ArrowLeft, AlertTriangle, Shield, Users, Layers, X, Check, UserPlus } from "lucide-react";
import { RoleSelector } from "@/components/RoleSelector";
import { ProgressModal, ProgressStep } from "@/components/ProgressModal";
import { SettingsModal } from "@/components/SettingsModal";
import { useToastActions } from "@/contexts/ToastContext";
import { usePimData } from "@/hooks/usePimData";
import { useUnifiedPimData } from "@/contexts/UnifiedPimContext";
import { isWriteConsentGranted } from "@/hooks/useIncrementalConsent";
import { PimGroupData } from "@/types/pimGroup.types";
import { useGraphClient } from "@/hooks/usePimSelectors";
import { PolicySettings } from "@/hooks/useWizardState";
import { parseGraphPolicy } from "@/services/policyParserService";
import { ApplyOperationResult } from "@/types/wizard.types";
import {
    applyDirectoryRolePolicies,
    applyGroupPolicies,
} from "@/services/wizardApplyService";

import { GroupSelector } from "@/components/configure/shared/GroupSelector";
import { PolicySettingsForm, DEFAULT_POLICY_SETTINGS } from "@/components/configure/shared/PolicySettingsForm";
import { AssignmentPanel } from "@/components/configure/shared/AssignmentPanel";
import { ConfigureWorkloadType as WorkloadType } from '@/types/workload.types';
import { Logger } from "@/utils/logger";

interface StagedChange {
    id: string;
    targetId: string;
    targetName: string;
    workload: WorkloadType;
    type: "policy";
    /** Member policy (or only policy for directoryRoles) */
    settings: PolicySettings;
    /** Owner policy (pimGroups only) */
    ownerSettings?: PolicySettings;
    timestamp: number;
}

interface ManualModeProps {
    onBack: () => void;
}

export function ManualMode({ onBack }: ManualModeProps) {
    // ── Workload & Selection ─────────────────────────────────────────────────
    const [workload, setWorkload] = useState<WorkloadType>("directoryRoles");
    const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
    const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);

    // ── Policy Settings State ────────────────────────────────────────────────
    const [memberSettings, setMemberSettings] = useState<PolicySettings>(DEFAULT_POLICY_SETTINGS);
    const [ownerSettings, setOwnerSettings] = useState<PolicySettings>(DEFAULT_POLICY_SETTINGS);
    const [accessType, setAccessType] = useState<"member" | "owner">("member");
    const [configSource, setConfigSource] = useState<"defaults" | "loaded">("defaults");
    const [isLoadingSettings, setIsLoadingSettings] = useState(false);

    // ── Staged Changes ───────────────────────────────────────────────────────
    const [stagedChanges, setStagedChanges] = useState<StagedChange[]>([]);

    // ── Active Tab ───────────────────────────────────────────────────────────
    const [activeTab, setActiveTab] = useState<"policy" | "assignments">("policy");

    // ── Reload Trigger ───────────────────────────────────────────────────────
    // Increment to force the policy auto-load effect to re-fetch after apply
    const [reloadTrigger, setReloadTrigger] = useState(0);

    // ── Modal States ─────────────────────────────────────────────────────────
    const [showProgress, setShowProgress] = useState(false);
    const [progressSteps, setProgressSteps] = useState<ProgressStep[]>([]);
    const [progressTitle, setProgressTitle] = useState("");
    const [canCloseProgress, setCanCloseProgress] = useState(false);
    const [showSettingsModal, setShowSettingsModal] = useState(false);
    const [rolesWriteConsent, setRolesWriteConsent] = useState(false);
    const [groupsWriteConsent, setGroupsWriteConsent] = useState(false);

    // ── Data Hooks ───────────────────────────────────────────────────────────
    const { rolesData, loading: rolesLoading, getPolicySettings } = usePimData();
    const { workloads, refreshWorkload } = useUnifiedPimData();
    const groupsData = workloads.pimGroups.data as PimGroupData[];
    const groupsLoading = workloads.pimGroups.loading.phase === "fetching";
    const toast = useToastActions();
    const getGraphClient = useGraphClient();

    // ── Derived State ────────────────────────────────────────────────────────
    const selectedIds = workload === "directoryRoles" ? selectedRoleIds : selectedGroupIds;

    const selectedTargetName = useMemo(() => {
        if (selectedIds.length !== 1) return null;
        if (workload === "directoryRoles") {
            return rolesData?.find(r => r.definition.id === selectedIds[0])?.definition.displayName || null;
        }
        return groupsData?.find(g => g.group.id === selectedIds[0])?.group.displayName || null;
    }, [selectedIds, workload, rolesData, groupsData]);

    // ── Write Consent Check ──────────────────────────────────────────────────
    useEffect(() => {
        if (typeof window === "undefined") return;
        setRolesWriteConsent(isWriteConsentGranted("directoryRoles"));
        setGroupsWriteConsent(isWriteConsentGranted("pimGroups"));
    }, [workload, showSettingsModal]);

    // Per-tab consent gate (used for "Apply Now" + consent banner)
    const missingWriteConsent = workload === "directoryRoles" ? !rolesWriteConsent : !groupsWriteConsent;

    // Consent needed to apply staged changes — checks every workload present in the queue
    const stagedMissingConsent = useMemo(() => {
        const needsRoles = stagedChanges.some(c => c.workload === "directoryRoles");
        const needsGroups = stagedChanges.some(c => c.workload === "pimGroups");
        return (needsRoles && !rolesWriteConsent) || (needsGroups && !groupsWriteConsent);
    }, [stagedChanges, rolesWriteConsent, groupsWriteConsent]);

    // ── Auto-load Settings on Single Selection ───────────────────────────────
    useEffect(() => {
        let cancelled = false;

        const loadSettings = async () => {
            if (selectedIds.length !== 1) {
                setMemberSettings(DEFAULT_POLICY_SETTINGS);
                setOwnerSettings(DEFAULT_POLICY_SETTINGS);
                setConfigSource("defaults");
                setIsLoadingSettings(false);
                return;
            }

            setIsLoadingSettings(true);
            setConfigSource("defaults");

            try {
                if (workload === "directoryRoles") {
                    const result = await getPolicySettings(selectedIds[0]);
                    if (cancelled) return;
                    if (result?.rules) {
                        const parsed = parseGraphPolicy({ rules: result.rules });
                        setMemberSettings(parsed);
                        setConfigSource("loaded");
                    }
                } else {
                    // PIM Groups: try to get from cached data first
                    const groupData = groupsData?.find(g => g.group.id === selectedIds[0]);
                    const memberRules = groupData?.policies?.member?.rules;
                    const ownerRules = groupData?.policies?.owner?.rules;

                    if (!cancelled) {
                        if (memberRules) {
                            setMemberSettings(parseGraphPolicy({ rules: memberRules }));
                            setConfigSource("loaded");
                        }
                        if (ownerRules) {
                            setOwnerSettings(parseGraphPolicy({ rules: ownerRules }));
                        }
                    }

                    // Fetch on-demand for any missing policy (not only when both are missing)
                    if (!memberRules || !ownerRules) {
                        try {
                            const { fetchSingleGroupPolicy } = await import("@/services/pimGroupService");
                            const client = await getGraphClient();
                            const fetched = await fetchSingleGroupPolicy(client, selectedIds[0]);
                            if (cancelled) return;
                            if (fetched !== "CACHED") {
                                const member = fetched.policies.find(p => p.policyType === "member");
                                const owner  = fetched.policies.find(p => p.policyType === "owner");
                                if (!memberRules && member?.rules) {
                                    setMemberSettings(parseGraphPolicy({ rules: member.rules }));
                                    setConfigSource("loaded");
                                }
                                if (!ownerRules && owner?.rules) {
                                    setOwnerSettings(parseGraphPolicy({ rules: owner.rules }));
                                }
                            }
                        } catch (e) {
                            Logger.error("ManualMode", "Failed to fetch group policies on-demand", e);
                        }
                    }
                }
            } catch (err) {
                Logger.error("ManualMode", "Failed to load settings", err);
                if (!cancelled) toast.error("Failed to load settings", "Could not fetch current configuration");
            } finally {
                if (!cancelled) setIsLoadingSettings(false);
            }
        };

        loadSettings();

        return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedIds, workload, reloadTrigger]);

    // ── Workload Switch ──────────────────────────────────────────────────────
    const handleWorkloadChange = (next: WorkloadType) => {
        setWorkload(next);
        setSelectedRoleIds([]);
        setSelectedGroupIds([]);
        setMemberSettings(DEFAULT_POLICY_SETTINGS);
        setOwnerSettings(DEFAULT_POLICY_SETTINGS);
        setConfigSource("defaults");
        setActiveTab("policy");
    };

    // ── Stage Changes ────────────────────────────────────────────────────────
    const handleStageChanges = () => {
        if (selectedIds.length === 0) return;

        const newChanges: StagedChange[] = selectedIds.map(id => {
            const targetName = workload === "directoryRoles"
                ? rolesData?.find(r => r.definition.id === id)?.definition.displayName || id
                : groupsData?.find(g => g.group.id === id)?.group.displayName || id;

            return {
                id: `${id}-${Date.now()}`,
                targetId: id,
                targetName,
                workload,
                type: "policy" as const,
                settings: { ...memberSettings },
                ownerSettings: workload === "pimGroups" ? { ...ownerSettings } : undefined,
                timestamp: Date.now()
            };
        });

        setStagedChanges(prev => {
            const existingIds = new Set(selectedIds);
            const filtered = prev.filter(c => !existingIds.has(c.targetId) || c.workload !== workload);
            return [...filtered, ...newChanges];
        });

        toast.success(
            "Changes Staged",
            `${selectedIds.length} ${workload === "directoryRoles" ? "role" : "group"}(s) ready for apply`
        );
    };

    const handleRemoveStagedChange = (changeId: string) => {
        setStagedChanges(prev => prev.filter(c => c.id !== changeId));
    };

    const handleClearAllStaged = () => {
        setStagedChanges([]);
        toast.info("Staged Changes Cleared", "All pending changes have been removed");
    };

    // ── Direct Apply ─────────────────────────────────────────────────────────
    const handleDirectApply = async () => {
        if (selectedIds.length === 0) return;

        setShowProgress(true);
        setProgressTitle("Applying Configuration");
        setCanCloseProgress(false);

        const getTargetName = (id: string) =>
            workload === "directoryRoles"
                ? rolesData?.find(r => r.definition.id === id)?.definition.displayName || id
                : groupsData?.find(g => g.group.id === id)?.group.displayName || id;

        const steps: ProgressStep[] = selectedIds.map(id => ({
            id,
            label: getTargetName(id),
            status: "pending" as const,
            details: workload === "directoryRoles" ? "Role policy update" : "Group policy update",
        }));
        setProgressSteps([...steps]);

        let totalSucceeded = 0;
        let totalFailed = 0;

        try {
            const client = await getGraphClient();

            for (let i = 0; i < selectedIds.length; i++) {
                const id = selectedIds[i];
                steps[i].status = "loading";
                setProgressSteps([...steps]);

                try {
                    let results: ApplyOperationResult[];

                    if (workload === "directoryRoles") {
                        results = await applyDirectoryRolePolicies(client, [id], memberSettings);
                    } else {
                        // Intentionally not wrapped — applyGroupPolicies handles retry internally
                        const [memberResults, ownerResults] = await Promise.all([
                            applyGroupPolicies(client, [id], memberSettings, "member"),
                            applyGroupPolicies(client, [id], ownerSettings, "owner"),
                        ]);
                        results = [...memberResults, ...ownerResults];
                    }

                    const failed = results.filter(r => !r.success).length;
                    steps[i].status = failed === 0 ? "success" : "error";
                    steps[i].details = failed > 0
                        ? `${failed} operation(s) failed`
                        : workload === "directoryRoles" ? "Role policy updated" : "Group policies updated";

                    if (failed === 0) totalSucceeded++;
                    else totalFailed++;
                } catch (err) {
                    Logger.error("ManualMode", `Failed to apply ${getTargetName(id)}`, err);
                    steps[i].status = "error";
                    steps[i].details = "Apply failed";
                    totalFailed++;
                }

                setProgressSteps([...steps]);
            }

            setCanCloseProgress(true);

            if (totalFailed === 0) {
                toast.success("Configuration Applied", `Successfully updated ${totalSucceeded} target(s)`);
                setTimeout(() => setShowProgress(false), 1500);
            } else {
                toast.warning("Partial Success", `${totalSucceeded} succeeded, ${totalFailed} failed`);
                // Leave modal open so user can read per-row failures; canCloseProgress lets them close manually
            }

            // Refresh global context data + force policy re-fetch for current selection
            void refreshWorkload(workload);
            setReloadTrigger(t => t + 1);
        } catch (err) {
            Logger.error("ManualMode", "Direct apply error", err);
            steps.forEach((s, i) => {
                if (s.status === "pending" || s.status === "loading") {
                    steps[i].status = "error";
                    steps[i].details = "Aborted";
                }
            });
            setProgressSteps([...steps]);
            setCanCloseProgress(true);
            toast.error("Apply Failed", "An error occurred while applying settings");
        }
    };

    // ── Apply All Staged ─────────────────────────────────────────────────────
    const handleApplyAllStaged = async () => {
        if (stagedChanges.length === 0) return;

        setShowProgress(true);
        setProgressTitle("Applying All Staged Changes");
        setCanCloseProgress(false);

        const steps: ProgressStep[] = stagedChanges.map(c => ({
            id: c.id,
            label: c.targetName,
            status: "pending" as const,
            details: `${c.workload === "directoryRoles" ? "Role" : "Group"} policy update`
        }));
        setProgressSteps([...steps]);

        let totalSucceeded = 0;
        let totalFailed = 0;

        try {
            const client = await getGraphClient();

            for (let i = 0; i < stagedChanges.length; i++) {
                const change = stagedChanges[i];
                steps[i].status = "loading";
                setProgressSteps([...steps]);

                try {
                    let results: ApplyOperationResult[];

                    if (change.workload === "directoryRoles") {
                        results = await applyDirectoryRolePolicies(client, [change.targetId], change.settings);
                    } else {
                        // Intentionally not wrapped — applyGroupPolicies handles retry internally
                        const [memberResults, ownerResults] = await Promise.all([
                            applyGroupPolicies(client, [change.targetId], change.settings, "member"),
                            applyGroupPolicies(client, [change.targetId], change.ownerSettings || change.settings, "owner"),
                        ]);
                        results = [...memberResults, ...ownerResults];
                    }

                    const failed = results.filter(r => !r.success).length;
                    steps[i].status = failed === 0 ? "success" : "error";
                    steps[i].details = failed > 0 ? `${failed} operation(s) failed` : "Applied";

                    if (failed === 0) totalSucceeded++;
                    else totalFailed++;
                } catch (err) {
                    Logger.error("ManualMode", `Failed to apply ${change.targetName}`, err);
                    steps[i].status = "error";
                    steps[i].details = "Failed";
                    totalFailed++;
                }

                setProgressSteps([...steps]);
            }

            setCanCloseProgress(true);
            const appliedWorkloads = new Set(stagedChanges.map(c => c.workload));
            setStagedChanges([]);

            if (totalFailed === 0) {
                toast.success("All Changes Applied", `Successfully updated ${totalSucceeded} target(s)`);
            } else {
                toast.warning("Partial Success", `${totalSucceeded} succeeded, ${totalFailed} failed`);
            }

            // Refresh global context data + force policy re-fetch for current selection
            for (const w of appliedWorkloads) void refreshWorkload(w);
            setReloadTrigger(t => t + 1);
        } catch (err) {
            Logger.error("ManualMode", "Apply all staged error", err);
            setCanCloseProgress(true);
            toast.error("Apply Failed", "An error occurred while applying changes");
        }
    };

    return (
        <div>
            {/* Back Button */}
            <button
                onClick={onBack}
                className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 mb-6 transition-colors"
            >
                <ArrowLeft className="h-4 w-4" />
                Back to Mode Selection
            </button>

            {/* Permission Warning */}
            {missingWriteConsent && (
                <div className="mb-6 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg flex items-start gap-3">
                    <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                        <h4 className="text-sm font-medium text-amber-900 dark:text-amber-100">Write permissions required</h4>
                        <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                            To configure settings, you must grant write permissions.
                        </p>
                        <button
                            onClick={() => setShowSettingsModal(true)}
                            className="mt-2 text-sm font-medium text-amber-700 dark:text-amber-300 underline hover:text-amber-800 dark:hover:text-amber-200"
                        >
                            Open Settings
                        </button>
                    </div>
                </div>
            )}

            {/* Workload Tabs */}
            <div className="mb-6 flex gap-2">
                {(["directoryRoles", "pimGroups"] as const).map(w => (
                    <button
                        key={w}
                        onClick={() => handleWorkloadChange(w)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${workload === w
                            ? "bg-blue-600 text-white shadow-lg shadow-blue-500/25"
                            : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                            }`}
                    >
                        {w === "directoryRoles" ? <Shield className="h-4 w-4" /> : <Users className="h-4 w-4" />}
                        {w === "directoryRoles" ? "Directory Roles" : "PIM Groups"}
                    </button>
                ))}
            </div>

            {/* Main Content Grid */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                {/* Column 1: Selector */}
                <div className="xl:col-span-1">
                    {workload === "directoryRoles" ? (
                        <RoleSelector
                            onSelectionChange={setSelectedRoleIds}
                            rolesData={rolesData}
                            loading={rolesLoading}
                        />
                    ) : (
                        <GroupSelector
                            groupsData={groupsData}
                            loading={groupsLoading}
                            onSelectionChange={setSelectedGroupIds}
                        />
                    )}
                </div>

                {/* Column 2: Policy Settings / Assignments (tabbed) */}
                <div className="xl:col-span-1">
                    {selectedIds.length === 0 ? (
                        <div className="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-8 text-center">
                            <Shield className="w-12 h-12 mx-auto text-zinc-300 dark:text-zinc-600 mb-4" />
                            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-2">No Selection</h3>
                            <p className="text-sm text-zinc-500">
                                Select one or more {workload === "directoryRoles" ? "roles" : "groups"} to configure.
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {/* Header: name + tabs */}
                            <div className="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
                                <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">
                                    {selectedIds.length === 1 && selectedTargetName
                                        ? selectedTargetName
                                        : `${selectedIds.length} ${workload === "directoryRoles" ? "roles" : "groups"} selected`}
                                </h3>
                                {selectedIds.length > 1 && (
                                    <p className="text-xs text-zinc-500 mt-1">
                                        Settings will apply to all selected targets. No settings are pre-loaded for multi-selection.
                                    </p>
                                )}

                                {/* Tab switcher */}
                                <div className="mt-4 flex rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                                    <button
                                        onClick={() => setActiveTab("policy")}
                                        className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium transition-colors ${activeTab === "policy"
                                            ? "bg-blue-600 text-white"
                                            : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-700"
                                        }`}
                                    >
                                        <Shield className="w-3.5 h-3.5" />
                                        Policy Settings
                                    </button>
                                    <button
                                        onClick={() => setActiveTab("assignments")}
                                        className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium border-l border-zinc-200 dark:border-zinc-700 transition-colors ${activeTab === "assignments"
                                            ? "bg-blue-600 text-white"
                                            : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-700"
                                        }`}
                                    >
                                        <UserPlus className="w-3.5 h-3.5" />
                                        Assignments
                                    </button>
                                </div>
                            </div>

                            {/* Tab: Policy Settings */}
                            {activeTab === "policy" && (
                                <>
                                    <PolicySettingsForm
                                        value={memberSettings}
                                        onChange={setMemberSettings}
                                        workload={workload}
                                        accessType={accessType}
                                        onAccessTypeChange={workload === "pimGroups" ? setAccessType : undefined}
                                        ownerValue={ownerSettings}
                                        onOwnerChange={workload === "pimGroups" ? setOwnerSettings : undefined}
                                        configSource={configSource}
                                        isLoading={isLoadingSettings}
                                    />
                                    <div className="flex gap-2">
                                        <button
                                            onClick={handleStageChanges}
                                            disabled={isLoadingSettings}
                                            className="flex-1 px-3 py-2 text-sm bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 rounded-lg hover:bg-amber-200 dark:hover:bg-amber-800/50 transition-colors disabled:opacity-50 font-medium"
                                        >
                                            Stage Changes
                                        </button>
                                        <button
                                            onClick={handleDirectApply}
                                            disabled={isLoadingSettings || missingWriteConsent}
                                            className="flex-1 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 font-medium"
                                        >
                                            Apply Now
                                        </button>
                                    </div>
                                </>
                            )}

                            {/* Tab: Assignments */}
                            {activeTab === "assignments" && (
                                <AssignmentPanel
                                    selectedIds={selectedIds}
                                    workload={workload}
                                    policies={memberSettings}
                                    ownerPolicies={workload === "pimGroups" ? ownerSettings : undefined}
                                    disabled={missingWriteConsent}
                                    onClose={() => setActiveTab("policy")}
                                    onApplied={() => {
                                        void refreshWorkload(workload);
                                        setReloadTrigger(t => t + 1);
                                    }}
                                />
                            )}
                        </div>
                    )}
                </div>

                {/* Column 3: Staged Changes */}
                <div className="xl:col-span-1">
                    <StagedChangesPanel
                        changes={stagedChanges}
                        onRemove={handleRemoveStagedChange}
                        onClearAll={handleClearAllStaged}
                        onApplyAll={handleApplyAllStaged}
                        disabled={stagedMissingConsent}
                    />
                </div>
            </div>

            {/* Modals */}
            <SettingsModal
                isOpen={showSettingsModal}
                onClose={() => setShowSettingsModal(false)}
            />

            <ProgressModal
                isOpen={showProgress}
                title={progressTitle}
                steps={progressSteps}
                onClose={() => setShowProgress(false)}
                canClose={canCloseProgress}
            />
        </div>
    );
}

// ── Staged Changes Panel ──────────────────────────────────────────────────────

interface StagedChangesPanelProps {
    changes: StagedChange[];
    onRemove: (id: string) => void;
    onClearAll: () => void;
    onApplyAll: () => void;
    disabled?: boolean;
}

function StagedChangesPanel({ changes, onRemove, onClearAll, onApplyAll, disabled }: StagedChangesPanelProps) {
    if (changes.length === 0) {
        return (
            <div className="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-8 text-center">
                <Layers className="w-12 h-12 mx-auto text-zinc-300 dark:text-zinc-600 mb-4" />
                <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-2">No Staged Changes</h3>
                <p className="text-sm text-zinc-500">
                    Select targets and use &ldquo;Stage Changes&rdquo; to queue configuration updates before applying.
                </p>
            </div>
        );
    }

    return (
        <div className="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
            <div className="p-4 border-b border-zinc-200 dark:border-zinc-700 flex items-center justify-between">
                <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                    <Layers className="w-5 h-5 text-amber-500" />
                    Staged Changes ({changes.length})
                </h3>
                <button
                    onClick={onClearAll}
                    className="text-xs text-zinc-500 hover:text-red-500 transition-colors"
                >
                    Clear All
                </button>
            </div>
            <div className="max-h-[300px] overflow-y-auto p-2 space-y-2">
                {changes.map(change => (
                    <div
                        key={change.id}
                        className="flex items-center justify-between p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg"
                    >
                        <div className="flex items-center gap-3 min-w-0">
                            {change.workload === "directoryRoles"
                                ? <Shield className="w-4 h-4 text-amber-600 flex-shrink-0" />
                                : <Users className="w-4 h-4 text-amber-600 flex-shrink-0" />
                            }
                            <div className="min-w-0">
                                <div className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
                                    {change.targetName}
                                </div>
                                <div className="text-xs text-amber-600 dark:text-amber-400">
                                    Policy update staged
                                    {change.workload === "pimGroups" && " (member + owner)"}
                                </div>
                            </div>
                        </div>
                        <button
                            onClick={() => onRemove(change.id)}
                            className="p-1 text-zinc-400 hover:text-red-500 transition-colors"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                ))}
            </div>
            <div className="p-4 border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50">
                <button
                    onClick={onApplyAll}
                    disabled={disabled}
                    className="w-full py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 text-white disabled:text-zinc-400 font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                    <Check className="w-4 h-4" />
                    Apply All ({changes.length})
                </button>
                {disabled && (
                    <p className="text-xs text-zinc-500 text-center mt-2">Write permissions required</p>
                )}
            </div>
        </div>
    );
}
