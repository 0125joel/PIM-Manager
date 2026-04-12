
import React, { useState, useEffect } from 'react';
import { WizardStep } from '../WizardStep';
import { WorkloadType } from '@/types/workload.types';
import { useWizardState } from '@/hooks/useWizardState';
import { WorkloadCardProps } from '@/types/wizard.types';
import { useIncrementalConsent, isWriteConsentGranted } from '@/hooks/useIncrementalConsent';
import { Users, Shield, Check, AlertTriangle, ArrowRight, Loader2 } from 'lucide-react';

export function WorkloadStep({ onNext, onBack }: { onNext: () => void, onBack: () => void }) {
    const { wizardData, updateData } = useWizardState();
    const { requestWriteConsent } = useIncrementalConsent();
    const [selectedWorkloads, setSelectedWorkloads] = useState<WorkloadType[]>(wizardData.workloads || []);

    // Track consent status locally for UI updates
    const [consentStatus, setConsentStatus] = useState<Record<WorkloadType, boolean>>({
        directoryRoles: false,
        pimGroups: false,
        intune: false,
        exchange: false,
        sharepoint: false,
        defender: false
    });

    const [isConsenting, setIsConsenting] = useState<string | null>(null);

    // Initial check for consent
    useEffect(() => {
        setConsentStatus({
            directoryRoles: isWriteConsentGranted("directoryRoles"),
            pimGroups: isWriteConsentGranted("pimGroups"),
            intune: isWriteConsentGranted("intune"),
            exchange: isWriteConsentGranted("exchange"),
            sharepoint: isWriteConsentGranted("sharepoint"),
            defender: isWriteConsentGranted("defender")
        });
    }, []);

    const handleToggle = async (workload: WorkloadType) => {
        // If selecting, check consent first
        const isCurrentlySelected = selectedWorkloads.includes(workload);

        if (!isCurrentlySelected) {
            // Trying to select
            if (!consentStatus[workload]) {
                // Need consent
                setIsConsenting(workload);
                const granted = await requestWriteConsent(workload);
                setIsConsenting(null);

                if (granted) {
                    setConsentStatus(prev => ({ ...prev, [workload]: true }));
                    setSelectedWorkloads(prev => [...prev, workload]);
                }
            } else {
                // Already have consent
                setSelectedWorkloads(prev => [...prev, workload]);
            }
        } else {
            // Deselecting is always allowed
            setSelectedWorkloads(prev => prev.filter(w => w !== workload));
        }
    };

    const handleNext = () => {
        // Clear selections for workloads that are not selected
        const updates: Partial<typeof wizardData> = {
            workloads: selectedWorkloads
        };

        // If directoryRoles is NOT selected, clear its selections
        if (!selectedWorkloads.includes("directoryRoles")) {
            updates.selectedRoleIds = [];
        }

        // If pimGroups is NOT selected, clear its selections
        if (!selectedWorkloads.includes("pimGroups")) {
            updates.selectedGroupIds = [];
        }

        updateData(updates);
        onNext();
    };

    const isNextDisabled = selectedWorkloads.length === 0;

    return (
        <WizardStep
            title="Workload Selection"
            description="Choose which services you want to configure."
            onNext={handleNext}
            onBack={onBack}
            isNextDisabled={isNextDisabled}
        >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                {/* Directory Roles Card */}
                <WorkloadCard
                    id="directoryRoles"
                    title="Entra ID Roles"
                    description="Configure policies and assignments for directory roles (e.g. Global Admin)."
                    icon={Users}
                    isSelected={selectedWorkloads.includes("directoryRoles")}
                    hasConsent={consentStatus.directoryRoles}
                    isConsenting={isConsenting === "directoryRoles"}
                    onToggle={() => handleToggle("directoryRoles")}
                />

                {/* PIM Groups Card */}
                <WorkloadCard
                    id="pimGroups"
                    title="PIM for Groups"
                    description="Configure policies for PIM-enabled security groups (Privileged Access Groups)."
                    icon={Shield}
                    isSelected={selectedWorkloads.includes("pimGroups")}
                    hasConsent={consentStatus.pimGroups}
                    isConsenting={isConsenting === "pimGroups"}
                    onToggle={() => handleToggle("pimGroups")}
                />

            </div>

            {selectedWorkloads.length === 0 && (
                <div className="mt-6 p-4 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                    <div>
                        <p className="font-medium">No Workload Selected</p>
                        <p className="text-sm mt-1">Please select at least one workload to proceed with configuration.</p>
                    </div>
                </div>
            )}
        </WizardStep>
    );
}

function WorkloadCard({
    id, title, description, icon: Icon, isSelected, hasConsent, isConsenting, onToggle
}: {
    id: string,
    title: string,
    description: string,
    icon: React.ComponentType<{ className?: string }>,
    isSelected: boolean,
    hasConsent: boolean,
    isConsenting: boolean,
    onToggle: () => void
}) {
    return (
        <div
            onClick={onToggle}
            className={`
                relative p-4 rounded-lg border-2 cursor-pointer transition-all duration-200 h-full flex flex-col
                ${isSelected
                    ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-900/20 dark:border-blue-400'
                    : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600 bg-white dark:bg-zinc-800'}
            `}
        >
            {isSelected && (
                <div className="absolute top-2 right-2 text-blue-500 dark:text-blue-400">
                    <Check className="w-5 h-5 p-0.5 bg-blue-100 dark:bg-blue-900/50 rounded-full" />
                </div>
            )}

            <div className="flex items-start gap-3">
                <div className={`p-2 rounded-md ${isSelected ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300' : 'bg-zinc-100 dark:bg-zinc-700/50 text-zinc-500 dark:text-zinc-400'}`}>
                    <Icon className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                    <h3 className={`font-medium text-sm ${isSelected ? 'text-blue-700 dark:text-blue-300' : 'text-zinc-900 dark:text-zinc-100'}`}>
                        {title}
                    </h3>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 line-clamp-2">
                        {description}
                    </p>

                    {!hasConsent && (
                        <div className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded">
                            <AlertTriangle className="w-3 h-3" />
                            Requires Write Permission
                        </div>
                    )}

                    {isConsenting && (
                        <div className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Requesting access...
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
