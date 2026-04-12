import React, { useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useWizardState, WizardProvider, WizardStepId } from '@/hooks/useWizardState';
import { useNavigationGuard } from '@/hooks/useNavigationGuard';
import { WizardTimeline } from './wizard/WizardTimeline';
import { WizardErrorBoundary } from './wizard/ErrorBoundary';
import { BackupStep } from './wizard/steps/BackupStep';
import { WorkloadStep } from './wizard/steps/WorkloadStep';
import { ConfigTypeStep } from './wizard/steps/ConfigTypeStep';
import { ScopeStep } from './wizard/steps/ScopeStep';
import { PoliciesStep } from './wizard/steps/PoliciesStep';
import { AssignmentsStep } from './wizard/steps/AssignmentsStep';
import { ReviewStep } from './wizard/steps/ReviewStep';
import { ApplyStep } from './wizard/steps/ApplyStep';
import {
    CheckpointStep,
    FinalStep
} from './wizard/steps/Placeholders';

// Internal wizard content that uses the context
function WizardContent() {
    const {
        currentStep,
        currentStepIndex,
        steps,
        nextStep,
        prevStep,
        goToStep,
        regenerateSteps,
        isDirty
    } = useWizardState();

    // Navigation guard for in-app navigation (sidebar links, back button)
    // Disabled on FinalStep — wizard is complete, navigation must be free
    useNavigationGuard(isDirty && currentStep.id !== "final", "You have unsaved changes in the wizard. Are you sure you want to leave?");

    // Warn user when leaving page with unsaved changes (browser close/refresh)
    useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (isDirty && currentStep.id !== "final") {
                e.preventDefault();
                // Modern browsers show a generic message, but we set returnValue for compatibility
                e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
                return e.returnValue;
            }
        };

        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [isDirty, currentStep.id]);

    // Scope step needs special handling - regenerate steps before proceeding
    const handleScopeNext = () => {
        regenerateSteps();
        nextStep();
    };

    const renderStep = () => {
        switch (currentStep.id) {
            // Phase 1: Common steps
            case "backup":
                return <BackupStep onNext={nextStep} />;
            case "workload":
                return <WorkloadStep onNext={nextStep} onBack={prevStep} />;
            case "configType":
                return <ConfigTypeStep onNext={nextStep} onBack={prevStep} />;
            case "scope":
                return <ScopeStep onNext={handleScopeNext} onBack={prevStep} />;

            // Phase 2: Directory Roles steps
            case "policies_roles":
                return <PoliciesStep workload="directoryRoles" onNext={nextStep} onBack={prevStep} />;
            case "assignments_roles":
                return <AssignmentsStep workload="directoryRoles" onNext={nextStep} onBack={prevStep} />;
            case "review_roles":
                return <ReviewStep workload="directoryRoles" onNext={nextStep} onBack={prevStep} />;
            case "apply_roles":
                return <ApplyStep workload="directoryRoles" onNext={nextStep} onBack={prevStep} />;

            // Checkpoint
            case "checkpoint":
                return <CheckpointStep onNext={nextStep} onBack={prevStep} />;

            // Phase 2: PIM Groups steps
            case "policies_groups":
                return <PoliciesStep workload="pimGroups" onNext={nextStep} onBack={prevStep} />;
            case "assignments_groups":
                return <AssignmentsStep workload="pimGroups" onNext={nextStep} onBack={prevStep} />;
            case "review_groups":
                return <ReviewStep workload="pimGroups" onNext={nextStep} onBack={prevStep} />;
            case "apply_groups":
                return <ApplyStep workload="pimGroups" onNext={nextStep} onBack={prevStep} />;

            // Final
            case "final":
                return <FinalStep />;

            default:
                return <div className="p-8 text-center text-zinc-500">Unknown step: {currentStep.id}</div>;
        }
    };

    return (
        <div className="flex h-[calc(100vh-280px)] min-h-[500px] bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 overflow-hidden">
            <WizardTimeline
                steps={steps}
                currentStepIndex={currentStepIndex}
                onStepClick={goToStep}
            />
            <div className="flex-1 overflow-hidden">
                <WizardErrorBoundary stepName={currentStep.title}>
                    {renderStep()}
                </WizardErrorBoundary>
            </div>
        </div>
    );
}

// Main export: wraps content with provider
export function ConfigureWizard({ onBack }: { onBack?: () => void }) {
    return (
        <WizardProvider>
            {onBack && (
                <button
                    onClick={onBack}
                    className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 mb-6 transition-colors"
                >
                    <ArrowLeft className="h-4 w-4" />
                    Back to Mode Selection
                </button>
            )}
            <WizardContent />
        </WizardProvider>
    );
}
