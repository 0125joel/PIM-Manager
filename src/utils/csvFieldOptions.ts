import { ACTIVATION_DURATION_OPTIONS as ACTIVATION_DURATION_OPTIONS_WITH_LABELS, EXPIRATION_OPTIONS } from '@/utils/durationUtils';

// Matches DurationSlider range in PolicySettingsForm (0.5h–24h)
// Source of truth: durationUtils.ACTIVATION_DURATION_OPTIONS
export const ACTIVATION_DURATION_OPTIONS = ACTIVATION_DURATION_OPTIONS_WITH_LABELS.map(o => o.value);

// For assignment Duration Days column
export const ASSIGNMENT_DURATION_DAY_OPTIONS = [
    "permanent", "1", "7", "14", "30", "90", "180", "365",
] as const;

export const BOOLEAN_OPTIONS = ["Yes", "No"] as const;

// Matches AssignmentTypeCard options
export const ASSIGNMENT_TYPE_OPTIONS = ["eligible", "active"] as const;

// Matches AssignmentScopePicker group radio options
export const ACCESS_TYPE_OPTIONS = ["member", "owner"] as const;

// Expiration options derived from durationUtils (same as PolicySettingsForm uses)
export const EXPIRATION_DURATION_OPTIONS = EXPIRATION_OPTIONS.map(o => o.value);
// → ["P15D", "P1M", "P3M", "P6M", "P1Y"]

export interface CsvFieldInfo {
    column: string;
    validValues: readonly string[];
    description?: string;
    required: boolean;
    readOnly?: boolean;
}

export type CsvTemplateType =
    | "rolePolicies"
    | "groupPolicies"
    | "roleAssignments"
    | "groupAssignments"
    | "roleAssignmentRemovals"
    | "groupAssignmentRemovals";

