import React, { useMemo } from 'react';
import { WizardStep } from '../WizardStep';
import { useWorkloadConfig, useWizardData, PolicySettings } from '@/hooks/useWizardState';
import { usePimData } from '@/hooks/usePimData';
import { usePimGroupsData } from '@/hooks/usePimSelectors';
import { formatDuration } from '@/utils/durationUtils';
import {
    CheckCircle2,
    AlertTriangle,
    Users,
    Settings,
    Shield,
    Clock,
    UserPlus,
    Trash2
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

    // Check for high-risk roles
    const HIGH_RISK_ROLES = [
        "Global Administrator",
        "Privileged Role Administrator",
        "Security Administrator"
    ];

    const hasHighRiskRoles = !isGroups && selectedItems.some(
        item => HIGH_RISK_ROLES.some(hr => item.name.toLowerCase().includes(hr.toLowerCase()))
    );



    // Check if there's anything to apply
    const hasPolicyChanges = !!policies;
    const hasAssignmentChanges = assignments && assignments.principalIds && assignments.principalIds.length > 0;
    const hasRemovals = removals.length > 0;
    const hasAnyChanges = hasPolicyChanges || hasAssignmentChanges || hasRemovals;

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
                                High-Risk Roles Selected
                            </h4>
                            <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                                You are modifying privileged roles. Please verify the settings are correct before applying.
                            </p>
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
