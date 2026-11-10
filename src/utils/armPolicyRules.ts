/**
 * Role settings of Azure resources, read into the one policy model of the app (`PolicySettings`).
 *
 * ARM's rules have the same ids and fields as Graph's (facts.md section 3); two things differ. The rule type is in
 * `ruleType` (`RoleManagementPolicyExpirationRule`) instead of `@odata.type`, and an approver is `{ id, description,
 * userType }` instead of a `singleUser` or `groupMembers` entry. The rules are rewritten into the Graph shape and read
 * by `parseGraphPolicy`, so Entra and Azure settings read the same way.
 */
import type { PolicySettings } from "@/types/wizard.types";
import type { ArmPolicyRule, ArmRoleManagementPolicy } from "@/types/azureResource.types";
import { parseGraphPolicy } from "./policyParser";

const ARM_RULE_PREFIX = "RoleManagementPolicy";
const GRAPH_RULE_PREFIX = "#microsoft.graph.unifiedRoleManagementPolicy";

interface ArmApprover {
    id?: string;
    description?: string;
    userType?: string;
}

function toGraphApprover(approver: ArmApprover): Record<string, unknown> {
    const isGroup = approver.userType === "Group";
    return {
        "@odata.type": isGroup ? "#microsoft.graph.groupMembers" : "#microsoft.graph.singleUser",
        ...(isGroup ? { groupId: approver.id } : { userId: approver.id }),
        description: approver.description,
    };
}

/** `RoleManagementPolicyExpirationRule` becomes `#microsoft.graph.unifiedRoleManagementPolicyExpirationRule` */
function graphRuleType(ruleType: string): string {
    const name = ruleType.startsWith(ARM_RULE_PREFIX) ? ruleType.slice(ARM_RULE_PREFIX.length) : ruleType;
    return `${GRAPH_RULE_PREFIX}${name}`;
}

/** One ARM rule in the Graph shape `parseGraphPolicy` reads */
export function toGraphRule(rule: ArmPolicyRule): Record<string, unknown> {
    const graph: Record<string, unknown> = { ...rule, "@odata.type": graphRuleType(rule.ruleType) };
    const setting = rule.setting as { approvalStages?: Array<{ primaryApprovers?: ArmApprover[] }> } | undefined;
    if (setting?.approvalStages) {
        graph.setting = {
            ...setting,
            approvalStages: setting.approvalStages.map((stage) => ({
                ...stage,
                primaryApprovers: (stage.primaryApprovers ?? []).map(toGraphApprover),
            })),
        };
    }
    return graph;
}

/**
 * The rules that apply: `effectiveRules`, which ARM calls the computed rule applied to the policy, or `rules` when that
 * is empty or missing (Azure spec 6).
 */
export function rulesInForce(policy: ArmRoleManagementPolicy): ArmPolicyRule[] {
    const effective = policy.properties.effectiveRules;
    return effective && effective.length > 0 ? effective : policy.properties.rules ?? [];
}

/** The rules that apply in the Graph shape, for `buildPolicyView` and the Entra role configuration tabs */
export function graphRulesOf(policy: ArmRoleManagementPolicy): Record<string, unknown>[] {
    return rulesInForce(policy).map(toGraphRule);
}

/** A role's settings at one scope, from the rules that apply */
export function parseArmPolicy(policy: ArmRoleManagementPolicy): PolicySettings {
    return parseGraphPolicy({ rules: graphRulesOf(policy) });
}
