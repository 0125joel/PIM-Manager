import React, { useMemo } from 'react';
import { WizardStep } from '../WizardStep';
import { useWorkloadConfig, useWizardData, useWizardActions, PolicySettings } from '@/hooks/useWizardState';
import { usePimData } from '@/hooks/usePimData';
import { usePimGroupsData } from '@/hooks/usePimSelectors';
import { formatDuration } from '@/utils/durationUtils';
import { usePolicyConflicts, PolicyConflict } from '@/hooks/usePolicyConflicts';
import { detectActivationChanges, ActivationChange } from '@/utils/policyConflicts';
import { parseGraphPolicy } from '@/services/policyParserService';
import {
    isHighRiskRoleName,
    detectPolicyExtensions,
    isScratchPermanentRiskyOnPrivileged,
    formatExtensionLine,
} from '@/utils/policyPreflight';
import {
    CheckCircle2,
    AlertTriangle,
    Users,
    Settings,
    Shield,
    Clock,
    UserPlus,
    Trash2,
    RefreshCw,
    Loader2
} from 'lucide-react';
import { ConfigureWorkloadType as WorkloadType } from '@/types/workload.types';

interface ReviewStepProps {
    workload: WorkloadType;
    onNext: () => void;
    onBack: () => void;
}

const workloadLabels: Record<WorkloadType, string> = {
    directoryRoles: "Directory Roles",
    pimGroups: "PIM Groups"
};

