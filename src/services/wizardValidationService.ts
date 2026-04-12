/**
 * @deprecated Import from "@/utils/wizardValidation" directly.
 * This re-export shim preserves backward compatibility.
 */
import { validateScopeMatch, getDesyncedWorkloads, isConfigDirty } from "@/utils/wizardValidation";

export const WizardValidationService = {
    validateScopeMatch,
    getDesyncedWorkloads,
    isConfigDirty,
};
