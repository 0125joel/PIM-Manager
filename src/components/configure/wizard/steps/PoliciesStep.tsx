"use client";

import React, { useState, useEffect } from 'react';
import { WizardStep } from '../WizardStep';
import { useWizardState, PolicySettings } from '@/hooks/useWizardState';
import { CheckCircle } from 'lucide-react';
import { Logger } from '@/utils/logger';
import { validateScopeMatch } from '@/utils/wizardValidation';
import { PolicySettingsForm, DEFAULT_POLICY_SETTINGS } from '@/components/configure/shared/PolicySettingsForm';

interface PoliciesStepProps {
    workload: "directoryRoles" | "pimGroups";
    onNext: () => void;
    onBack: () => void;
}

export const PoliciesStep = React.memo(function PoliciesStep({ workload, onNext, onBack }: PoliciesStepProps) {
    const { wizardData, updateData } = useWizardState();
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

    // Sync local state → wizard context
    useEffect(() => {
        const workloadKey = workload === "directoryRoles" ? "directoryRoles" : "pimGroups";
        updateData({
            [workloadKey]: {
                ...currentConfig,
                policies: memberPolicy,
                ...(isGroups && { ownerPolicies: ownerPolicy })
            }
        });
    }, [memberPolicy, ownerPolicy, workload, updateData, isGroups]);

    const selectedCount = workload === "directoryRoles"
        ? wizardData.selectedRoleIds.length
        : wizardData.selectedGroupIds.length;

    const workloadLabel = workload === "directoryRoles" ? "Directory Roles" : "PIM Groups";
    const configSource = currentConfig.configSource === "defaults" || !currentConfig.configSource
        ? "defaults"
        : "loaded";

    return (
        <WizardStep
            title="Policy Settings"
            description={`Configure activation rules for ${workloadLabel}`}
            onNext={onNext}
            onBack={onBack}
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
