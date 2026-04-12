
import React from 'react';
import { WizardStep } from '../WizardStep';
import { useWizardState } from '@/hooks/useWizardState';
import { Settings, UserPlus, Layers } from 'lucide-react';

export function ConfigTypeStep({ onNext, onBack }: { onNext: () => void, onBack: () => void }) {
    const { wizardData, updateData } = useWizardState();
    const configType = wizardData.configType || "both";

    const handleSelect = (type: "settings" | "assignment" | "both") => {
        updateData({ configType: type });
    };

    const handleNext = () => {
        onNext();
    };

    return (
        <WizardStep
            title="Configuration Type"
            description="What would you like to configure for the selected workloads?"
            onNext={handleNext}
            onBack={onBack}
        >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

                <TypeCard
                    title="Policies Only"
                    description="Configure activation rules, expiration, approval requirements, and notification settings."
                    icon={Settings}
                    isSelected={configType === "settings"}
                    onClick={() => handleSelect("settings")}
                />

                <TypeCard
                    title="Assignments Only"
                    description="Manage eligible and active member assignments for roles or groups."
                    icon={UserPlus}
                    isSelected={configType === "assignment"}
                    onClick={() => handleSelect("assignment")}
                />

                <TypeCard
                    title="Both"
                    description="Configure both policy settings and member assignments in one flow."
                    icon={Layers}
                    isSelected={configType === "both"}
                    onClick={() => handleSelect("both")}
                />

            </div>

            <div className="mt-8 p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-600 dark:text-zinc-400">
                <span className="font-semibold block mb-1 text-zinc-900 dark:text-zinc-100">
                    Selected Flow:
                </span>
                {configType === "settings" && "You will define policy rules for the selected roles/groups."}
                {configType === "assignment" && "You will assign users or groups to the selected roles/groups."}
                {configType === "both" && "You will first define policy rules, then assign members."}
            </div>
        </WizardStep>
    );
}

function TypeCard({
    title, description, icon: Icon, isSelected, onClick
}: {
    title: string,
    description: string,
    icon: any,
    isSelected: boolean,
    onClick: () => void
}) {
    return (
        <div
            onClick={onClick}
            className={`
                p-4 rounded-lg border-2 cursor-pointer transition-all duration-200 h-full flex items-start gap-3
                ${isSelected
                    ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-900/20 dark:border-blue-400'
                    : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600 bg-white dark:bg-zinc-800'}
            `}
        >
            <div className={`p-2 rounded-md flex-shrink-0 ${isSelected ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300' : 'bg-zinc-100 dark:bg-zinc-700/50 text-zinc-500 dark:text-zinc-400'}`}>
                <Icon className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
                <h3 className={`font-medium text-sm ${isSelected ? 'text-blue-700 dark:text-blue-300' : 'text-zinc-900 dark:text-zinc-100'}`}>
                    {title}
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                    {description}
                </p>
            </div>
        </div>
    );
}
