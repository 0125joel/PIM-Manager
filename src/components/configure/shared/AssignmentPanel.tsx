"use client";

import React, { useState, useCallback } from 'react';
import { Logger } from '@/utils/logger';
import { X, AlertTriangle, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { PolicySettings, AssignmentConfig, AssignmentRemoval } from '@/hooks/useWizardState';

export interface AssignmentStagePayload {
    /** Optional new-assignment config (omitted when the user only stages removals) */
    config?: AssignmentConfig;
    /** Whether permanent is policy-allowed for the chosen assignment type */
    allowPermanent?: boolean;
    /** Optional removals to stage alongside (or instead of) new assignments */
    removals?: AssignmentRemoval[];
}
import { PrincipalSelector, Principal } from './PrincipalSelector';
import { AssignmentScopePicker } from './AssignmentScopePicker';
import { AssignmentTypeCard } from './AssignmentTypeCard';
import { DurationSettingsCard } from './DurationSettingsCard';
import { ExistingAssignmentsPanel } from './ExistingAssignmentsPanel';
import { useAssignmentData } from './useAssignmentData';
import { LocalAssignmentState, ExistingAssignment } from './assignmentTypes';
import { useUnifiedPimData } from '@/contexts/UnifiedPimContext';
import { useToastActions } from '@/contexts/ToastContext';
import { ApplyOperationResult } from '@/types/wizard.types';
import {
    applyDirectoryRoleAssignments,
    applyGroupAssignments,
    applyDirectoryRoleRemovals,
    applyGroupRemovals,
} from '@/services/wizardApplyService';
import { toLocalDateTimeInputValue } from '@/utils/durationUtils';

interface AssignmentPanelProps {
    selectedIds: string[];
    workload: "directoryRoles" | "pimGroups";
    /** Current policy settings for constraint checking (permanent allowed?) */
    policies?: PolicySettings;
    /** Owner policy for PIM Groups — used when groupRole === "owner" */
    ownerPolicies?: PolicySettings;
    onClose: () => void;
    onApplied?: (results: ApplyOperationResult[]) => void;
    /** When true, renders a consent banner and disables the Apply button */
    disabled?: boolean;
    /** Optional — when provided, a "Stage" button appears next to Apply that
     *  hands the assembled payload to the parent (for Manual mode's batched
     *  apply workflow). The panel resets after staging. */
    onStage?: (payload: AssignmentStagePayload) => void;
}

type ApplyStatus = "idle" | "applying" | "done";

interface ApplyResult {
    success: number;
    failed: number;
    operations: ApplyOperationResult[];
}

export function AssignmentPanel({ selectedIds, workload, policies, ownerPolicies, onClose, onApplied, disabled, onStage }: AssignmentPanelProps) {
    const { getGraphClient } = useUnifiedPimData();
    const toast = useToastActions();
    const isGroups = workload === "pimGroups";

    // ── Local Assignment State ───────────────────────────────────────────────
    const defaultStart = toLocalDateTimeInputValue();

    const [assignments, setAssignments] = useState<LocalAssignmentState>({
        members: [],
        type: "eligible",
        duration: "permanent",
        startDate: defaultStart,
        endDate: "",
        justification: "",
        groupRole: "member",
        scopeId: "/"
    });

    const [removals, setRemovals] = useState<AssignmentRemoval[]>([]);
    const [applyStatus, setApplyStatus] = useState<ApplyStatus>("idle");
    const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);

    // ── Data Hook ────────────────────────────────────────────────────────────
    const {
        adminUnits,
        existingAssignments,
        isLoadingAssignments,
        fetchExistingAssignments,
    } = useAssignmentData({ workload, selectedIds, skipScopeFetch: true });

    const updateState = useCallback((updates: Partial<LocalAssignmentState>) => {
        setAssignments(prev => ({ ...prev, ...updates }));
    }, []);

    // ── Removal Handlers ─────────────────────────────────────────────────────
    const handleRemoveAssignment = useCallback((assignment: ExistingAssignment) => {
        setRemovals(prev => [...prev, {
            assignmentId: assignment.id,
            principalId: assignment.principalId,
            roleDefinitionId: assignment.roleDefinitionId,
            directoryScopeId: assignment.directoryScopeId,
            assignmentType: assignment.assignmentType,
            groupId: isGroups ? selectedIds[0] : undefined
        }]);
    }, [isGroups, selectedIds]);

    const handleCancelRemoval = useCallback((assignmentId: string) => {
        setRemovals(prev => prev.filter(r => r.assignmentId !== assignmentId));
    }, []);

    // ── Apply ─────────────────────────────────────────────────────────────────
    const handleApply = useCallback(async () => {
        const hasNewAssignments = assignments.members.length > 0;
        const hasRemovals = removals.length > 0;
        if (!hasNewAssignments && !hasRemovals) return;

        setApplyStatus("applying");
        const allResults: ApplyOperationResult[] = [];

        try {
            const client = await getGraphClient();

            // Create new assignments
            if (hasNewAssignments) {
                const assignmentConfig: AssignmentConfig = {
                    principalIds: assignments.members.map(m => m.id),
                    assignmentType: assignments.type,
                    duration: assignments.duration,
                    startDateTime: assignments.startDate,
                    endDateTime: assignments.duration === "bounded" ? assignments.endDate : undefined,
                    justification: assignments.justification || undefined,
                    accessType: isGroups ? assignments.groupRole : undefined,
                    directoryScopeId: !isGroups ? assignments.scopeId : undefined,
                };

                const effectivePolicies = isGroups && assignments.groupRole === "owner"
                    ? (ownerPolicies ?? policies)
                    : policies;

                const allowPermanent = assignments.type === "eligible"
                    ? (effectivePolicies?.allowPermanentEligible ?? true)
                    : (effectivePolicies?.allowPermanentActive ?? true);

                let results: ApplyOperationResult[];
                if (workload === "directoryRoles") {
                    results = await applyDirectoryRoleAssignments(client, selectedIds, assignmentConfig, allowPermanent);
                } else {
                    results = await applyGroupAssignments(client, selectedIds, assignmentConfig, allowPermanent);
                }
                allResults.push(...results);
            }

            // Apply removals
            if (hasRemovals) {
                const targetId = selectedIds[0];
                let removalResult;
                if (workload === "directoryRoles") {
                    removalResult = await applyDirectoryRoleRemovals(client, targetId, removals);
                } else {
                    removalResult = await applyGroupRemovals(client, targetId, removals);
                }
                allResults.push(...removalResult.operations);
            }

            const succeeded = allResults.filter(r => r.success).length;
            const failed = allResults.filter(r => !r.success).length;

            setApplyResult({ success: succeeded, failed, operations: allResults });
            setApplyStatus("done");

            if (failed === 0) {
                toast.success("Assignments Applied", `${succeeded} operation(s) completed successfully`);
            } else {
                toast.warning("Partial Success", `${succeeded} succeeded, ${failed} failed`);
            }

            onApplied?.(allResults);
        } catch (err) {
            Logger.error("AssignmentPanel", "Apply error", err);
            toast.error("Apply Failed", "An error occurred while applying assignments");
            setApplyStatus("idle");
        }
    }, [assignments, removals, selectedIds, workload, isGroups, policies, ownerPolicies, getGraphClient, toast, onApplied]);

    const canApply = (assignments.members.length > 0 || removals.length > 0) && applyStatus === "idle";

    const handleStage = useCallback(() => {
        if (!onStage) return;
        const hasNewAssignments = assignments.members.length > 0;
        const hasRemovals = removals.length > 0;
        if (!hasNewAssignments && !hasRemovals) return;

        let config: AssignmentConfig | undefined;
        let allowPermanent: boolean | undefined;
        if (hasNewAssignments) {
            config = {
                principalIds: assignments.members.map(m => m.id),
                principalNames: Object.fromEntries(
                    assignments.members.filter(m => m.displayName).map(m => [m.id, m.displayName as string])
                ),
                assignmentType: assignments.type,
                duration: assignments.duration,
                startDateTime: assignments.startDate,
                endDateTime: assignments.duration === "bounded" ? assignments.endDate : undefined,
                justification: assignments.justification || undefined,
                accessType: isGroups ? assignments.groupRole : undefined,
                directoryScopeId: !isGroups ? assignments.scopeId : undefined,
            };
            const effective = isGroups && assignments.groupRole === "owner"
                ? (ownerPolicies ?? policies)
                : policies;
            allowPermanent = assignments.type === "eligible"
                ? (effective?.allowPermanentEligible ?? true)
                : (effective?.allowPermanentActive ?? true);
        }

        onStage({ config, allowPermanent, removals: hasRemovals ? [...removals] : undefined });

        // Reset form so the user can stage another batch
        setAssignments(prev => ({ ...prev, members: [], justification: "" }));
        setRemovals([]);
    }, [onStage, assignments, removals, isGroups, policies, ownerPolicies]);

    // Effective policies for DurationSettingsCard (owner policy when groupRole === "owner")
    const effectivePolicies = isGroups && assignments.groupRole === "owner"
        ? (ownerPolicies ?? policies)
        : policies;

    return (
        <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-700 shadow-lg overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50">
                <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">
                    {isGroups ? "Group Assignments" : "Role Assignments"}
                </h3>
                <button
                    onClick={onClose}
                    className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>

            {/* Result View (after apply) */}
            {applyStatus === "done" && applyResult && (
                <div className="p-4 space-y-3">
                    <div className={`flex items-center gap-2 p-3 rounded-lg border ${applyResult.failed === 0
                        ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                        : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
                        }`}>
                        {applyResult.failed === 0
                            ? <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
                            : <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0" />
                        }
                        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                            {applyResult.success} succeeded · {applyResult.failed} failed
                        </span>
                    </div>

                    {/* Per-operation results */}
                    <div className="max-h-48 overflow-y-auto space-y-1">
                        {applyResult.operations.map((op, i) => (
                            <div key={i} className="flex items-start gap-2 text-xs p-2 rounded bg-zinc-50 dark:bg-zinc-800">
                                {op.success
                                    ? <CheckCircle className="w-3.5 h-3.5 text-green-500 flex-shrink-0 mt-0.5" />
                                    : <XCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />
                                }
                                <div className="flex-1 min-w-0">
                                    <span className="text-zinc-700 dark:text-zinc-300">{op.operation}</span>
                                    {op.error && <div className="text-red-500 truncate">{op.error}</div>}
                                    {op.warning && <div className="text-amber-500 truncate">{op.warning}</div>}
                                </div>
                            </div>
                        ))}
                    </div>

                    <button
                        onClick={() => {
                            setApplyStatus("idle");
                            setApplyResult(null);
                            setAssignments(prev => ({ ...prev, members: [] }));
                            setRemovals([]);
                        }}
                        className="w-full py-2 text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 border border-zinc-200 dark:border-zinc-700 rounded-md transition-colors"
                    >
                        Create more assignments
                    </button>
                </div>
            )}

            {/* Consent Banner */}
            {disabled && applyStatus !== "done" && (
                <div className="mx-4 mt-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                    <span className="text-sm text-amber-700 dark:text-amber-300">
                        Write permissions required to create assignments.
                    </span>
                </div>
            )}

            {/* Assignment Form */}
            {applyStatus !== "done" && (
                <div className="p-4 flex gap-4 items-start">
                    {/* Left: Configuration */}
                    <div className="flex-1 space-y-3 min-w-0">
                        {/* Scope Picker */}
                        <AssignmentScopePicker
                            isGroups={isGroups}
                            assignments={assignments}
                            adminUnits={adminUnits}
                            onUpdate={updateState}
                        />

                        {/* Principal Selector */}
                        <div className={`bg-white dark:bg-zinc-800 p-4 rounded-lg border shadow-sm transition-colors ${assignments.members.length === 0 && removals.length === 0
                            ? 'border-amber-300 dark:border-amber-700'
                            : 'border-zinc-200 dark:border-zinc-700'
                            }`}>
                            <PrincipalSelector
                                selectedPrincipals={assignments.members}
                                onChange={(p: Principal[]) => updateState({ members: p })}
                                label="Who needs access?"
                                addLabel="+ Add members"
                                description="Search for users or groups to assign."
                                showRoleAssignableWarning={workload === "directoryRoles"}
                            />
                            {assignments.members.length === 0 && removals.length === 0 && (
                                <div className="mt-3 flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 rounded-md">
                                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                                    <span>Add at least one member, or stage a removal to continue.</span>
                                </div>
                            )}
                        </div>

                        {/* Assignment Type */}
                        <AssignmentTypeCard assignments={assignments} onUpdate={updateState} />

                        {/* Duration */}
                        <DurationSettingsCard
                            assignments={assignments}
                            currentPolicies={effectivePolicies}
                            onUpdate={updateState}
                        />

                        {/* Apply / Stage Buttons */}
                        <div className="flex gap-2">
                            {onStage && (
                                <button
                                    onClick={handleStage}
                                    disabled={!canApply}
                                    className="flex-1 py-2.5 bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 hover:bg-amber-200 dark:hover:bg-amber-800/50 disabled:opacity-50 font-medium rounded-lg transition-colors"
                                >
                                    Stage Changes
                                </button>
                            )}
                            <button
                                onClick={handleApply}
                                disabled={!canApply || !!disabled}
                                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 text-white disabled:text-zinc-400 dark:disabled:text-zinc-500 font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                            >
                                {applyStatus === "applying" ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Applying...
                                    </>
                                ) : (
                                    <>
                                        Apply Now
                                        {removals.length > 0 && ` + ${removals.length} removal${removals.length !== 1 ? 's' : ''}`}
                                    </>
                                )}
                            </button>
                        </div>
                    </div>

                    {/* Right: Existing Assignments */}
                    <ExistingAssignmentsPanel
                        isGroups={isGroups}
                        existingAssignments={existingAssignments}
                        isLoading={isLoadingAssignments}
                        removals={removals}
                        adminUnits={adminUnits}
                        selectedCount={selectedIds.length}
                        onFetchAssignments={fetchExistingAssignments}
                        onRemoveAssignment={handleRemoveAssignment}
                        onCancelRemoval={handleCancelRemoval}
                    />
                </div>
            )}
        </div>
    );
}
