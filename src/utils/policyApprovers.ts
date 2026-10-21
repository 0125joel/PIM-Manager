/**
 * Which approvers an approval rule names, as one comparable key. A refresh reads every policy again; when the key of
 * the new rules equals the key of the loaded ones, the resolved approver names are kept and no lookup is made.
 */

interface ApproverLike {
    "@odata.type"?: string;
    id?: string;
    userId?: string;
    groupId?: string;
    description?: string;
}

interface RuleLike {
    "@odata.type"?: string;
    setting?: { approvalStages?: Array<{ primaryApprovers?: ApproverLike[] }> };
}

/** The primary approvers of every approval stage, sorted, so the order Graph returns them in does not matter. "" when none. */
export function getApproverKey(rules: readonly RuleLike[] | undefined): string {
    if (!rules) return "";
    const keys: string[] = [];
    for (const rule of rules) {
        if (!rule["@odata.type"]?.includes("ApprovalRule")) continue;
        for (const stage of rule.setting?.approvalStages ?? []) {
            for (const approver of stage.primaryApprovers ?? []) {
                const id = approver.userId ?? approver.groupId ?? approver.id ?? approver.description ?? "";
                keys.push(`${approver["@odata.type"] ?? ""}:${id.toLowerCase()}`);
            }
        }
    }
    return keys.sort().join("|");
}

/** True when the loaded approver names still belong to the new rules: same approvers, and the names were resolved (or there are none). */
export function canKeepApprovers(
    previous: { rules: readonly RuleLike[] | undefined; approvers: readonly unknown[] | undefined } | undefined,
    nextRules: readonly RuleLike[] | undefined
): boolean {
    if (!previous || previous.approvers === undefined) return false;
    const key = getApproverKey(nextRules);
    if (key !== getApproverKey(previous.rules)) return false;
    return key === "" || previous.approvers.length > 0;
}
