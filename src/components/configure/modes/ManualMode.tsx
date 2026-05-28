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
import { ApplyOperationResult, AssignmentConfig } from "@/types/wizard.types";
import {
    applyDirectoryRolePolicies,
    applyGroupPolicies,
    applyDirectoryRoleRemovals,
    applyGroupRemovals,
    applyDirectoryRoleAssignments,
    applyGroupAssignments,
} from "@/services/wizardApplyService";
import { detectPolicyConflicts, PolicyConflict } from "@/utils/policyConflicts";
import { AssignmentRemoval } from "@/types/wizard.types";

import { GroupSelector } from "@/components/configure/shared/GroupSelector";
import { PolicySettingsForm, DEFAULT_POLICY_SETTINGS } from "@/components/configure/shared/PolicySettingsForm";
import { AssignmentPanel, AssignmentStagePayload } from "@/components/configure/shared/AssignmentPanel";
import { PreflightWarnings } from "@/components/configure/shared/PreflightWarnings";
import {
    isHighRiskRoleName,
    detectPolicyExtensions,
    isScratchPermanentRiskyOnPrivileged,
    formatExtensionLine,
} from "@/utils/policyPreflight";
import { ConfigureWorkloadType as WorkloadType } from '@/types/workload.types';
import { Logger } from "@/utils/logger";

interface StagedPolicyChange {
    id: string;
    kind: "policy";
    targetId: string;
    targetName: string;
    workload: WorkloadType;
    /** Member policy (or only policy for directoryRoles) */
    settings: PolicySettings;
    /** Owner policy (pimGroups only) */
    ownerSettings?: PolicySettings;
    timestamp: number;
}

interface StagedAssignmentChange {
    id: string;
    kind: "assignment";
    workload: WorkloadType;
    /** Targets the assignment/removal will be created on. For removals we use
     *  targetIds[0] only, matching AssignmentPanel's runtime behavior. */
    targetIds: string[];
    targetNames: string[];
    config?: AssignmentConfig;
    allowPermanent?: boolean;
    removals?: AssignmentRemoval[];
    timestamp: number;
}

