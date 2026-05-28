"use client";

import React, { useState, useEffect } from 'react';
import { WizardStep } from '../WizardStep';
import { useWizardState, useWizardActions, PolicySettings } from '@/hooks/useWizardState';
import { CheckCircle, XCircle } from 'lucide-react';
import { Logger } from '@/utils/logger';
import { validateScopeMatch } from '@/utils/wizardValidation';
import { PolicySettingsForm, DEFAULT_POLICY_SETTINGS } from '@/components/configure/shared/PolicySettingsForm';

interface PoliciesStepProps {
    workload: "directoryRoles" | "pimGroups";
    onNext: () => void;
    onBack: () => void;
}

export const PoliciesStep = React.memo(function PoliciesStep({ workload, onNext, onBack }: PoliciesStepProps) {
    const { wizardData } = useWizardState();
    const { updateWorkloadConfig } = useWizardActions();
    const isGroups = workload === "pimGroups";

    const [accessType, setAccessType] = useState<"member" | "owner">("member");

    const currentConfig = workload === "directoryRoles"
        ? wizardData.directoryRoles
        : wizardData.pimGroups;

    const [memberPolicy, setMemberPolicy] = useState<PolicySettings>(
        currentConfig.policies || DEFAULT_POLICY_SETTINGS
    );
    const [ownerPolicy, setOwnerPolicy] = useState<PolicySettings>(
        currentConfig.ownerPolicies || DEFAULT_POLICY_SETTINGS
    );

    // Defense-in-depth: Validate scope match on mount
    useEffect(() => {
        const currentIds = workload === "directoryRoles" ? wizardData.selectedRoleIds : wizardData.selectedGroupIds;
        const isValid = validateScopeMatch(currentConfig, workload, currentIds);
        if (!isValid) {
            Logger.warn('PoliciesStep', `Config scope mismatch detected for ${workload}. Resetting to defaults.`);
            setMemberPolicy(DEFAULT_POLICY_SETTINGS);
            setOwnerPolicy(DEFAULT_POLICY_SETTINGS);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Sync local state → wizard context.
    // Use the per-workload setter so we only update the policy keys and don't
    // clobber concurrent changes to other fields on the same workload config.
    useEffect(() => {
        updateWorkloadConfig(workload, {
            policies: memberPolicy,
            ...(isGroups ? { ownerPolicies: ownerPolicy } : {})
        });
    }, [memberPolicy, ownerPolicy, workload, updateWorkloadConfig, isGroups]);

    const selectedCount = workload === "directoryRoles"
        ? wizardData.selectedRoleIds.length
        : wizardData.selectedGroupIds.length;

    const workloadLabel = workload === "directoryRoles" ? "Directory Roles" : "PIM Groups";
    const configSource = currentConfig.configSource === "defaults" || !currentConfig.configSource
        ? "defaults"
        : "loaded";

    // D3: hard-block Next when approval is required but no approvers configured.
    // Without approvers, EVERY future activation queues forever — silent foot-gun.
    const approvalNoApproversMember = memberPolicy.requireApproval && (memberPolicy.approvers?.length ?? 0) === 0;
    const approvalNoApproversOwner = isGroups && ownerPolicy.requireApproval && (ownerPolicy.approvers?.length ?? 0) === 0;
    const approvalGap = approvalNoApproversMember || approvalNoApproversOwner;

    return (
        <WizardStep
            title="Policy Settings"
            description={`Configure activation rules for ${workloadLabel}`}
            onNext={onNext}
            onBack={onBack}
            isNextDisabled={approvalGap}
        >
            <div className="space-y-4">
                <PolicySettingsForm
                    value={memberPolicy}
                    onChange={setMemberPolicy}
                    workload={workload}
                    accessType={isGroups ? accessType : undefined}
                    onAccessTypeChange={isGroups ? setAccessType : undefined}
                    ownerValue={isGroups ? ownerPolicy : undefined}
                    onOwnerChange={isGroups ? setOwnerPolicy : undefined}
                    configSource={configSource}
                />

                {/* D3: approval requires approvers */}
                {approvalGap && (
                    <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm">
                        <XCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                        <div className="text-red-700 dark:text-red-300">
                            <div className="font-medium">
                                {approvalNoApproversMember && approvalNoApproversOwner
                                    ? "Approval is required for both Member and Owner, but no approvers are configured."
                                    : approvalNoApproversOwner
                                        ? "Approval is required for Owner, but no Owner approvers are configured."
                                        : "Approval is required, but no approvers are configured."}
                            </div>
                            <div className="mt-1 text-xs">
                                Without approvers, every future activation will block forever. Add at least one approver above before continuing, or disable <em>Require approval to activate</em>.
                            </div>
                        </div>
                    </div>
                )}

                {/* Summary */}
                <div className="flex items-center gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-sm">
                    <CheckCircle className="w-4 h-4 text-blue-500 flex-shrink-0" />
                    <span className="text-blue-700 dark:text-blue-300">
                        These settings will apply to <strong>{selectedCount}</strong> {workload === "directoryRoles" ? "role" : "group"}{selectedCount !== 1 ? "s" : ""}
                    </span>
                </div>
            </div>
        </WizardStep>
    );
});
