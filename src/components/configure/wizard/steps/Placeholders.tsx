
import React from 'react';
import { WizardStep } from '../WizardStep';
import { useWizardState } from '@/hooks/useWizardState';
import { ConfigureWorkloadType as WorkloadType } from '@/types/workload.types';

interface WorkloadStepProps {
    workload: WorkloadType;
    onNext: () => void;
    onBack: () => void;
}

const workloadLabels: Record<WorkloadType, string> = {
    directoryRoles: "Directory Roles",
    pimGroups: "PIM Groups"
};

// PoliciesStep moved to PoliciesStep.tsx
// AssignmentsStep moved to AssignmentsStep.tsx
// ReviewStep moved to ReviewStep.tsx
// ApplyStep moved to ApplyStep.tsx

export function CheckpointStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
    const { wizardData } = useWizardState();
    const hasGroups = wizardData.workloads?.includes('pimGroups') && wizardData.selectedGroupIds?.length > 0;
    const rolesResult = wizardData.directoryRoles?.result;

    return (
        <WizardStep
            title="Checkpoint"
            description="Directory Roles complete! Continue to PIM Groups?"
            onNext={onNext}
            onBack={onBack}
            nextLabel="Continue to Groups"
            backLabel="Exit Wizard"
        >
            <div className="space-y-6">
                {/* Success Banner */}
                <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-6">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-green-100 dark:bg-green-900/40 rounded-full flex items-center justify-center">
                            <svg className="w-6 h-6 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                        </div>
                        <div>
                            <h3 className="text-lg font-semibold text-green-800 dark:text-green-200">
                                Directory Roles Complete
                            </h3>
                            <p className="text-sm text-green-600 dark:text-green-400">
                                {rolesResult
                                    ? `${rolesResult.policiesUpdated || 0} policies updated, ${rolesResult.assignmentsCreated || 0} assignments created`
                                    : "Configuration applied successfully"
                                }
                            </p>
                        </div>
                    </div>
                </div>

                {/* Next Workload Preview */}
                {hasGroups && (
                    <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/40 rounded-lg flex items-center justify-center">
                                <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                                </svg>
                            </div>
                            <div>
                                <span className="font-medium text-blue-800 dark:text-blue-200">Next: PIM Groups</span>
                                <span className="text-sm text-blue-600 dark:text-blue-400 ml-2">
                                    ({wizardData.selectedGroupIds?.length || 0} groups selected)
                                </span>
                            </div>
                        </div>
                    </div>
                )}

                {/* Choice Text */}
                <div className="text-center text-zinc-600 dark:text-zinc-400">
                    <p>You can continue to configure PIM Groups, or exit the wizard now.</p>
                    <p className="text-sm mt-2">Your Directory Roles changes have been saved.</p>
                </div>
            </div>
        </WizardStep>
    );
}

export function FinalStep() {
    const { wizardData } = useWizardState();

    const rolesResult = wizardData.directoryRoles?.result;
    const groupsResult = wizardData.pimGroups?.result;

    const hasRoles = wizardData.workloads?.includes('directoryRoles') && wizardData.selectedRoleIds?.length > 0;
    const hasGroups = wizardData.workloads?.includes('pimGroups') && wizardData.selectedGroupIds?.length > 0;

    const totalPolicies = (rolesResult?.policiesUpdated || 0) + (groupsResult?.policiesUpdated || 0);
    const totalAssignments = (rolesResult?.assignmentsCreated || 0) + (groupsResult?.assignmentsCreated || 0);
    const hasErrors = (rolesResult?.errors?.length || 0) + (groupsResult?.errors?.length || 0) > 0;

    return (
        <WizardStep
            title="Configuration Complete!"
            description="All changes have been applied."
            showButtons={false}
        >
            <div className="space-y-6">
                {/* Success Banner */}
                <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-8 text-center">
                    <div className="text-5xl mb-4">🎉</div>
                    <h2 className="text-2xl font-bold text-green-800 dark:text-green-200 mb-2">
                        Configuration Complete!
                    </h2>
                    <p className="text-green-600 dark:text-green-400">
                        Your PIM configuration has been applied successfully.
                    </p>
                </div>

                {/* Summary Stats */}
                <div className="grid grid-cols-2 gap-4">
                    {hasRoles && (
                        <div className="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg p-4">
                            <div className="flex items-center gap-3 mb-3">
                                <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/40 rounded-lg flex items-center justify-center">
                                    <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                                    </svg>
                                </div>
                                <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">Directory Roles</h3>
                            </div>
                            <div className="text-sm text-zinc-600 dark:text-zinc-400">
                                <p>{rolesResult?.policiesUpdated || 0} policies updated</p>
                                <p>{rolesResult?.assignmentsCreated || 0} assignments created</p>
                            </div>
                        </div>
                    )}

                    {hasGroups && (
                        <div className="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg p-4">
                            <div className="flex items-center gap-3 mb-3">
                                <div className="w-8 h-8 bg-purple-100 dark:bg-purple-900/40 rounded-lg flex items-center justify-center">
                                    <svg className="w-4 h-4 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                                    </svg>
                                </div>
                                <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">PIM Groups</h3>
                            </div>
                            <div className="text-sm text-zinc-600 dark:text-zinc-400">
                                <p>{groupsResult?.policiesUpdated || 0} policies updated</p>
                                <p>{groupsResult?.assignmentsCreated || 0} assignments created</p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Errors Warning */}
                {hasErrors && (
                    <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-4">
                        <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                            <span className="font-medium">Some operations had errors</span>
                        </div>
                        <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                            Check the Report page for details on what may need attention.
                        </p>
                    </div>
                )}

                {/* Navigation Buttons */}
                <div className="flex justify-center gap-4 pt-4">
                    <a
                        href="/report"
                        className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center gap-2"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        View Report
                    </a>
                    <a
                        href="/configure"
                        className="px-6 py-3 bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 rounded-lg hover:bg-zinc-300 dark:hover:bg-zinc-600 transition-colors font-medium"
                    >
                        New Configuration
                    </a>
                    <a
                        href="/dashboard"
                        className="px-6 py-3 bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 rounded-lg hover:bg-zinc-300 dark:hover:bg-zinc-600 transition-colors font-medium"
                    >
                        Dashboard
                    </a>
                </div>
            </div>
        </WizardStep>
    );
}
