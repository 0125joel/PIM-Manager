import { Logger } from "@/utils/logger";
import { withRetry } from "@/utils/retryUtils";
import { Client } from "@microsoft/microsoft-graph-client";
import { GRAPH_LOCALE, PIM_URLS } from "@/config/constants";
import { PolicySettings } from "@/types/wizard.types";
import { getErrorCode, getErrorMessage } from "@/utils/errorUtils";
import { parseGraphPolicy } from "@/utils/policyParser";
import { buildRuleUpdates, settingsToChanges, type GraphRule } from "@/utils/policyRules";

/**
 * PIM Configuration Service
 * Reads and writes PIM policies (role configuration) of directory roles through Microsoft Graph. What a write sends is
 * decided by the one mapper in `utils/policyRules.ts`, shared with PIM for Groups (NG-54).
 */

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** A policy rule as Graph returns it (roles carry a `target`; group rules come without one) */
export interface PimRule extends GraphRule {
    "@odata.type": string;
    target?: {
        caller: string;
        level: string;
        operations: string[];
        inheritableSettings?: string[];
        enforcedSettings?: string[];
    };
}

/**
 * The effective PIM policy of a directory role: the policy id, its raw rules and the settings read from them.
 * v1.0, the tenant-wide assignment filtered on the role (`scopeId` "/", `scopeType` Directory).
 */
export async function getRolePolicy(client: Client, roleId: string): Promise<{ settings: PolicySettings, policyId: string, rules: PimRule[] } | null> {
    try {
        const assignments = await withRetry(() =>
            client.api(PIM_URLS.roleManagementPolicyAssignments)
                .version("v1.0")
                .header("Accept-Language", GRAPH_LOCALE)
                .filter(`scopeId eq '/' and scopeType eq 'Directory' and roleDefinitionId eq '${roleId}'`)
                .expand("policy($expand=rules)")
                .get()
        );

        const policy = assignments.value?.[0]?.policy;
        if (!policy) {
            Logger.warn("pimConfiguration", `No policy found for role ${roleId}`);
            return null;
        }
        const rules: PimRule[] = policy.rules || [];
        return { settings: parseGraphPolicy({ rules }), policyId: policy.id, rules };
    } catch (error) {
        Logger.error("pimConfiguration", `Failed to fetch policy for role ${roleId}`, error);
        return null;
    }
}

/**
 * Writes a role's policy so it matches `edited`, a full settings object from a Configure screen. The current rules are
 * read first; only fields that differ from them become changes (`settingsToChanges`), and only the rules those touch
 * are PATCHed (`buildRuleUpdates`, in the MfaAndAcrsConflict order), one by one on v1.0:
 * PATCH /policies/roleManagementPolicies/{policyId}/rules/{ruleId}
 *
 * Returns the ids of the rules written. Throws `PolicyRuleUpdateError` when any PATCH failed (the others still run).
 */
export async function updatePimPolicy(client: Client, roleId: string, edited: PolicySettings): Promise<string[]> {
    const currentData = await getRolePolicy(client, roleId);
    if (!currentData) throw new Error(`Could not fetch current policy for role ${roleId}`);

    const { policyId, rules, settings } = currentData;
    const updates = buildRuleUpdates("directoryRoles", rules, settingsToChanges(settings, edited));
    if (updates.length === 0) {
        Logger.debug("pimConfiguration", `[updatePimPolicy] No changes needed for policy ${policyId}`);
        return [];
    }

    Logger.info("pimConfiguration", `[updatePimPolicy] Updating ${updates.length} rules for policy ${policyId}`);
    const ruleFailures: Array<{ ruleId: string; error: unknown }> = [];

    for (const update of updates) {
        try {
            await withRetry(
                () => client.api(`${PIM_URLS.roleManagementPolicies}/${policyId}/rules/${update.ruleId}`)
                    .version("v1.0")
                    .header("Accept-Language", GRAPH_LOCALE)
                    .patch(update.body),
                3,
                1000,
                `updatePolicyRule_${update.ruleId}`
            );
            await delay(300);
        } catch (patchError: unknown) {
            Logger.error("pimConfiguration", `[updatePimPolicy] PATCH failed for rule ${update.ruleId}: ${getErrorCode(patchError) || "unknown"} ${getErrorMessage(patchError)}`);
            ruleFailures.push({ ruleId: update.ruleId, error: patchError });
        }
    }

    if (ruleFailures.length > 0) {
        const err = new PolicyRuleUpdateError(
            `Failed to update ${ruleFailures.length} of ${updates.length} policy rules for role ${roleId}`,
            ruleFailures
        );
        Logger.error("pimConfiguration", err.message);
        throw err;
    }

    return updates.map((u) => u.ruleId);
}

/**
 * Thrown by `updatePimPolicy` when one or more individual rule PATCHes failed.
 * The original errors are preserved per rule so callers can surface "which
 * setting Microsoft rejected" instead of a single opaque message.
 */
export class PolicyRuleUpdateError extends Error {
    readonly ruleFailures: Array<{ ruleId: string; error: unknown }>;
    constructor(message: string, ruleFailures: Array<{ ruleId: string; error: unknown }>) {
        super(message);
        this.name = "PolicyRuleUpdateError";
        this.ruleFailures = ruleFailures;
    }
}
