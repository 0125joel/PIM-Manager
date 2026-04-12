"use client";

import { createContext, useContext, useState, useCallback, ReactNode, useMemo } from "react";
import { WorkloadType } from '@/types/workload.types';
import { validateScopeMatch, getDesyncedWorkloads, isConfigDirty } from "@/utils/wizardValidation";
// Re-export types from canonical location so existing imports from this file keep working
export type { PolicySettings, AssignmentConfig, AssignmentRemoval, WorkloadConfig, WizardData } from "@/types/wizard.types";

// Step IDs - includes base steps and per-workload dynamic steps
export type WizardStepId =
    // Phase 1: Common steps (always present)
    | "backup"
    | "workload"
    | "configType"
    | "scope"
    // Phase 2: Per-workload steps (dynamically added)
    | "policies_roles"
    | "assignments_roles"
    | "review_roles"
    | "apply_roles"
    | "checkpoint"
    | "policies_groups"
    | "assignments_groups"
    | "review_groups"
    | "apply_groups"
    | "final";

export interface WizardStep {
    id: WizardStepId;
    title: string;
    description: string;
    isCompleted: boolean;
    canNavigate: boolean;
    workload?: "directoryRoles" | "pimGroups"; // Which workload this step belongs to
    isHeader?: boolean; // True for workload section headers in timeline
}

import type { PolicySettings, AssignmentConfig, AssignmentRemoval, WorkloadConfig, WizardData } from "@/types/wizard.types";

const INITIAL_WORKLOAD_CONFIG: WorkloadConfig = {
    applied: false
};

const INITIAL_DATA: WizardData = {
    workloads: [],
    configType: "both",
    selectedRoleIds: [],
    selectedGroupIds: [],
    configMode: "scratch",
    cloneMode: "new",
    directoryRoles: { ...INITIAL_WORKLOAD_CONFIG },
    pimGroups: { ...INITIAL_WORKLOAD_CONFIG },
    currentWorkloadIndex: 0,
    // Legacy
    scopes: [],
    settings: {},
    assignments: {}
};

interface WizardContextType {
    currentStep: WizardStep;
    currentStepIndex: number;
    steps: WizardStep[];
    wizardData: WizardData;
    isDirty: boolean; // True if user has unsaved changes
    nextStep: () => void;
    prevStep: () => void;
    goToStep: (index: number) => void;
    updateData: (data: Partial<WizardData>) => void;
    updateWorkloadConfig: (workload: WorkloadType, updates: Partial<WorkloadConfig>) => void;
    resetWizard: () => void;
    regenerateSteps: () => void; // Called after ScopeStep to build dynamic steps
}

// Base steps - always present (Phase 1 of wizard)
const BASE_STEPS: WizardStep[] = [
    { id: "backup", title: "Safety Check", description: "Backup & Refresh", isCompleted: false, canNavigate: true },
    { id: "workload", title: "Workload", description: "Select Target Service", isCompleted: false, canNavigate: false },
    { id: "configType", title: "Configuration", description: "Settings or Assignments", isCompleted: false, canNavigate: false },
    { id: "scope", title: "Scope", description: "Select Roles/Groups", isCompleted: false, canNavigate: false },
];

// Generate dynamic steps based on selected workloads and config type
function generateDynamicSteps(workloads: WorkloadType[], configType: WizardData["configType"]): WizardStep[] {
    const steps: WizardStep[] = [];
    const hasRoles = workloads.includes("directoryRoles");
    const hasGroups = workloads.includes("pimGroups");
    const needsPolicies = configType === "settings" || configType === "both";
    const needsAssignments = configType === "assignment" || configType === "both";

    // Directory Roles steps
    if (hasRoles) {
        if (needsPolicies) {
            steps.push({ id: "policies_roles", title: "Policies", description: "Directory Roles", isCompleted: false, canNavigate: false, workload: "directoryRoles" });
        }
        if (needsAssignments) {
            steps.push({ id: "assignments_roles", title: "Assignments", description: "Directory Roles", isCompleted: false, canNavigate: false, workload: "directoryRoles" });
        }
        steps.push({ id: "review_roles", title: "Review", description: "Directory Roles", isCompleted: false, canNavigate: false, workload: "directoryRoles" });
        steps.push({ id: "apply_roles", title: "Apply", description: "Directory Roles", isCompleted: false, canNavigate: false, workload: "directoryRoles" });
    }

    // Checkpoint between workloads
    if (hasRoles && hasGroups) {
        steps.push({ id: "checkpoint", title: "Checkpoint", description: "Continue to Groups?", isCompleted: false, canNavigate: false });
    }

    // PIM Groups steps
    if (hasGroups) {
        if (needsPolicies) {
            steps.push({ id: "policies_groups", title: "Policies", description: "PIM Groups", isCompleted: false, canNavigate: false, workload: "pimGroups" });
        }
        if (needsAssignments) {
            steps.push({ id: "assignments_groups", title: "Assignments", description: "PIM Groups", isCompleted: false, canNavigate: false, workload: "pimGroups" });
        }
        steps.push({ id: "review_groups", title: "Review", description: "PIM Groups", isCompleted: false, canNavigate: false, workload: "pimGroups" });
        steps.push({ id: "apply_groups", title: "Apply", description: "PIM Groups", isCompleted: false, canNavigate: false, workload: "pimGroups" });
    }

    // Final step
    steps.push({ id: "final", title: "Complete", description: "Configuration Done", isCompleted: false, canNavigate: false });

    return steps;
}