export const ReviewStep = React.memo(function ReviewStep({ workload, onNext, onBack }: ReviewStepProps) {
    // Use selector hooks to minimize re-renders
    const selectedRoleIds = useWizardData(d => d.selectedRoleIds);
    const selectedGroupIds = useWizardData(d => d.selectedGroupIds);
    const workloadConfig = useWorkloadConfig(workload);

    const { rolesData } = usePimData();
    // Use selector hook - only re-renders when pimGroups data changes
    const groupsData = usePimGroupsData();

    const label = workloadLabels[workload];
    const isGroups = workload === "pimGroups";

    // Get selected IDs from selectors
    const selectedIds = isGroups ? selectedGroupIds : selectedRoleIds;
    const policies = workloadConfig.policies;
    const ownerPolicies = workloadConfig.ownerPolicies;
    const assignments = workloadConfig.assignments;
    const removals = workloadConfig.removals || [];

    // Get display names for selected items
    const selectedItems = useMemo(() => {
        if (isGroups) {
            return selectedIds.map(id => {
                const group = groupsData?.find((g: any) => g.group.id === id);
                return { id, name: group?.group?.displayName || id };
            });
        } else {
            return selectedIds.map(id => {
                const role = rolesData?.find(r => r.definition.id === id);
                return { id, name: role?.definition?.displayName || id };
            });
        }
    }, [selectedIds, rolesData, groupsData, isGroups]);

    const hasHighRiskRoles = !isGroups && selectedItems.some(item => isHighRiskRoleName(item.name));

    const configSource = workloadConfig.configSource;
    const wizardConfigType = useWizardData(d => d.configType);
    const { updateWorkloadConfig } = useWizardActions();

    // D1: detect existing assignments that conflict with the pending policy.
    // Only meaningful when the user is modifying policy (not in assignments-only mode).
    const nameMap = useMemo(() => {
        const m = new Map<string, string>();
        for (const item of selectedItems) m.set(item.id, item.name);
        return m;
    }, [selectedItems]);
    const policyChangesActive = !!policies && wizardConfigType !== 'assignment';
    const { conflicts, isLoading: conflictsLoading, refresh: refreshConflicts } = usePolicyConflicts({
        workload,
        selectedIds,
        nameMap,
        pendingPolicy: policies,
        pendingOwnerPolicy: ownerPolicies,
        enabled: policyChangesActive,
    });

    // D2: derive which conflicts are already staged for removal so the UI can
    // distinguish "open" from "resolved".
    const stagedRemovalIds = useMemo(() => new Set(removals.map(r => r.assignmentId)), [removals]);
    const openConflicts = conflicts.filter(c => !stagedRemovalIds.has(c.assignmentId));

    // Activation-side change detection — diffs the cached CURRENT policy of
    // each selected role/group against the pending one and surfaces warnings
    // about end-user activation impact (added MFA, CA auth context, approval,
    // etc.). Not a blocker — informational.
    const activationChanges = useMemo<ActivationChange[]>(() => {
        if (!policies || wizardConfigType === 'assignment') return [];

        const aggregated = new Map<string, ActivationChange>();
        const ingest = (changes: ActivationChange[]) => {
            for (const c of changes) {
                // Same reason can appear per role/group; keep the first occurrence
                // (most-restrictive wording is identical across targets anyway).
                if (!aggregated.has(c.reason)) aggregated.set(c.reason, c);
            }
        };

        if (isGroups) {
            for (const id of selectedIds) {
                const g = groupsData?.find((x: { group: { id: string } }) => x.group.id === id);
                const memberRules = g?.policies?.member?.rules;
                const ownerRules = g?.policies?.owner?.rules;
                if (memberRules) {
                    const current = parseGraphPolicy({ rules: memberRules });
                    ingest(detectActivationChanges(current, policies));
                }
                if (ownerRules && ownerPolicies) {
                    const currentOwner = parseGraphPolicy({ rules: ownerRules });
                    ingest(detectActivationChanges(currentOwner, ownerPolicies));
                }
            }
        } else {
            for (const id of selectedIds) {
                const r = rolesData?.find(x => x.definition.id === id);
                const rules = r?.policy?.details?.rules;
                if (rules) {
                    const current = parseGraphPolicy({ rules });
                    ingest(detectActivationChanges(current, policies));
                }
            }
        }
        return Array.from(aggregated.values());
    }, [policies, ownerPolicies, isGroups, selectedIds, rolesData, groupsData, wizardConfigType]);

    // Preflight: detect policy *extensions* that Microsoft will reject.
    // Microsoft enforces hard upper bounds on per-role policy `maximumDuration`
    // for many built-in roles — trying to extend beyond the current value
    // returns InvalidPolicyRule. Compute per-target if pending > current and
    // surface a warning ahead of Apply so the user can shorten in PoliciesStep.
    const extensionWarnings = useMemo<string[]>(() => {
        if (!policies || wizardConfigType === 'assignment') return [];
        const offenders = [];
        if (isGroups) {
            for (const item of selectedItems) {
                const g = groupsData?.find((x: { group: { id: string } }) => x.group.id === item.id);
                const memberRules = g?.policies?.member?.rules;
                const ownerRules = g?.policies?.owner?.rules;
                if (memberRules) offenders.push(...detectPolicyExtensions(item.name, parseGraphPolicy({ rules: memberRules }), policies));
                if (ownerRules && ownerPolicies) offenders.push(...detectPolicyExtensions(item.name, parseGraphPolicy({ rules: ownerRules }), ownerPolicies));
            }
        } else {
            for (const item of selectedItems) {
                const r = rolesData?.find(x => x.definition.id === item.id);
                const rules = r?.policy?.details?.rules;
                if (!rules) continue;
                offenders.push(...detectPolicyExtensions(item.name, parseGraphPolicy({ rules }), policies));
            }
        }
        return offenders.map(formatExtensionLine);
    }, [policies, ownerPolicies, isGroups, selectedItems, rolesData, groupsData, wizardConfigType]);

    // D2: helpers to stage/unstage a conflict via the existing `removals` array.
    const stageConflict = (c: PolicyConflict) => {
        const removal = {
            assignmentId: c.assignmentId,
            principalId: c.principalId,
            roleDefinitionId: c.roleDefinitionId ?? "",
            directoryScopeId: c.directoryScopeId ?? "/",
            assignmentType: c.assignmentType,
            groupId: c.groupId,
        };
        updateWorkloadConfig(workload, { removals: [...removals, removal] });
    };
    const stageAllConflicts = () => {
        const additions = openConflicts.map(c => ({
            assignmentId: c.assignmentId,
            principalId: c.principalId,
            roleDefinitionId: c.roleDefinitionId ?? "",
            directoryScopeId: c.directoryScopeId ?? "/",
            assignmentType: c.assignmentType,
            groupId: c.groupId,
        }));
        updateWorkloadConfig(workload, { removals: [...removals, ...additions] });
    };



    // Check if there's anything to apply
    const hasPolicyChanges = !!policies;
    const hasAssignmentChanges = !!(assignments && assignments.principalIds && assignments.principalIds.length > 0);
    const hasRemovals = removals.length > 0;
    const hasAnyChanges = hasPolicyChanges || hasAssignmentChanges || hasRemovals;

    // Preflight: scratch defaults allow permanent eligible/active. Microsoft
    // enforces stricter limits for several privileged roles, so applying the
    // MS-default policy to one of those roles returns a generic "InvalidPolicy"
    // error. Warn early so the user can adjust before Apply.
    const scratchPolicyRiskyOnPrivileged =
        !isGroups
        && isScratchPermanentRiskyOnPrivileged({
            configSource,
            policies,
            hasHighRiskTargets: hasHighRiskRoles,
        });

    // Preflight: assignments-only mode with permanent duration. The Apply path
    // optimistically treats permanent as allowed; Graph rejects if the
    // actual policy forbids it (we can't tell without loading the policy).
    const assignmentOnlyPermanentRisk =
        wizardConfigType === "assignment"
        && hasAssignmentChanges
        && assignments?.duration === "permanent";

    return (
        <WizardStep
            title={`Review: ${label}`}
            description="Review all changes before applying"
            nextLabel="Apply Changes"
            onNext={onNext}
            onBack={onBack}
            isNextDisabled={!hasAnyChanges}
        >
            <div className="space-y-6 max-h-[calc(100vh-400px)] overflow-y-auto pr-2">
                {/* Scope Summary */}
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-3">
                        <Shield className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                        <h3 className="font-semibold text-blue-800 dark:text-blue-200">
                            Applying to {selectedIds.length} {isGroups ? "group" : "role"}{selectedIds.length !== 1 ? "s" : ""}
                        </h3>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {selectedItems.slice(0, 10).map(item => (
                            <span
                                key={item.id}
                                className="text-xs px-2 py-1 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded"
                            >
                                {item.name}
                            </span>
                        ))}
                        {selectedItems.length > 10 && (
                            <span className="text-xs px-2 py-1 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded">
                                +{selectedItems.length - 10} more
                            </span>
                        )}
                    </div>
                </div>

                {/* High Risk Warning */}
                {hasHighRiskRoles && (
                    <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-lg p-4 flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                        <div>
                            <h4 className="font-medium text-amber-800 dark:text-amber-200">
                                Privileged Roles Selected
                            </h4>
                            <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                                You are modifying highly privileged roles. Verify the settings before applying. These changes affect tenant-wide administrative access.
                            </p>
                        </div>
                    </div>
                )}

                {/* Preflight: Scratch defaults likely rejected on privileged roles */}
                {scratchPolicyRiskyOnPrivileged && (
                    <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-300 dark:border-orange-700 rounded-lg p-4 flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 text-orange-600 dark:text-orange-400 flex-shrink-0 mt-0.5" />
                        <div>
                            <h4 className="font-medium text-orange-800 dark:text-orange-200">
                                Microsoft default policy may be rejected on these roles
                            </h4>
                            <p className="text-sm text-orange-700 dark:text-orange-300 mt-1">
                                The configuration was started from scratch, which allows permanent eligible/active assignments. Microsoft enforces stricter limits on privileged roles and will return <code className="text-xs px-1 bg-orange-100 dark:bg-orange-900/40 rounded">InvalidPolicy</code>.
                            </p>
                            <p className="text-sm text-orange-700 dark:text-orange-300 mt-2">
                                <strong>Recommended:</strong> go back to the Policies step and disable <em>Allow permanent eligible</em> / <em>Allow permanent active</em>, or restart the wizard and choose <em>Load current settings</em> instead of <em>Configure from scratch</em>.
                            </p>
                        </div>
                    </div>
                )}

                {/* Preflight: assignments-only + permanent */}
                {assignmentOnlyPermanentRisk && (
                    <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-lg p-4 flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                        <div>
                            <h4 className="font-medium text-amber-800 dark:text-amber-200">
                                Permanent assignment requested without loaded policy
                            </h4>
                            <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                                You picked assignments-only mode, so the wizard does not know whether each role allows permanent assignments. If a role&apos;s policy forbids permanent, this Apply will create the assignment with the policy&apos;s maximum duration instead of failing.
                            </p>
                        </div>
                    </div>
                )}

                {/* Preflight: extending the policy maximum beyond current */}
                {extensionWarnings.length > 0 && (
                    <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-300 dark:border-orange-700 rounded-lg p-4 flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 text-orange-600 dark:text-orange-400 flex-shrink-0 mt-0.5" />
                        <div>
                            <h4 className="font-medium text-orange-800 dark:text-orange-200">
                                Policy maximum extension: Microsoft may reject this
                            </h4>
                            <p className="text-sm text-orange-700 dark:text-orange-300 mt-1">
                                For built-in privileged roles Microsoft enforces hard upper bounds on the policy maximum duration that you cannot extend further (the PATCH returns <code className="text-xs px-1 bg-orange-100 dark:bg-orange-900/40 rounded">InvalidPolicyRule</code>). The following changes try to widen the cap:
                            </p>
                            <ul className="mt-2 space-y-0.5">
                                {extensionWarnings.slice(0, 8).map((line, idx) => (
                                    <li key={idx} className="text-xs text-orange-700 dark:text-orange-300 font-mono">
                                        {line}
                                    </li>
                                ))}
                                {extensionWarnings.length > 8 && (
                                    <li className="text-xs text-orange-700 dark:text-orange-300 italic">
                                        +{extensionWarnings.length - 8} more
                                    </li>
                                )}
                            </ul>
                            <p className="text-sm text-orange-700 dark:text-orange-300 mt-2">
                                <strong>Recommended:</strong> go back to the Policies step and shorten the expiration to the current maximum, or accept that those updates will fail.
                            </p>
                        </div>
                    </div>
                )}

                {/* Activation-side change pills — informational, not blocking */}
                {activationChanges.length > 0 && (
                    <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                        <div className="flex items-start gap-3">
                            <Users className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                            <div className="flex-1">
                                <h4 className="font-medium text-blue-800 dark:text-blue-200">
                                    What changes for already-eligible users at activation
                                </h4>
                                <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                                    The policy update doesn&apos;t change anyone&apos;s current eligibility, but it does change what they&apos;ll experience next time they activate:
                                </p>
                                <ul className="mt-2 space-y-1">
                                    {activationChanges.map(c => (
                                        <li
                                            key={c.reason}
                                            className={`text-sm flex items-start gap-2 ${c.severity === "warning"
                                                ? "text-amber-700 dark:text-amber-300"
                                                : "text-blue-700 dark:text-blue-300"
                                                }`}
                                        >
                                            {c.severity === "warning"
                                                ? <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                                                : <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />}
                                            <span>{c.message}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                    </div>
                )}

                {/* D1/D2: Policy → existing assignments conflict panel */}
                {policyChangesActive && (conflictsLoading || conflicts.length > 0) && (
                    <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-300 dark:border-orange-700 rounded-lg p-4">
                        <div className="flex items-start gap-3">
                            <AlertTriangle className="w-5 h-5 text-orange-600 dark:text-orange-400 flex-shrink-0 mt-0.5" />
                            <div className="flex-1">
                                <div className="flex items-center justify-between gap-3">
                                    <h4 className="font-medium text-orange-800 dark:text-orange-200">
                                        {conflictsLoading
                                            ? "Checking existing assignments..."
                                            : `${openConflicts.length} existing assignment${openConflicts.length === 1 ? "" : "s"} will violate the new policy`}
                                    </h4>
                                    <button
                                        onClick={refreshConflicts}
                                        className="text-xs flex items-center gap-1 text-orange-700 dark:text-orange-300 hover:underline"
                                        title="Re-check"
                                    >
                                        <RefreshCw className="w-3 h-3" /> Re-check
                                    </button>
                                </div>
                                <p className="text-sm text-orange-700 dark:text-orange-300 mt-1">
                                    Microsoft PIM policy changes do not reconcile existing assignments. The assignments listed below will remain in place after Apply unless you stage them for removal here.
                                </p>

                                {conflictsLoading && (
                                    <div className="mt-3 flex items-center gap-2 text-sm text-orange-700 dark:text-orange-300">
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Fetching per-role schedule instances...
                                    </div>
                                )}

                                {!conflictsLoading && openConflicts.length > 0 && (
                                    <>
                                        <div className="mt-3 flex items-center gap-2">
                                            <button
                                                onClick={stageAllConflicts}
                                                className="px-3 py-1.5 text-xs font-medium text-white bg-orange-600 hover:bg-orange-700 rounded-md flex items-center gap-1.5"
                                            >
                                                <Trash2 className="w-3 h-3" /> Stage all {openConflicts.length} for removal
                                            </button>
                                        </div>
                                        <ul className="mt-3 space-y-2 max-h-64 overflow-y-auto">
                                            {openConflicts.map(c => (
                                                <li
                                                    key={`${c.targetId}:${c.assignmentId}`}
                                                    className="flex items-start gap-2 p-2 bg-white dark:bg-zinc-800 border border-orange-200 dark:border-orange-800 rounded text-sm"
                                                >
                                                    <div className="flex-1 min-w-0">
                                                        <div className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
                                                            {c.principalDisplayName}
                                                        </div>
                                                        <div className="text-xs text-zinc-500 dark:text-zinc-400">
                                                            {c.targetName} · {c.assignmentType}
                                                            {c.accessType ? ` · ${c.accessType}` : ""}
                                                        </div>
                                                        <div className="text-xs text-orange-700 dark:text-orange-300 mt-0.5">
                                                            {c.detail}
                                                        </div>
                                                    </div>
                                                    <button
                                                        onClick={() => stageConflict(c)}
                                                        className="text-xs px-2 py-1 text-orange-700 dark:text-orange-300 hover:bg-orange-100 dark:hover:bg-orange-900/40 rounded flex items-center gap-1"
                                                    >
                                                        <Trash2 className="w-3 h-3" /> Stage removal
                                                    </button>
                                                </li>
                                            ))}
                                        </ul>
                                    </>
                                )}

                                {!conflictsLoading && openConflicts.length === 0 && conflicts.length > 0 && (
                                    <p className="text-sm text-emerald-700 dark:text-emerald-300 mt-2">
                                        All {conflicts.length} conflicting assignment{conflicts.length === 1 ? "" : "s"} staged for removal.
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* Policy Changes */}
                {hasPolicyChanges && policies && (
                    <>
                        <PolicySummaryCard
                            policies={policies}
                            label={isGroups ? "Policy Changes (Member)" : "Policy Changes"}
                        />
                        {isGroups && ownerPolicies && (
                            <PolicySummaryCard
                                policies={ownerPolicies}
                                label="Policy Changes (Owner)"
                            />
                        )}
                    </>
                )}

                {/* New Assignments */}
                {hasAssignmentChanges && assignments && (
                    <div className="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg p-4">
                        <div className="flex items-center gap-2 mb-4">
                            <UserPlus className="w-5 h-5 text-green-600 dark:text-green-400" />
                            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">
                                New Assignments ({assignments.principalIds.length})
                            </h3>
                        </div>

                        <div className="space-y-2 text-sm">
                            <div className="flex items-center gap-4">
                                <span className={`px-2 py-1 rounded text-xs font-medium ${assignments.assignmentType === "eligible"
                                    ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
                                    : "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300"
                                    }`}>
                                    {assignments.assignmentType === "eligible" ? "Eligible" : "Active"}
                                </span>
                                <span className="text-zinc-600 dark:text-zinc-400">
                                    Duration: {assignments.duration === "permanent" ? "Permanent" : formatDuration(assignments.duration)}
                                </span>
                                {isGroups && assignments.accessType && (
                                    <span className="text-zinc-600 dark:text-zinc-400">
                                        Access: {assignments.accessType === "member" ? "Member" : "Owner"}
                                    </span>
                                )}
                            </div>

                            <div className="mt-2 text-zinc-600 dark:text-zinc-400">
                                Will create <strong className="text-zinc-900 dark:text-zinc-100">
                                    {assignments.principalIds.length * selectedIds.length}
                                </strong> total assignments ({assignments.principalIds.length} principals × {selectedIds.length} {isGroups ? "groups" : "roles"})
                            </div>
                        </div>
                    </div>
                )}

                {/* Pending Removals */}
                {hasRemovals && (
                    <div className="bg-white dark:bg-zinc-800 border border-red-200 dark:border-red-800 rounded-lg p-4">
                        <div className="flex items-center gap-2 mb-4">
                            <Trash2 className="w-5 h-5 text-red-600 dark:text-red-400" />
                            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">
                                Pending Removals ({removals.length})
                            </h3>
                        </div>

                        <div className="text-sm text-zinc-600 dark:text-zinc-400">
                            {removals.length} existing assignment{removals.length !== 1 ? "s" : ""} will be removed.
                        </div>
                    </div>
                )}

                {/* No Changes Warning */}
                {!hasAnyChanges && (
                    <div className="bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-lg p-6 text-center">
                        <AlertTriangle className="w-8 h-8 text-zinc-400 mx-auto mb-3" />
                        <h3 className="font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                            No Changes to Apply
                        </h3>
                        <p className="text-sm text-zinc-500">
                            Configure policies or add assignments in the previous steps.
                        </p>
                    </div>
                )}
            </div>
        </WizardStep>
    );
});

function PolicySummaryCard({ policies, label }: { policies: PolicySettings; label: string }) {
    return (
        <div className="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-4">
                <Settings className="w-5 h-5 text-zinc-600 dark:text-zinc-400" />
                <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">
                    {label}
                </h3>
            </div>

            <div className="space-y-4">
                {/* Activation Settings */}
                <div>
                    <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                        Activation Settings
                    </h4>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                        <div className="flex items-center gap-2">
                            <Clock className="w-4 h-4 text-zinc-400" />
                            <span className="text-zinc-600 dark:text-zinc-400">Max Duration:</span>
                            <span className="font-medium text-zinc-900 dark:text-zinc-100">
                                {formatDuration(policies.maxActivationDuration)}
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            {policies.activationRequirement === "mfa" ? (
                                <CheckCircle2 className="w-4 h-4 text-green-500" />
                            ) : (
                                <span className="w-4 h-4 rounded-full border-2 border-zinc-300 dark:border-zinc-600" />
                            )}
                            <span className="text-zinc-600 dark:text-zinc-400">Require MFA:</span>
                            <span className="font-medium text-zinc-900 dark:text-zinc-100">
                                {policies.activationRequirement === "mfa" ? "Yes" : "No"}
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            {policies.requireJustificationOnActivation ? (
                                <CheckCircle2 className="w-4 h-4 text-green-500" />
                            ) : (
                                <span className="w-4 h-4 rounded-full border-2 border-zinc-300 dark:border-zinc-600" />
                            )}
                            <span className="text-zinc-600 dark:text-zinc-400">Require Justification:</span>
                            <span className="font-medium text-zinc-900 dark:text-zinc-100">
                                {policies.requireJustificationOnActivation ? "Yes" : "No"}
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            {policies.requireApproval ? (
                                <CheckCircle2 className="w-4 h-4 text-green-500" />
                            ) : (
                                <span className="w-4 h-4 rounded-full border-2 border-zinc-300 dark:border-zinc-600" />
                            )}
                            <span className="text-zinc-600 dark:text-zinc-400">Require Approval:</span>
                            <span className="font-medium text-zinc-900 dark:text-zinc-100">
                                {policies.requireApproval ? "Yes" : "No"}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Assignment Expiration */}
                <div>
                    <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                        Assignment Expiration
                    </h4>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                        <div className="flex items-center gap-2">
                            <span className="text-zinc-600 dark:text-zinc-400">Eligible:</span>
                            <span className="font-medium text-zinc-900 dark:text-zinc-100">
                                {policies.allowPermanentEligible
                                    ? "Permanent allowed"
                                    : formatDuration(policies.eligibleExpiration)
                                }
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-zinc-600 dark:text-zinc-400">Active:</span>
                            <span className="font-medium text-zinc-900 dark:text-zinc-100">
                                {policies.allowPermanentActive
                                    ? "Permanent allowed"
                                    : formatDuration(policies.activeExpiration)
                                }
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
