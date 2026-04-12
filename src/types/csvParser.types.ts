/**
 * CSV Parser Types
 *
 * Shared type definitions for bulk CSV import/export.
 * These were previously co-located with csvParserService.ts.
 */

// Parsed row from Role Policies CSV
export interface ParsedRolePolicyRow {
    roleId: string; // empty string when not present (backward compat)
    roleName: string;
    description: string;
    isBuiltIn: boolean;
    isPrivileged: boolean;
    isPimConfigured: boolean;
    maxActivationDuration: string; // ISO 8601 duration (e.g., "PT8H")
    mfaRequired: boolean;
    justificationRequired: boolean;
    approvalRequired: boolean;
    approvers: string;
    authContext: string;
    permanentCount: number;
    eligibleCount: number;
    activeCount: number;
    totalAssignments: number;
    // Row metadata
    rowNumber: number;
    originalRow: string[];
}

// Parsed row from Role Assignments CSV
export interface ParsedRoleAssignmentRow {
    roleId: string;       // UUID — empty if not provided
    roleName: string;
    principalId: string;  // UUID — empty if only UPN provided
    principalUPN: string; // UPN/email — fallback lookup key
    assignmentType: "eligible" | "active";
    durationDays: string; // integer string, "permanent", or "" (policy default)
    justification: string;
    action: "add" | "remove"; // "add" by default; "remove" to delete an existing assignment
    rowNumber: number;
    originalRow: string[];
}

// Parsed row from Group Assignments CSV
export interface ParsedGroupAssignmentRow {
    groupId: string;
    groupName: string;
    principalId: string;
    principalUPN: string;
    accessType: "member" | "owner";
    assignmentType: "eligible" | "active";
    durationDays: string;
    justification: string;
    action: "add" | "remove"; // "add" by default; "remove" to delete an existing assignment
    rowNumber: number;
    originalRow: string[];
}

// Parsed row from Group Policies CSV
export interface ParsedGroupPolicyRow {
    groupId: string; // empty string when not present (backward compat)
    groupName: string;
    groupType: string;
    roleAssignable: boolean;
    eligibleMembers: number;
    eligibleOwners: number;
    activeMembers: number;
    activeOwners: number;
    memberMaxDuration: string;
    memberMfa: boolean;
    memberApproval: boolean;
    ownerMaxDuration: string;
    ownerMfa: boolean;
    ownerApproval: boolean;
    // Row metadata
    rowNumber: number;
    originalRow: string[];
}

// Parsed row from Role Assignment Removals CSV
export interface ParsedRoleAssignmentRemovalRow {
    roleId: string;
    roleName: string;
    principalId: string;
    principalUPN: string;
    assignmentType: "eligible" | "active";
    scopeId: string; // default "/"
    rowNumber: number;
    originalRow: string[];
}

// Parsed row from Group Assignment Removals CSV
export interface ParsedGroupAssignmentRemovalRow {
    groupId: string;
    groupName: string;
    principalId: string;
    principalUPN: string;
    accessType: "member" | "owner";
    assignmentType: "eligible" | "active";
    rowNumber: number;
    originalRow: string[];
}

// Validation error
export interface ValidationError {
    rowNumber: number;
    field: string;
    message: string;
    severity: "error" | "warning";
}

// Parse result
export interface ParseResult<T> {
    success: boolean;
    rows: T[];
    errors: ValidationError[];
    warnings: ValidationError[];
    csvType: "rolePolicies" | "groupPolicies" | "roleAssignments" | "groupAssignments" | "roleAssignmentRemovals" | "groupAssignmentRemovals" | "unknown";
}

// Union of all parsed row types
export type AnyParsedRow =
    | ParsedRolePolicyRow
    | ParsedGroupPolicyRow
    | ParsedRoleAssignmentRow
    | ParsedGroupAssignmentRow
    | ParsedRoleAssignmentRemovalRow
    | ParsedGroupAssignmentRemovalRow;