// Combined steps for initial state (before workload selection)
const INITIAL_STEPS: WizardStep[] = [
    ...BASE_STEPS,
    { id: "final", title: "Complete", description: "Finish", isCompleted: false, canNavigate: false }
];

const WizardContext = createContext<WizardContextType | undefined>(undefined);

export function WizardProvider({ children }: { children: ReactNode }) {
    const [currentStepIndex, setCurrentStepIndex] = useState(0);
    const [steps, setSteps] = useState<WizardStep[]>(INITIAL_STEPS);
    const [wizardData, setWizardData] = useState<WizardData>(INITIAL_DATA);

    // No persistence - wizard resets on page refresh or navigation

    const nextStep = useCallback(() => {
        if (currentStepIndex < steps.length - 1) {
            setSteps(prev => prev.map((s, i) =>
                i === currentStepIndex ? { ...s, isCompleted: true, canNavigate: true } : s
            ));
            setCurrentStepIndex(prev => prev + 1);
        }
    }, [currentStepIndex, steps.length]);

    const prevStep = useCallback(() => {
        if (currentStepIndex > 0) {
            const newIndex = currentStepIndex - 1;
            setCurrentStepIndex(newIndex);
            // When navigating back into the base steps, trim dynamic steps so the
            // timeline does not show stale workload steps that may no longer reflect
            // the user's (changed) workload/configType selection. They will be
            // re-generated fresh when the user advances through ScopeStep again.
            if (newIndex < BASE_STEPS.length) {
                setSteps(
                    BASE_STEPS.map((step, i) => ({
                        ...step,
                        isCompleted: i < newIndex,
                        canNavigate: i <= newIndex,
                    })).concat({ id: "final", title: "Complete", description: "Finish", isCompleted: false, canNavigate: false })
                );
            }
        }
    }, [currentStepIndex]);

    const goToStep = useCallback((index: number) => {
        if (index >= 0 && index < steps.length && steps[index].canNavigate) {
            setCurrentStepIndex(index);
        }
    }, [steps]);

    // OPTIMIZATION: Reduce object mutation chain (6-8 copies → 1-2 copies)
    // Use single object creation with computed properties instead of multiple spreads
    const updateData = useCallback((data: Partial<WizardData>) => {
        setWizardData(prev => {
            // Pre-compute workload changes if needed
            let directoryRoles = data.directoryRoles ?? prev.directoryRoles;
            let pimGroups = data.pimGroups ?? prev.pimGroups;

            // --- Safety Logic: Intercept and Reset Invalid States ---

            // 1. Workload Deselection Check
            if (data.workloads) {
                const removed = getDesyncedWorkloads(prev.workloads, data.workloads);
                removed.forEach(w => {
                    if (w === 'directoryRoles') {
                        directoryRoles = { ...INITIAL_WORKLOAD_CONFIG };
                    } else if (w === 'pimGroups') {
                        pimGroups = { ...INITIAL_WORKLOAD_CONFIG };
                    }
                });
            }

            // 2. Directory Role Scope Mismatch Check
            if (data.selectedRoleIds) {
                const currentConfig = data.directoryRoles || prev.directoryRoles;
                const match = validateScopeMatch(currentConfig, 'directoryRoles', data.selectedRoleIds);

                if (!match) {
                    if (!data.directoryRoles) {
                        directoryRoles = {
                            ...INITIAL_WORKLOAD_CONFIG,
                            forRoleIds: data.selectedRoleIds
                        };
                    } else {
                        directoryRoles = {
                            ...directoryRoles,
                            forRoleIds: data.selectedRoleIds
                        };
                    }
                } else {
                    directoryRoles = {
                        ...directoryRoles,
                        forRoleIds: data.selectedRoleIds
                    };
                }
            }

            // 3. PIM Group Scope Mismatch Check
            if (data.selectedGroupIds) {
                const currentConfig = data.pimGroups || prev.pimGroups;
                const match = validateScopeMatch(currentConfig, 'pimGroups', data.selectedGroupIds);

                if (!match) {
                    if (!data.pimGroups) {
                        pimGroups = {
                            ...INITIAL_WORKLOAD_CONFIG,
                            forGroupIds: data.selectedGroupIds
                        };
                    } else {
                        pimGroups = {
                            ...pimGroups,
                            forGroupIds: data.selectedGroupIds
                        };
                    }
                } else {
                    pimGroups = {
                        ...pimGroups,
                        forGroupIds: data.selectedGroupIds
                    };
                }
            }

            // Single object creation at the end
            return {
                ...prev,
                ...data,
                directoryRoles,
                pimGroups
            };
        });
    }, []);

    const updateWorkloadConfig = useCallback((workload: WorkloadType, updates: Partial<WorkloadConfig>) => {
        setWizardData(prev => {
            const currentWorkloadConfig = workload === 'directoryRoles' ? prev.directoryRoles : prev.pimGroups;
            const nextWorkloadConfig = { ...currentWorkloadConfig, ...updates };

            return {
                ...prev,
                [workload]: nextWorkloadConfig
            };
        });
    }, []);

    const resetWizard = useCallback(() => {
        setWizardData(INITIAL_DATA);
        setCurrentStepIndex(0);
        setSteps(INITIAL_STEPS);
    }, []);

    // Regenerate steps based on current selections (called after ScopeStep)
    const regenerateSteps = useCallback(() => {
        const dynamicSteps = generateDynamicSteps(wizardData.workloads, wizardData.configType);

        // Preserve completion state of base steps
        const newSteps: WizardStep[] = BASE_STEPS.map((step, index) => ({
            ...step,
            isCompleted: index < currentStepIndex,
            canNavigate: index <= currentStepIndex
        }));

        // Add dynamic steps
        newSteps.push(...dynamicSteps);

        setSteps(newSteps);
    }, [wizardData.workloads, wizardData.configType, currentStepIndex]);

    // Compute isDirty: true if any workload config has unsaved changes
    const isDirty = useMemo(() => {
        return isConfigDirty(wizardData.directoryRoles) ||
            isConfigDirty(wizardData.pimGroups);
    }, [wizardData.directoryRoles, wizardData.pimGroups]);

    return (
        <WizardContext.Provider value={{
            currentStep: steps[currentStepIndex],
            currentStepIndex,
            steps,
            wizardData,
            isDirty,
            nextStep,
            prevStep,
            goToStep,
            updateData,
            updateWorkloadConfig,
            resetWizard,
            regenerateSteps
        }}>
            {children}
        </WizardContext.Provider>
    );
}

