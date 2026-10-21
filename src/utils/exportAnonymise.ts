import type { RoleDetailData } from "@/types/directoryRole.types";
import type { PimGroupData } from "@/types/pimGroup.types";
import { getPrincipalKind, isAgentKind } from "@/utils/principalUtils";

interface PrincipalLike {
    id: string;
    displayName?: string;
    userPrincipalName?: string;
    mail?: string;
    servicePrincipalType?: string | null;
    "@odata.type": string;
}

export interface Anonymised {
    roles: RoleDetailData[];
    groups: PimGroupData[];
    /** Lower case object ids whose name and UPN were replaced */
    ids: Set<string>;
}

/**
 * Replaces the name, UPN and mail of every user (and unknown kind of) principal by "Person n", the same label for the
 * same person everywhere. Groups, apps and agents keep their names: they are not personal data. Returns copies, never edits the input.
 */
export function anonymisePeople(roles: RoleDetailData[], groups: PimGroupData[]): Anonymised {
    const labels = new Map<string, string>();
    const ids = new Set<string>();

    const swap = <T extends { principal?: PrincipalLike }>(item: T): T => {
        const principal = item.principal;
        const kind = getPrincipalKind(principal);
        if (!principal || kind === "group" || kind === "servicePrincipal" || isAgentKind(kind)) return item;
        return { ...item, principal: { ...principal, displayName: labelFor(principal.id.toLowerCase()), userPrincipalName: undefined, mail: undefined } };
    };

    const labelFor = (id: string): string => {
        let label = labels.get(id);
        if (!label) {
            label = `Person ${labels.size + 1}`;
            labels.set(id, label);
        }
        ids.add(id);
        return label;
    };

    // The rule of an approval names a user approver in its description too: the same label as everywhere else
    const scrubRules = <R,>(rules: R[] | undefined): R[] | undefined => rules?.map((rule) => {
        // Extra notification recipients are mail addresses of people
        const recipients = (rule as { notificationRecipients?: unknown }).notificationRecipients;
        if (Array.isArray(recipients) && recipients.length > 0) {
            return { ...rule, notificationRecipients: recipients.map((r) => (typeof r === "string" ? labelFor(r.toLowerCase()) : r)) } as R;
        }
        const stages = (rule as { setting?: { approvalStages?: Array<{ primaryApprovers?: Array<Record<string, unknown>> }> } }).setting?.approvalStages;
        if (!stages) return rule;
        const scrubbed = stages.map((stage) => ({
            ...stage,
            primaryApprovers: stage.primaryApprovers?.map((a) => (typeof a.userId === "string" && a.userId ? { ...a, description: labelFor(a.userId.toLowerCase()) } : a)),
        }));
        return { ...rule, setting: { ...(rule as { setting: object }).setting, approvalStages: scrubbed } } as R;
    });
    const swapApprovers = <A extends { id: string; type?: string }>(approvers: A[] | undefined): A[] | undefined =>
        approvers?.map((a) => (a.type === "user" ? { ...a, displayName: labelFor(a.id.toLowerCase()), userPrincipalName: undefined, mail: undefined } : a));

    const anonymisedRoles = roles.map((role) => ({
        ...role,
        // Approvers named in the policy are people too
        policy: role.policy ? { ...role.policy, approvers: swapApprovers(role.policy.approvers) ?? [], details: role.policy.details ? { ...role.policy.details, rules: scrubRules(role.policy.details.rules) } : role.policy.details } : role.policy,
        assignments: {
            permanent: role.assignments.permanent.map(swap),
            eligible: role.assignments.eligible.map(swap),
            active: role.assignments.active.map(swap),
        },
    }));
    const scrubPolicy = <P extends { rules: unknown[]; approvers?: Array<{ id: string; type?: string }> }>(policy: P | undefined): P | undefined =>
        policy ? { ...policy, rules: scrubRules(policy.rules) ?? policy.rules, approvers: swapApprovers(policy.approvers) } : policy;
    const anonymisedGroups = groups.map((g) => ({
        ...g,
        assignments: g.assignments.map(swap),
        policies: g.policies ? { member: scrubPolicy(g.policies.member), owner: scrubPolicy(g.policies.owner) } : g.policies,
    }));
    return { roles: anonymisedRoles, groups: anonymisedGroups, ids };
}
