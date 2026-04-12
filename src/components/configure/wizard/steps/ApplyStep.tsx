import React, { useState, useEffect, useCallback, useRef } from 'react';
import { WizardStep } from '../WizardStep';
import { useWizardState } from '@/hooks/useWizardState';
import { useGraphClient } from '@/hooks/usePimSelectors';
import { useToastActions } from '@/contexts/ToastContext';
import { useUnifiedPimData } from '@/contexts/UnifiedPimContext';
import { ApplyOperationResult, ApplyPhaseResult } from '@/types/wizard.types';
import {
    applyDirectoryRolePolicies,
    applyGroupPolicies,
    applyDirectoryRoleAssignments,
    applyGroupAssignments,
    applyDirectoryRoleRemovals,
    applyGroupRemovals,
    aggregateResults,
} from '@/services/wizardApplyService';
import {
    Loader2,
    CheckCircle2,
    XCircle,
    AlertTriangle,
    RefreshCw,
    ChevronDown,
    ChevronRight
} from 'lucide-react';
import { ConfigureWorkloadType as WorkloadType } from '@/types/workload.types';
import { Logger } from '@/utils/logger';

interface ApplyStepProps {
    workload: WorkloadType;
    onNext: () => void;
    onBack: () => void;
}

type ApplyPhase = "idle" | "policies" | "assignments" | "removals" | "complete" | "error";

const workloadLabels: Record<WorkloadType, string> = {
    directoryRoles: "Directory Roles",
    pimGroups: "PIM Groups"
};

// Group operations by target (role/group) for display
interface GroupedOperations {
    targetId: string;
    targetName: string;
    operations: ApplyOperationResult[];
    successCount: number;
    failureCount: number;
}

function groupOperationsByTarget(operations: ApplyOperationResult[]): GroupedOperations[] {
    const groups = new Map<string, GroupedOperations>();

    for (const op of operations) {
        const existing = groups.get(op.targetId);
        if (existing) {
            existing.operations.push(op);
            if (op.success) existing.successCount++;
            else existing.failureCount++;
        } else {
            groups.set(op.targetId, {
                targetId: op.targetId,
                targetName: op.targetName || op.targetId,
                operations: [op],
                successCount: op.success ? 1 : 0,
                failureCount: op.success ? 0 : 1
            });
        }
    }

    return Array.from(groups.values());
}

