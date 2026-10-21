export interface RoleDefinition {
    id: string;
    displayName: string;
    description?: string;
    isBuiltIn: boolean;
    isPrivileged?: boolean;
    assignmentCount?: number;
}

/**
 * PIM Custom Extensions (Preview): the two callout slots a policy exposes on
 * activation, each backed by a unifiedRoleManagementPolicyCustomExtensionRule.
 */
export type CustomExtensionSlot = "preApproval" | "postApproval";

export interface CustomExtensionLink {
    /** Whether PIM actually calls the extension; a slot can be linked but disabled */
    isEnabled: boolean;
    /** Id of the roleManagementCustomCalloutExtension, empty string when unlinked */
    customExtensionId: string;
    /** Denormalized by Graph from the extension object, read-only on writes */
    displayName?: string;
    /** Attribute names shown as free-text inputs in the activation dialog */
    customAttributes: string[];
}

/**
 * A slot left undefined is not managed by the write: the rule is left as it is.
 * A link with an empty customExtensionId is an explicit unlink.
 */
export interface CustomExtensionSlots {
    preApproval?: CustomExtensionLink;
    postApproval?: CustomExtensionLink;
}

export interface Principal {
    id: string;
    displayName?: string; // Optional - may not always be resolved
    userPrincipalName?: string; // For users
    groupTypes?: string[]; // For groups
    mail?: string; // Email address
    type: "user" | "group" | "manager"; // manager = requestor's manager (PIM approval)
}

export interface RoleAssignment {
    id: string;
    roleDefinitionId: string;
    principalId: string;
    principalType: "User" | "Group";
    principalDisplayName: string;
    assignmentType: "Eligible" | "Active";
    startDateTime?: string;
    endDateTime?: string;
    memberType: "Direct" | "Group";
}

export interface AuthenticationContext {
    id: string;
    displayName: string;
    description?: string;
    isAvailable: boolean;
}

/**
 * What kind of directory object a principal is (`utils/principalUtils.ts`). The three agent kinds follow the Graph type
 * names of Microsoft Entra Agent ID: an agent identity, an agent's user account and an agent identity blueprint principal.
 */
export type PrincipalKind = "user" | "group" | "servicePrincipal" | "agentIdentity" | "agentUser" | "agentIdentityBlueprintPrincipal" | "unknown";