export function useWizardState() {
    const context = useContext(WizardContext);
    if (context === undefined) {
        throw new Error("useWizardState must be used within a WizardProvider");
    }
    return context;
}

// ============================================================================
// PERFORMANCE: Selector Pattern Hooks
// ============================================================================
// These hooks allow components to subscribe to only the wizard state they need,
// preventing unnecessary re-renders when unrelated state changes.
// See docs/Assets/Code Optimization Analysis (KRITIEK #4)
// ============================================================================

/**
 * Generic selector hook for wizard data
 * Usage: const selectedRoles = useWizardData(data => data.selectedRoleIds);
 * Components re-render ONLY when the selected data changes
 */
export function useWizardData<T>(selector: (data: WizardData) => T): T {
    const { wizardData } = useWizardState();
    // Intentionally omit `selector` from deps — inline arrow selectors change identity
    // every render, which would defeat the memoization entirely. The selector is a pure
    // computation; only wizardData changes should trigger recalculation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return useMemo(() => selector(wizardData), [wizardData]);
}

/**
 * Hook for wizard navigation actions only
 * Re-renders only when navigation functions or current step changes
 */
export function useWizardNavigation() {
    const { nextStep, prevStep, goToStep, currentStep, currentStepIndex } = useWizardState();
    return useMemo(
        () => ({ nextStep, prevStep, goToStep, currentStep, currentStepIndex }),
        [nextStep, prevStep, goToStep, currentStep, currentStepIndex]
    );
}

/**
 * Hook for wizard update actions only
 * Re-renders only when update functions change
 */
export function useWizardActions() {
    const { updateData, updateWorkloadConfig, resetWizard, regenerateSteps } = useWizardState();
    return useMemo(
        () => ({ updateData, updateWorkloadConfig, resetWizard, regenerateSteps }),
        [updateData, updateWorkloadConfig, resetWizard, regenerateSteps]
    );
}

/**
 * Hook for wizard steps array only
 * Re-renders only when steps array changes (step completion, regeneration)
 */
export function useWizardSteps() {
    const { steps } = useWizardState();
    return useMemo(() => steps, [steps]);
}

/**
 * Hook for wizard dirty state only
 * Re-renders only when isDirty changes
 */
export function useWizardDirty() {
    const { isDirty } = useWizardState();
    return isDirty;
}

/**
 * Hook for specific workload config
 * Usage: const rolesConfig = useWorkloadConfig("directoryRoles");
 * Re-renders only when that specific workload config changes
 */
export function useWorkloadConfig(workload: "directoryRoles" | "pimGroups"): WorkloadConfig {
    const { wizardData } = useWizardState();
    return useMemo(() => wizardData[workload], [wizardData, workload]);
}

// Re-export types for convenience
export type { WizardContextType };
