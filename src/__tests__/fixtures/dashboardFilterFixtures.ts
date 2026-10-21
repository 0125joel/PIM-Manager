import type { RoleDetailData, PimPolicyRule } from "@/types/directoryRole.types";
import type { GroupPimAssignment, PimGroupData } from "@/types/pimGroup.types";

const target = { caller: "EndUser", operations: ["All"], level: "Assignment" };
const ruleType = (t: string) => `#microsoft.graph.unifiedRoleManagementPolicy${t}Rule`;

export interface PolicyOptions {
    approval?: boolean;
    mfa?: boolean;
    authContext?: string;
    justification?: boolean;
    maxDuration?: string;
    /** undefined: no notification rule; otherwise the rule with these values */
    notification?: { defaults: boolean; recipients: string[] };
}

export function policy(o: PolicyOptions): RoleDetailData["policy"] {
    const rules = [
        { id: "Approval_EndUser_Assignment", "@odata.type": ruleType("Approval"), target, setting: { isApprovalRequired: o.approval === true } },
        { id: "Enablement_EndUser_Assignment", "@odata.type": ruleType("Enablement"), target, enabledRules: [...(o.mfa ? ["MultiFactorAuthentication"] : []), ...(o.justification ? ["Justification"] : [])] },
        { id: "AuthenticationContext_EndUser_Assignment", "@odata.type": ruleType("AuthenticationContext"), target, isEnabled: !!o.authContext, claimValue: o.authContext },
        { id: "Expiration_EndUser_Assignment", "@odata.type": ruleType("Expiration"), target, maximumDuration: o.maxDuration ?? "PT8H" },
        ...(o.notification
            ? [{ id: "Notification_Admin_EndUser_Assignment", "@odata.type": ruleType("Notification"), target, isDefaultRecipientsEnabled: o.notification.defaults, notificationRecipients: o.notification.recipients }]
            : []),
    ] as unknown as PimPolicyRule[];
    return { details: { rules } } as unknown as RoleDetailData["policy"];
}

export const noEnd = { scheduleInfo: { expiration: { type: "noExpiration" } } };
export const endsLater = { scheduleInfo: { expiration: { type: "afterDateTime", endDateTime: "2027-01-01T00:00:00Z" } } };

export const user = (id: string) => ({ id, "@odata.type": "#microsoft.graph.user" });
export const app = (id: string) => ({ id, "@odata.type": "#microsoft.graph.servicePrincipal" });
export const agent = (id: string) => ({ id, "@odata.type": "#microsoft.graph.agentIdentity", servicePrincipalType: "ServiceIdentity", agentIdentityBlueprintId: "25664c89-cea5-4ab6-b924-a54fd8a19ae0" });
export const agentBase = (id: string) => ({ id, "@odata.type": "#microsoft.graph.servicePrincipal", servicePrincipalType: "ServiceIdentity" });
export const agentUser = (id: string) => ({ id, "@odata.type": "#microsoft.graph.agentUser", identityParentId: "00000000-0000-0000-0000-0000000000a1" });
export const blueprint = (id: string) => ({ id, "@odata.type": "#microsoft.graph.agentIdentityBlueprintPrincipal", servicePrincipalType: "Application" });
export const groupPrincipal = (id: string) => ({ id, "@odata.type": "#microsoft.graph.group" });

export interface RoleOptions {
    id: string;
    name?: string;
    templateId?: string;
    isPrivileged?: boolean;
    isBuiltIn?: boolean;
    policy?: RoleDetailData["policy"];
    eligible?: Record<string, unknown>[];
    active?: Record<string, unknown>[];
    permanent?: Record<string, unknown>[];
}

export function role(o: RoleOptions): RoleDetailData {
    return {
        definition: { id: o.id, displayName: o.name ?? o.id, description: "", templateId: o.templateId, isBuiltIn: o.isBuiltIn ?? true, isPrivileged: o.isPrivileged },
        assignments: { permanent: o.permanent ?? [], eligible: o.eligible ?? [], active: o.active ?? [] },
        policy: o.policy ?? null,
    } as unknown as RoleDetailData;
}

export function group(id: string, assignments: Partial<GroupPimAssignment>[], isManaged = true): PimGroupData {
    return {
        group: { id, displayName: id, groupType: "security", isAssignableToRole: true },
        assignments: assignments.map((a, i) => ({ id: `${id}-${i}`, groupId: id, accessType: "member", ...a })) as GroupPimAssignment[],
        isManaged,
    };
}
