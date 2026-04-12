import { WizardData, WorkloadConfig } from "@/types/wizard.types";
import { WorkloadType } from '@/types/workload.types';

/**
 * Pure validation logic for wizard state integrity.
 * No API calls — safe to import from any layer.
 */

/**
 * Checks if a WorkloadConfig's stored scope matches the current wizard selection.
 * Use this to detect "Ghost Configs" where data belongs to a previously selected role.
 */
export function validateScopeMatch(
    config: WorkloadConfig,
    workloadType: "directoryRoles" | "pimGroups",
    currentSelection: string[]
): boolean {
    const hasData = !!config.policies || !!config.assignments;
    if (!hasData) return true;

    const storedScope = workloadType === "directoryRoles" ? config.forRoleIds : config.forGroupIds;
    if (!storedScope) return false;

    if (storedScope.length !== currentSelection.length) return false;
    const sortedStored = [...storedScope].sort();
    const sortedCurrent = [...currentSelection].sort();
    return sortedStored.every((val, index) => val === sortedCurrent[index]);
}

/**
 * Determines which workloads should be reset based on a change in workload selection.
 * Returns an array of WorkloadTypes that were removed.
 */
export function getDesyncedWorkloads(
    oldWorkloads: WorkloadType[],
    newWorkloads: WorkloadType[]
): WorkloadType[] {
    return oldWorkloads.filter(w => !newWorkloads.includes(w));
}

/**
 * Checks if a configuration has been modified from a "blank" state.
 * Useful for showing "You will lose changes" warnings.
 */
export function isConfigDirty(config: WorkloadConfig): boolean {
    return !!config.policies || !!config.assignments;
}

// Legacy object-style export — matches WizardValidationService shape used by existing callers
export const WizardValidationUtils = {
    validateScopeMatch,
    getDesyncedWorkloads,
    isConfigDirty,
};