export const CSV_TEMPLATE_FIELDS: Record<CsvTemplateType, CsvFieldInfo[]> = {
    rolePolicies: [
        { column: "Role ID", validValues: ["<UUID>"], description: "Stable identifier — preferred over name", required: true },
        { column: "Role Name", validValues: ["<any text>"], description: "Fallback if Role ID is absent or unresolved", required: false },
        { column: "Max Activation Duration", validValues: ACTIVATION_DURATION_OPTIONS, description: "ISO 8601 duration format", required: false },
        { column: "MFA Required", validValues: BOOLEAN_OPTIONS, required: false },
        { column: "Justification Required", validValues: BOOLEAN_OPTIONS, required: false },
        { column: "Approval Required", validValues: BOOLEAN_OPTIONS, required: false },
        { column: "Approvers", validValues: ["email@domain.com"], description: "Semicolon-separated UPNs", required: false },
        { column: "Auth Context", validValues: [], description: "Not configurable via CSV — use Wizard mode to set Authentication Context", required: false, readOnly: true },
        { column: "Description / Built-in / Privileged / PIM Configured / Counts", validValues: [], description: "Read-only statistics — ignored during import", required: false, readOnly: true },
    ],
    groupPolicies: [
        { column: "Group ID", validValues: ["<UUID>"], description: "Stable identifier — preferred over name", required: true },
        { column: "Group Name", validValues: ["<any text>"], description: "Fallback if Group ID is absent or unresolved", required: false },
        { column: "Member Max Duration", validValues: ACTIVATION_DURATION_OPTIONS, description: "ISO 8601 duration format", required: false },
        { column: "Member MFA", validValues: BOOLEAN_OPTIONS, required: false },
        { column: "Member Approval", validValues: BOOLEAN_OPTIONS, required: false },
        { column: "Owner Max Duration", validValues: ACTIVATION_DURATION_OPTIONS, description: "ISO 8601 duration format", required: false },
        { column: "Owner MFA", validValues: BOOLEAN_OPTIONS, required: false },
        { column: "Owner Approval", validValues: BOOLEAN_OPTIONS, required: false },
        { column: "Group Type / Role-Assignable / Counts", validValues: [], description: "Read-only statistics — ignored during import", required: false, readOnly: true },
    ],
    roleAssignments: [
        { column: "Role ID", validValues: ["<UUID>"], description: "Stable identifier — preferred over name", required: true },
        { column: "Role Name", validValues: ["<any text>"], description: "Fallback if Role ID is absent or unresolved", required: false },
        { column: "Principal ID", validValues: ["<UUID>"], description: "Object ID — required for groups and service principals", required: true },
        { column: "Principal UPN", validValues: ["user@domain.com"], description: "User fallback only — groups/service principals need Principal ID", required: false },
        { column: "Assignment Type", validValues: ASSIGNMENT_TYPE_OPTIONS, required: true },
        { column: "Duration Days", validValues: ASSIGNMENT_DURATION_DAY_OPTIONS, description: "Leave blank for policy default. 'permanent' requires the policy to allow no-expiration.", required: false },
        { column: "Justification", validValues: ["<any text>"], required: false },
        { column: "Action", validValues: ["add", "remove"], description: "Default: add. Set to 'remove' to delete the assignment instead.", required: false },
    ],
    groupAssignments: [
        { column: "Group ID", validValues: ["<UUID>"], description: "Stable identifier — preferred over name", required: true },
        { column: "Group Name", validValues: ["<any text>"], description: "Fallback if Group ID is absent or unresolved", required: false },
        { column: "Principal ID", validValues: ["<UUID>"], description: "Object ID — required for groups and service principals", required: true },
        { column: "Principal UPN", validValues: ["user@domain.com"], description: "User fallback only — groups/service principals need Principal ID", required: false },
        { column: "Access Type", validValues: ACCESS_TYPE_OPTIONS, required: true },
        { column: "Assignment Type", validValues: ASSIGNMENT_TYPE_OPTIONS, required: true },
        { column: "Duration Days", validValues: ASSIGNMENT_DURATION_DAY_OPTIONS, description: "Leave blank for policy default. 'permanent' requires the policy to allow no-expiration.", required: false },
        { column: "Justification", validValues: ["<any text>"], required: false },
        { column: "Action", validValues: ["add", "remove"], description: "Default: add. Set to 'remove' to delete the assignment instead.", required: false },
    ],
    roleAssignmentRemovals: [
        { column: "Role ID", validValues: ["<UUID>"], description: "Stable identifier — preferred over name", required: true },
        { column: "Role Name", validValues: ["<any text>"], description: "Fallback if Role ID is absent or unresolved", required: false },
        { column: "Principal ID", validValues: ["<UUID>"], description: "Object ID — required for groups and service principals", required: true },
        { column: "Principal UPN", validValues: ["user@domain.com"], description: "User fallback only — groups/service principals need Principal ID", required: false },
        { column: "Assignment Type", validValues: ASSIGNMENT_TYPE_OPTIONS, required: true },
        { column: "Scope ID", validValues: ["/", "/administrativeUnits/<UUID>"], description: "Default: / (tenant-wide)", required: false },
        { column: "Action", validValues: ["remove"], description: "Must be 'remove'", required: true },
    ],
    groupAssignmentRemovals: [
        { column: "Group ID", validValues: ["<UUID>"], description: "Stable identifier — preferred over name", required: true },
        { column: "Group Name", validValues: ["<any text>"], description: "Fallback if Group ID is absent or unresolved", required: false },
        { column: "Principal ID", validValues: ["<UUID>"], description: "Object ID — required for groups and service principals", required: true },
        { column: "Principal UPN", validValues: ["user@domain.com"], description: "User fallback only — groups/service principals need Principal ID", required: false },
        { column: "Access Type", validValues: ACCESS_TYPE_OPTIONS, required: true },
        { column: "Assignment Type", validValues: ASSIGNMENT_TYPE_OPTIONS, required: true },
        { column: "Action", validValues: ["remove"], description: "Must be 'remove'", required: true },
    ],
};