// Per-target result card component
function TargetResultCard({ group, isExpanded, onToggle }: {
    group: GroupedOperations;
    isExpanded: boolean;
    onToggle: () => void;
}) {
    const hasFailures = group.failureCount > 0;
    const allFailed = group.successCount === 0 && group.failureCount > 0;
    const hasWarnings = !hasFailures && group.operations.some(op => op.warning);

    return (
        <div className={`
            border rounded-lg overflow-hidden
            ${allFailed
                ? 'border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/10'
                : hasFailures || hasWarnings
                    ? 'border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10'
                    : 'border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-900/10'
            }
        `}>
            <button
                onClick={onToggle}
                className="w-full flex items-center justify-between p-3 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
            >
                <div className="flex items-center gap-3">
                    {allFailed ? (
                        <XCircle className="w-5 h-5 text-red-500" />
                    ) : hasFailures || hasWarnings ? (
                        <AlertTriangle className="w-5 h-5 text-amber-500" />
                    ) : (
                        <CheckCircle2 className="w-5 h-5 text-green-500" />
                    )}
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                        {group.targetName}
                    </span>
                </div>
                <div className="flex items-center gap-3">
                    <span className="text-xs text-zinc-500">
                        {group.successCount} success, {group.failureCount} failed
                    </span>
                    {isExpanded
                        ? <ChevronDown className="w-4 h-4 text-zinc-400" />
                        : <ChevronRight className="w-4 h-4 text-zinc-400" />
                    }
                </div>
            </button>

            {isExpanded && (
                <div className="border-t border-zinc-200 dark:border-zinc-700 p-3 space-y-2">
                    {group.operations.map((op, idx) => (
                        <div
                            key={idx}
                            className={`flex items-start gap-2 text-sm ${
                                !op.success
                                    ? 'text-red-700 dark:text-red-400'
                                    : op.warning
                                        ? 'text-amber-700 dark:text-amber-400'
                                        : 'text-green-700 dark:text-green-400'
                            }`}
                        >
                            {!op.success
                                ? <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                                : op.warning
                                    ? <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                                    : <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
                            }
                            <div>
                                <span>{op.operation}</span>
                                {op.warning && (
                                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">{op.warning}</p>
                                )}
                                {op.error && (
                                    <p className="text-xs text-red-500 mt-0.5">{op.error}</p>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export const ApplyStep = React.memo(function ApplyStep({ workload, onNext, onBack }: ApplyStepProps) {
    const { wizardData, updateData } = useWizardState();
    // Use selector hook - stable reference, won't cause re-renders
    const getGraphClient = useGraphClient();
    const toast = useToastActions();
    const { refreshWorkload } = useUnifiedPimData();

    const label = workloadLabels[workload];
    const isGroups = workload === "pimGroups";

    // State
    const [phase, setPhase] = useState<ApplyPhase>("idle");
    const [progress, setProgress] = useState({ current: 0, total: 0, description: "" });
    const [results, setResults] = useState<ApplyPhaseResult | null>(null);
    const [showErrorDetails, setShowErrorDetails] = useState(false);
    const [isRetrying, setIsRetrying] = useState(false);
    const [expandedTargets, setExpandedTargets] = useState<Set<string>>(new Set());

    const hasStarted = useRef(false);
    // Track which phases had failures so retry only re-runs those phases
    const failedPhases = useRef<Set<string>>(new Set());

    // Get config
    const selectedIds = isGroups ? wizardData.selectedGroupIds : wizardData.selectedRoleIds;
    const workloadConfig = isGroups ? wizardData.pimGroups : wizardData.directoryRoles;
    const policies = workloadConfig.policies;
    const ownerPolicies = workloadConfig.ownerPolicies;
    const assignments = workloadConfig.assignments;
    const removals = workloadConfig.removals || [];

    // Execute apply operations
    const executeApply = useCallback(async (retryFailedOnly: boolean = false) => {
        const client = await getGraphClient();
        if (!client) {
            setPhase("error");
            setResults({
                policiesUpdated: 0,
                policiesFailed: 0,
                assignmentsCreated: 0,
                assignmentsFailed: 0,
                removalsCompleted: 0,
                removalsFailed: 0,
                operations: [],
                errors: ["Failed to get Graph client. Please ensure you are authenticated."]
            });
            return;
        }

        const allOperations: ApplyOperationResult[] = [];

        try {
            // Phase 1: Apply Policies
            // On retry, skip if this phase had no failures on the previous run
            if (policies && (!retryFailedOnly || failedPhases.current.has("policies"))) {
                setPhase("policies");

                let phaseResults: ApplyOperationResult[] = [];

                if (isGroups) {
                    // Apply member policies
                    const memberResults = await applyGroupPolicies(
                        client,
                        selectedIds,
                        policies,
                        "member",
                        (phase, current, total, desc) => setProgress({ current, total, description: desc })
                    );
                    phaseResults.push(...memberResults);

                    // Apply owner policies if configured separately
                    if (ownerPolicies) {
                        const ownerResults = await applyGroupPolicies(
                            client,
                            selectedIds,
                            ownerPolicies,
                            "owner",
                            (phase, current, total, desc) => setProgress({ current, total, description: desc })
                        );
                        phaseResults.push(...ownerResults);
                    }
                } else {
                    const policyResults = await applyDirectoryRolePolicies(
                        client,
                        selectedIds,
                        policies,
                        (phase, current, total, desc) => setProgress({ current, total, description: desc })
                    );
                    phaseResults.push(...policyResults);
                }

                allOperations.push(...phaseResults);
                if (phaseResults.some(r => !r.success)) failedPhases.current.add("policies");
                else failedPhases.current.delete("policies");
            }

            // Phase 2: Create Assignments
            // On retry, skip if this phase had no failures on the previous run
            if (assignments && assignments.principalIds && assignments.principalIds.length > 0
                && (!retryFailedOnly || failedPhases.current.has("assignments"))) {
                setPhase("assignments");

                // Derive allowPermanent, mirroring DurationSettingsCard.isPermanentAllowed():
                // - assignments-only mode: no wizard policy constraints → let Graph API gatekeep
                // - policies not loaded (e.g. scratch path before PoliciesStep saves): same
                // - otherwise: use the explicit policy setting
                const allowPermanentAssignment =
                    wizardData.configType === 'assignment' || !policies
                        ? true
                        : assignments.assignmentType === "eligible"
                            ? (policies.allowPermanentEligible ?? false)
                            : (policies.allowPermanentActive ?? false);

                // Policy's own maximum duration — used as fallback when allowPermanent=false
                // prevents sending a hardcoded value that might exceed the policy's maximumDuration
                const policyMaxDuration = assignments.assignmentType === "eligible"
                    ? policies?.eligibleExpiration
                    : policies?.activeExpiration;

                let phaseResults: ApplyOperationResult[] = [];

                if (isGroups) {
                    phaseResults = await applyGroupAssignments(
                        client,
                        selectedIds,
                        assignments,
                        allowPermanentAssignment,
                        policyMaxDuration,
                        (phase, current, total, desc) => setProgress({ current, total, description: desc })
                    );
                } else {
                    phaseResults = await applyDirectoryRoleAssignments(
                        client,
                        selectedIds,
                        assignments,
                        allowPermanentAssignment,
                        policyMaxDuration,
                        (phase, current, total, desc) => setProgress({ current, total, description: desc })
                    );
                }

                allOperations.push(...phaseResults);
                if (phaseResults.some(r => !r.success)) failedPhases.current.add("assignments");
                else failedPhases.current.delete("assignments");
            }

            // Phase 3: Process Removals
            // On retry, skip if this phase had no failures on the previous run
            if (removals.length > 0 && (!retryFailedOnly || failedPhases.current.has("removals"))) {
                setPhase("removals");

                const removalPhaseOps: ApplyOperationResult[] = [];

                if (isGroups) {
                    // PIM Groups removals — filter per group to avoid applying the same removal to all selected groups
                    for (const groupId of selectedIds) {
                        const groupRemovals = removals.filter(r => r.groupId === groupId);
                        if (groupRemovals.length > 0) {
                            const result = await applyGroupRemovals(
                                client,
                                groupId,
                                groupRemovals,
                                (current, total) => setProgress({ current, total, description: `Removing assignments: ${current}/${total}` })
                            );
                            removalPhaseOps.push(...result.operations);
                        }
                    }
                } else {
                    // Directory Roles removals — filter per role to avoid sending every removal
                    // to every selected role (each AssignmentRemoval carries its own roleDefinitionId)
                    const eligibleRemovals = removals.filter(r => r.assignmentType === "eligible");
                    const activeRemovals = removals.filter(r => r.assignmentType === "active");

                    for (const roleId of selectedIds) {
                        const roleEligibleRemovals = eligibleRemovals.filter(r => r.roleDefinitionId === roleId);
                        if (roleEligibleRemovals.length > 0) {
                            const result = await applyDirectoryRoleRemovals(
                                client,
                                roleId,
                                roleEligibleRemovals,
                                (current, total) => setProgress({ current, total, description: `Removing eligible assignments: ${current}/${total}` })
                            );
                            removalPhaseOps.push(...result.operations);
                        }

                        const roleActiveRemovals = activeRemovals.filter(r => r.roleDefinitionId === roleId);
                        if (roleActiveRemovals.length > 0) {
                            const result = await applyDirectoryRoleRemovals(
                                client,
                                roleId,
                                roleActiveRemovals,
                                (current, total) => setProgress({ current, total, description: `Removing active assignments: ${current}/${total}` })
                            );
                            removalPhaseOps.push(...result.operations);
                        }
                    }
                }

                allOperations.push(...removalPhaseOps);
                if (removalPhaseOps.some(r => !r.success)) failedPhases.current.add("removals");
                else failedPhases.current.delete("removals");
            }

            // Aggregate results
            const aggregated = aggregateResults(allOperations);
            setResults(aggregated);

            // Update wizard data with results
            const configKey = isGroups ? "pimGroups" : "directoryRoles";
            updateData({
                [configKey]: {
                    ...workloadConfig,
                    applied: aggregated.errors.length === 0,
                    result: {
                        policiesUpdated: aggregated.policiesUpdated,
                        assignmentsCreated: aggregated.assignmentsCreated,
                        errors: aggregated.errors
                    }
                }
            });

            setPhase("complete");

            // Silently refresh the affected workload in the background so that
            // assignment counts and policy state are up-to-date if the user
            // navigates away from the wizard after applying.
            void refreshWorkload(workload);

            // Toast notification based on results
            if (aggregated.errors.length === 0) {
                toast.success(
                    `${label} Applied Successfully`,
                    `${aggregated.policiesUpdated} policies updated, ${aggregated.assignmentsCreated} assignments created`
                );
            } else {
                toast.warning(
                    `${label} Completed with Errors`,
                    `${aggregated.errors.length} operation(s) failed. Review details below.`
                );
            }

        } catch (error: any) {
            Logger.error("ApplyStep", "Apply error", error);
            setPhase("error");
            setResults({
                policiesUpdated: 0,
                policiesFailed: 0,
                assignmentsCreated: 0,
                assignmentsFailed: 0,
                removalsCompleted: 0,
                removalsFailed: 0,
                operations: allOperations,
                errors: [error.message || "An unexpected error occurred"]
            });

            toast.error(
                `${label} Failed`,
                error.message || "An unexpected error occurred"
            );
        }
    }, [getGraphClient, policies, ownerPolicies, assignments, removals, selectedIds, isGroups, workloadConfig, updateData, toast, label, wizardData.configType, refreshWorkload]);

    // Auto-start on mount
    useEffect(() => {
        if (!hasStarted.current) {
            hasStarted.current = true;
            executeApply();
        }
    }, [executeApply]);

    // Retry failed operations
    const handleRetry = async () => {
        setIsRetrying(true);
        setPhase("idle");
        await executeApply(true);
        setIsRetrying(false);
    };

    // Calculate stats
    const hasFailures = results && (results.policiesFailed > 0 || results.assignmentsFailed > 0 || results.removalsFailed > 0);
    const isComplete = phase === "complete";
    const isRunning = phase === "policies" || phase === "assignments" || phase === "removals";

    return (
        <WizardStep
            title={`Applying: ${label}`}
            description={isComplete ? "Changes applied" : "Executing changes..."}
            onNext={onNext}
            onBack={onBack}
            nextLabel={hasFailures ? "Continue with Failures" : "Continue"}
            isNextDisabled={!isComplete}
            isBackDisabled={isRunning}
        >
            <div className="space-y-6">
                {/* Progress Indicator */}
                {isRunning && (
                    <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-6">
                        <div className="flex items-center gap-4 mb-4">
                            <Loader2 className="w-6 h-6 text-blue-600 dark:text-blue-400 animate-spin" />
                            <div>
                                <h3 className="font-medium text-blue-800 dark:text-blue-200">
                                    {phase === "policies" && "Updating Policies..."}
                                    {phase === "assignments" && "Creating Assignments..."}
                                    {phase === "removals" && "Processing Removals..."}
                                </h3>
                                <p className="text-sm text-blue-600 dark:text-blue-400">
                                    {progress.description}
                                </p>
                            </div>
                        </div>

                        {/* Progress Bar */}
                        {progress.total > 0 && (
                            <div className="w-full bg-blue-200 dark:bg-blue-900/40 rounded-full h-2">
                                <div
                                    className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                                    style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }}
                                />
                            </div>
                        )}
                        <div className="text-xs text-blue-600 dark:text-blue-400 mt-2 text-right">
                            {progress.current} / {progress.total}
                        </div>
                    </div>
                )}

                {/* Complete - Success */}
                {isComplete && !hasFailures && (
                    <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-6">
                        <div className="flex items-center gap-4">
                            <CheckCircle2 className="w-8 h-8 text-green-600 dark:text-green-400" />
                            <div>
                                <h3 className="font-semibold text-green-800 dark:text-green-200 text-lg">
                                    All Changes Applied Successfully
                                </h3>
                                <p className="text-sm text-green-600 dark:text-green-400 mt-1">
                                    {results?.policiesUpdated || 0} policy updates, {results?.assignmentsCreated || 0} assignments created
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Complete - With Failures */}
                {isComplete && hasFailures && (
                    <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-6">
                        <div className="flex items-start gap-4">
                            <AlertTriangle className="w-8 h-8 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                            <div className="flex-1">
                                <h3 className="font-semibold text-amber-800 dark:text-amber-200 text-lg">
                                    Completed with Some Failures
                                </h3>
                                <p className="text-sm text-amber-600 dark:text-amber-400 mt-1">
                                    {results?.policiesUpdated || 0} policies updated, {results?.policiesFailed || 0} failed.{' '}
                                    {results?.assignmentsCreated || 0} assignments created, {results?.assignmentsFailed || 0} failed.
                                </p>

                                {/* Retry Button */}
                                <button
                                    onClick={handleRetry}
                                    disabled={isRetrying}
                                    className="mt-4 flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors disabled:opacity-50"
                                >
                                    <RefreshCw className={`w-4 h-4 ${isRetrying ? 'animate-spin' : ''}`} />
                                    Retry Failed Operations
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Error State */}
                {phase === "error" && (
                    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6">
                        <div className="flex items-start gap-4">
                            <XCircle className="w-8 h-8 text-red-600 dark:text-red-400 flex-shrink-0" />
                            <div className="flex-1">
                                <h3 className="font-semibold text-red-800 dark:text-red-200 text-lg">
                                    Apply Failed
                                </h3>
                                <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                                    {results?.errors?.[0] || "An error occurred while applying changes."}
                                </p>

                                <button
                                    onClick={handleRetry}
                                    disabled={isRetrying}
                                    className="mt-4 flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors disabled:opacity-50"
                                >
                                    <RefreshCw className={`w-4 h-4 ${isRetrying ? 'animate-spin' : ''}`} />
                                    Retry
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Per-Target Results (Grouped by Role/Group) */}
                {results && isComplete && results.operations.length > 0 && (
                    <div className="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
                        <div className="p-4 border-b border-zinc-200 dark:border-zinc-700">
                            <h3 className="font-medium text-zinc-900 dark:text-zinc-100">
                                Results by {isGroups ? "Group" : "Role"}
                            </h3>
                            <p className="text-sm text-zinc-500 mt-1">
                                Click to expand and see operation details
                            </p>
                        </div>
                        <div className="p-4 space-y-2 max-h-64 overflow-y-auto">
                            {groupOperationsByTarget(results.operations).map((group) => (
                                <TargetResultCard
                                    key={group.targetId}
                                    group={group}
                                    isExpanded={expandedTargets.has(group.targetId)}
                                    onToggle={() => {
                                        setExpandedTargets(prev => {
                                            const next = new Set(prev);
                                            if (next.has(group.targetId)) {
                                                next.delete(group.targetId);
                                            } else {
                                                next.add(group.targetId);
                                            }
                                            return next;
                                        });
                                    }}
                                />
                            ))}
                        </div>
                    </div>
                )}

                {/* Summary Stats */}
                {results && isComplete && (
                    <div className="grid grid-cols-3 gap-4">
                        <div className="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg p-4 text-center">
                            <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                                {results.policiesUpdated}
                            </div>
                            <div className="text-sm text-zinc-500">Policies Updated</div>
                        </div>
                        <div className="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg p-4 text-center">
                            <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                                {results.assignmentsCreated}
                            </div>
                            <div className="text-sm text-zinc-500">Assignments Created</div>
                        </div>
                        <div className="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg p-4 text-center">
                            <div className={`text-2xl font-bold ${results.errors.length > 0
                                ? 'text-amber-600 dark:text-amber-400'
                                : 'text-green-600 dark:text-green-400'
                                }`}>
                                {results.errors.length}
                            </div>
                            <div className="text-sm text-zinc-500">Errors</div>
                        </div>
                    </div>
                )}
            </div>
        </WizardStep>
    );
});