type StagedChange = StagedPolicyChange | StagedAssignmentChange;

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

    // Conflict modal state — populated when a policy apply would leave existing
    // assignments in violation (Microsoft does not retroactively reconcile).
    const [conflictModal, setConflictModal] = useState<{
        conflicts: PolicyConflict[];
        onApplyOnly: () => void;
        onApplyAndRemove: () => void;
        onCancel: () => void;
    } | null>(null);

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

    // ── Preflight: surface Microsoft-rejection risks for selected target(s) ──
    // Mirrors the wizard's ReviewStep callouts so admins see the same warnings
    // before they stage or apply policy changes in Manual mode.
    const preflight = useMemo(() => {
        if (workload !== "directoryRoles" || selectedIds.length === 0) {
            return { hasHighRiskTargets: false, scratchRiskyOnPrivileged: false, extensionLines: [] as string[] };
        }
        const items = selectedIds.map(id => ({
            id,
            name: rolesData?.find(r => r.definition.id === id)?.definition.displayName || id,
        }));
        const hasHighRiskTargets = items.some(it => isHighRiskRoleName(it.name));
        const offenders = [];
        for (const it of items) {
            const r = rolesData?.find(x => x.definition.id === it.id);
            const rules = r?.policy?.details?.rules;
            if (!rules) continue;
            offenders.push(...detectPolicyExtensions(it.name, parseGraphPolicy({ rules }), memberSettings));
        }
        return {
            hasHighRiskTargets,
            scratchRiskyOnPrivileged: isScratchPermanentRiskyOnPrivileged({
                configSource,
                policies: memberSettings,
                hasHighRiskTargets,
            }),
            extensionLines: offenders.map(formatExtensionLine),
        };
    }, [workload, selectedIds, rolesData, memberSettings, configSource]);

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
                kind: "policy" as const,
                targetId: id,
                targetName,
                workload,
                settings: { ...memberSettings },
                ownerSettings: workload === "pimGroups" ? { ...ownerSettings } : undefined,
                timestamp: Date.now()
            };
        });

        setStagedChanges(prev => {
            const existingIds = new Set(selectedIds);
            // Drop any prior policy stage for the same targets in this workload;
            // assignment stages survive (they're independent).
            const filtered = prev.filter(c => c.kind !== "policy" || !existingIds.has(c.targetId) || c.workload !== workload);
            return [...filtered, ...newChanges];
        });

        toast.success(
            "Changes Staged",
            `${selectedIds.length} ${workload === "directoryRoles" ? "role" : "group"}(s) ready for apply`
        );
    };

    const handleStageAssignments = (payload: AssignmentStagePayload) => {
        if (selectedIds.length === 0) return;
        const targetNames = selectedIds.map(id => getTargetName(id));
        const change: StagedAssignmentChange = {
            id: `assign-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            kind: "assignment",
            workload,
            targetIds: [...selectedIds],
            targetNames,
            config: payload.config,
            allowPermanent: payload.allowPermanent,
            removals: payload.removals,
            timestamp: Date.now(),
        };
        setStagedChanges(prev => [...prev, change]);
        const memberCount = payload.config?.principalIds.length ?? 0;
        const removalCount = payload.removals?.length ?? 0;
        toast.success(
            "Assignment Changes Staged",
            `${memberCount} new · ${removalCount} removal${removalCount === 1 ? "" : "s"} queued`
        );
    };

    const handleRemoveStagedChange = (changeId: string) => {
        setStagedChanges(prev => prev.filter(c => c.id !== changeId));
    };

    const handleClearAllStaged = () => {
        setStagedChanges([]);
        toast.info("Staged Changes Cleared", "All pending changes have been removed");
    };

    // Convert PolicyConflict objects to the AssignmentRemoval shape that the
    // apply service expects.
    const conflictsToRemovalsByTarget = (conflicts: PolicyConflict[]): Map<string, AssignmentRemoval[]> => {
        const map = new Map<string, AssignmentRemoval[]>();
        for (const c of conflicts) {
            const list = map.get(c.targetId) ?? [];
            list.push({
                assignmentId: c.assignmentId,
                principalId: c.principalId,
                roleDefinitionId: c.roleDefinitionId ?? "",
                directoryScopeId: c.directoryScopeId ?? "/",
                assignmentType: c.assignmentType,
                groupId: c.groupId,
            });
            map.set(c.targetId, list);
        }
        return map;
    };

    const getTargetName = (id: string) =>
        workload === "directoryRoles"
            ? rolesData?.find(r => r.definition.id === id)?.definition.displayName || id
            : groupsData?.find(g => g.group.id === id)?.group.displayName || id;

    // ── Direct Apply ─────────────────────────────────────────────────────────
    const handleDirectApply = async () => {
        if (selectedIds.length === 0) return;

        // Conflict precheck against the pending policy
        try {
            const client = await getGraphClient();
            const nameMap = new Map(selectedIds.map(id => [id, getTargetName(id)]));
            const conflicts = await detectPolicyConflicts(client, {
                workload,
                selectedIds,
                nameMap,
                pendingPolicy: memberSettings,
                pendingOwnerPolicy: workload === "pimGroups" ? ownerSettings : undefined,
            });
            if (conflicts.length > 0) {
                setConflictModal({
                    conflicts,
                    onApplyOnly: () => { setConflictModal(null); void runDirectApply(undefined); },
                    onApplyAndRemove: () => { setConflictModal(null); void runDirectApply(conflictsToRemovalsByTarget(conflicts)); },
                    onCancel: () => setConflictModal(null),
                });
                return;
            }
        } catch (err) {
            Logger.warn("ManualMode", "Conflict precheck failed — proceeding without it", err);
        }
        await runDirectApply(undefined);
    };

    const runDirectApply = async (removalsByTarget?: Map<string, AssignmentRemoval[]>) => {
        if (selectedIds.length === 0) return;

        setShowProgress(true);
        setProgressTitle("Applying Configuration");
        setCanCloseProgress(false);

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

                    // Apply conflict-removals for this target, if requested
                    let removalsFailed = 0;
                    let removalsApplied = 0;
                    const targetRemovals = removalsByTarget?.get(id) ?? [];
                    if (targetRemovals.length > 0) {
                        try {
                            const removalResult = workload === "directoryRoles"
                                ? await applyDirectoryRoleRemovals(client, id, targetRemovals)
                                : await applyGroupRemovals(client, id, targetRemovals);
                            removalsApplied = removalResult.removalsCompleted;
                            removalsFailed = removalResult.removalsFailed;
                        } catch (rerr) {
                            Logger.error("ManualMode", `Conflict removals failed for ${getTargetName(id)}`, rerr);
                            removalsFailed = targetRemovals.length;
                        }
                    }

                    steps[i].status = failed === 0 && removalsFailed === 0 ? "success" : "error";
                    steps[i].details = failed > 0
                        ? `${failed} operation(s) failed`
                        : removalsFailed > 0
                            ? `Policy applied; ${removalsFailed} conflict removal(s) failed`
                            : removalsApplied > 0
                                ? `Policy applied; ${removalsApplied} conflict(s) removed`
                                : workload === "directoryRoles" ? "Role policy updated" : "Group policies updated";

                    if (failed === 0 && removalsFailed === 0) totalSucceeded++;
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

        // Conflict precheck — detect against the union of all staged changes.
        // We group by workload, then per-target pass the staged policy through.
        try {
            const client = await getGraphClient();
            // Conflict precheck only applies to policy stages — assignment stages
            // don't tighten a policy, so they can't strand existing assignments.
            const policyStages = stagedChanges.filter((c): c is StagedPolicyChange => c.kind === "policy");
            const roleChanges = policyStages.filter(c => c.workload === "directoryRoles");
            const groupChanges = policyStages.filter(c => c.workload === "pimGroups");
            const allConflicts: PolicyConflict[] = [];

            for (const c of roleChanges) {
                const nm = new Map([[c.targetId, c.targetName]]);
                const conflicts = await detectPolicyConflicts(client, {
                    workload: "directoryRoles",
                    selectedIds: [c.targetId],
                    nameMap: nm,
                    pendingPolicy: c.settings,
                });
                allConflicts.push(...conflicts);
            }
            for (const c of groupChanges) {
                const nm = new Map([[c.targetId, c.targetName]]);
                const conflicts = await detectPolicyConflicts(client, {
                    workload: "pimGroups",
                    selectedIds: [c.targetId],
                    nameMap: nm,
                    pendingPolicy: c.settings,
                    pendingOwnerPolicy: c.ownerSettings,
                });
                allConflicts.push(...conflicts);
            }

            if (allConflicts.length > 0) {
                setConflictModal({
                    conflicts: allConflicts,
                    onApplyOnly: () => { setConflictModal(null); void runApplyAllStaged(undefined); },
                    onApplyAndRemove: () => { setConflictModal(null); void runApplyAllStaged(conflictsToRemovalsByTarget(allConflicts)); },
                    onCancel: () => setConflictModal(null),
                });
                return;
            }
        } catch (err) {
            Logger.warn("ManualMode", "Staged conflict precheck failed — proceeding without it", err);
        }
        await runApplyAllStaged(undefined);
    };

    const runApplyAllStaged = async (removalsByTarget?: Map<string, AssignmentRemoval[]>) => {
        if (stagedChanges.length === 0) return;

        setShowProgress(true);
        setProgressTitle("Applying All Staged Changes");
        setCanCloseProgress(false);

        const describeChange = (c: StagedChange) =>
            c.kind === "policy"
                ? `${c.workload === "directoryRoles" ? "Role" : "Group"} policy update`
                : `Assignment update (${c.config?.principalIds.length ?? 0} new, ${c.removals?.length ?? 0} removed)`;
        const stepLabel = (c: StagedChange) =>
            c.kind === "policy" ? c.targetName : c.targetNames.join(", ");

        const steps: ProgressStep[] = stagedChanges.map(c => ({
            id: c.id,
            label: stepLabel(c),
            status: "pending" as const,
            details: describeChange(c),
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
                    let results: ApplyOperationResult[] = [];
                    let detailMessage = "Applied";

                    if (change.kind === "policy") {
                        if (change.workload === "directoryRoles") {
                            results = await applyDirectoryRolePolicies(client, [change.targetId], change.settings);
                        } else {
                            // Apply member always; only apply owner when explicitly staged,
                            // otherwise we'd overwrite the existing owner policy with member settings.
                            const memberResults = await applyGroupPolicies(client, [change.targetId], change.settings, "member");
                            const ownerResults = change.ownerSettings
                                ? await applyGroupPolicies(client, [change.targetId], change.ownerSettings, "owner")
                                : [];
                            results = [...memberResults, ...ownerResults];
                        }

                        // Run conflict-removals for this staged target, if requested
                        let removalsFailed = 0;
                        let removalsApplied = 0;
                        const targetRemovals = removalsByTarget?.get(change.targetId) ?? [];
                        if (targetRemovals.length > 0) {
                            try {
                                const removalResult = change.workload === "directoryRoles"
                                    ? await applyDirectoryRoleRemovals(client, change.targetId, targetRemovals)
                                    : await applyGroupRemovals(client, change.targetId, targetRemovals);
                                removalsApplied = removalResult.removalsCompleted;
                                removalsFailed = removalResult.removalsFailed;
                            } catch (rerr) {
                                Logger.error("ManualMode", `Conflict removals failed for ${change.targetName}`, rerr);
                                removalsFailed = targetRemovals.length;
                            }
                        }

                        const failed = results.filter(r => !r.success).length;
                        detailMessage = failed > 0
                            ? `${failed} operation(s) failed`
                            : removalsFailed > 0
                                ? `Policy applied; ${removalsFailed} conflict removal(s) failed`
                                : removalsApplied > 0
                                    ? `Policy applied; ${removalsApplied} conflict(s) removed`
                                    : "Applied";
                        steps[i].status = failed === 0 && removalsFailed === 0 ? "success" : "error";
                    } else {
                        // Assignment stage — dispatch new assignments + staged removals
                        if (change.config) {
                            const createResults = change.workload === "directoryRoles"
                                ? await applyDirectoryRoleAssignments(client, change.targetIds, change.config, change.allowPermanent ?? true)
                                : await applyGroupAssignments(client, change.targetIds, change.config, change.allowPermanent ?? true);
                            results.push(...createResults);
                        }
                        if (change.removals && change.removals.length > 0) {
                            const removalTarget = change.targetIds[0];
                            const removalResult = change.workload === "directoryRoles"
                                ? await applyDirectoryRoleRemovals(client, removalTarget, change.removals)
                                : await applyGroupRemovals(client, removalTarget, change.removals);
                            results.push(...removalResult.operations);
                        }
                        const failed = results.filter(r => !r.success).length;
                        detailMessage = failed > 0 ? `${failed} operation(s) failed` : "Applied";
                        steps[i].status = failed === 0 ? "success" : "error";
                    }

                    steps[i].details = detailMessage;
                    if (steps[i].status === "success") totalSucceeded++;
                    else totalFailed++;
                } catch (err) {
                    const label = stepLabel(change);
                    Logger.error("ManualMode", `Failed to apply ${label}`, err);
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

                {/* Column 2: Policy Settings / Assignments (tabbed).
                    Assignments tab expands to take the remaining grid width —
                    AssignmentPanel renders an inner two-column form and gets
                    squeezed in a single grid column. */}
                <div className={activeTab === "assignments" ? "xl:col-span-2" : "xl:col-span-1"}>
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

                            {/* Tab: Policy Settings — kept mounted so switching
                                tabs preserves AssignmentPanel's internal state
                                (selected members, duration, dates, etc.) */}
                            <div className={activeTab === "policy" ? "space-y-4" : "hidden"}>
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
                                    <PreflightWarnings
                                        hasHighRiskTargets={preflight.hasHighRiskTargets}
                                        scratchRiskyOnPrivileged={preflight.scratchRiskyOnPrivileged}
                                        extensionLines={preflight.extensionLines}
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
                            </div>

                            {/* Tab: Assignments — also kept mounted to preserve state */}
                            <div className={activeTab === "assignments" ? "" : "hidden"}>
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
                                    onStage={handleStageAssignments}
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* Column 3: Staged Changes — policy flow only; hide on
                    Assignments tab so col 2 can expand. */}
                {activeTab === "policy" && (
                <div className="xl:col-span-1">
                    <StagedChangesPanel
                        changes={stagedChanges}
                        onRemove={handleRemoveStagedChange}
                        onClearAll={handleClearAllStaged}
                        onApplyAll={handleApplyAllStaged}
                        disabled={stagedMissingConsent}
                    />
                </div>
                )}
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

            <ConflictModal modal={conflictModal} />
        </div>
    );
}

// ── Conflict Modal ───────────────────────────────────────────────────────────
function ConflictModal({ modal }: { modal: {
    conflicts: PolicyConflict[];
    onApplyOnly: () => void;
    onApplyAndRemove: () => void;
    onCancel: () => void;
} | null }) {
    if (!modal) return null;
    const { conflicts, onApplyOnly, onApplyAndRemove, onCancel } = modal;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-xl w-full max-w-xl mx-auto overflow-hidden">
                <div className="p-4 border-b border-zinc-200 dark:border-zinc-700 flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-orange-500" />
                    <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">
                        {conflicts.length} existing assignment{conflicts.length === 1 ? "" : "s"} will violate the new policy
                    </h3>
                </div>
                <div className="p-4 space-y-3 max-h-[50vh] overflow-y-auto">
                    <p className="text-sm text-zinc-600 dark:text-zinc-400">
                        Microsoft PIM does not retroactively reconcile assignments when a policy is tightened. Choose how to proceed:
                    </p>
                    <ul className="space-y-1.5">
                        {conflicts.slice(0, 8).map(c => (
                            <li key={`${c.targetId}:${c.assignmentId}`} className="text-xs p-2 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded">
                                <div className="font-medium text-zinc-900 dark:text-zinc-100">{c.principalDisplayName}</div>
                                <div className="text-zinc-500 dark:text-zinc-400">
                                    {c.targetName} · {c.assignmentType}{c.accessType ? ` · ${c.accessType}` : ""}
                                </div>
                                <div className="text-orange-700 dark:text-orange-300 mt-0.5">{c.detail}</div>
                            </li>
                        ))}
                        {conflicts.length > 8 && (
                            <li className="text-xs text-zinc-500 italic">
                                +{conflicts.length - 8} more
                            </li>
                        )}
                    </ul>
                </div>
                <div className="p-4 border-t border-zinc-200 dark:border-zinc-700 flex items-center justify-end gap-2">
                    <button
                        onClick={onCancel}
                        className="px-3 py-1.5 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onApplyOnly}
                        className="px-3 py-1.5 text-sm font-medium text-orange-700 dark:text-orange-300 bg-orange-50 dark:bg-orange-900/20 hover:bg-orange-100 dark:hover:bg-orange-900/40 border border-orange-200 dark:border-orange-800 rounded-md"
                    >
                        Apply policy only
                    </button>
                    <button
                        onClick={onApplyAndRemove}
                        className="px-3 py-1.5 text-sm font-medium text-white bg-orange-600 hover:bg-orange-700 rounded-md"
                    >
                        Apply &amp; remove {conflicts.length} assignment{conflicts.length === 1 ? "" : "s"}
                    </button>
                </div>
            </div>
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
                {changes.map(change => {
                    const isPolicy = change.kind === "policy";
                    const label = isPolicy ? change.targetName : change.targetNames.join(", ");
                    const subtitle = isPolicy
                        ? `Policy update staged${change.workload === "pimGroups" ? " (member + owner)" : ""}`
                        : `Assignments staged · ${change.config?.principalIds.length ?? 0} new, ${change.removals?.length ?? 0} removed`;
                    return (
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
                                        {label}
                                    </div>
                                    <div className="text-xs text-amber-600 dark:text-amber-400">
                                        {subtitle}
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
                    );
                })}
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
