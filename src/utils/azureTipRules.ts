/**
 * The tips of the Azure dashboard: tenant tips from the numbers, then general tips. Same shape as `tipRules.ts`.
 * Pure logic, no React, no service.
 */
import type { PimPolicyRule } from "@/types/directoryRole.types";
import type { ArmRoleDefinition, AzureAssignment, AzureScope } from "@/types/azureResource.types";
import type { AzureSettingsOutcome } from "@/utils/azureDashboardStats";
import { azurePolicyKey } from "@/utils/azureScopes";
import { summarizePolicyRules } from "@/utils/policySummary";
import type { Tip } from "@/utils/tipRules";
import type { AzureFilterPatch } from "@/utils/azureDashboardFilterLink";

const OWNER_ROLE_ID = "8e3af657-a8ff-443c-a75c-2fe8c4bcb635";

export interface AzureTipInput {
    /** The assignments the tips describe: the page's scope bar applied, the filter not */
    counted: AzureAssignment[];
    settings: ReadonlyMap<string, AzureSettingsOutcome>;
    scopes: AzureScope[];
    definitions: ReadonlyMap<string, ArmRoleDefinition> | null;
    /** Accounts left out of "permanent Owner assignments" */
    emergencyIds: ReadonlySet<string>;
}

function plural(n: number, one: string, many: string): string {
    return `${n} ${n === 1 ? one : many}`;
}

/** Subscriptions with an Owner assignment of their own whose loaded settings do not require approval */
function ownerWithoutApproval(input: AzureTipInput): number {
    const subscriptions = new Set(input.scopes.filter((s) => s.level === "subscription").map((s) => s.id.toLowerCase()));
    const seen = new Set<string>();
    let count = 0;
    for (const a of input.counted) {
        const scopeKey = a.scopeId.toLowerCase();
        if (a.roleDefinitionId.toLowerCase() !== OWNER_ROLE_ID || !subscriptions.has(scopeKey) || seen.has(scopeKey)) continue;
        seen.add(scopeKey);
        const outcome = input.settings.get(azurePolicyKey(a.scopeId, OWNER_ROLE_ID));
        if (outcome?.status !== "loaded") continue;
        const summary = summarizePolicyRules(outcome.rules as unknown as PimPolicyRule[]);
        if (summary.isLoaded && summary.isApprovalRequired !== true) count += 1;
    }
    return count;
}

/** Permanent Owner assignments of accounts that are not emergency access */
function permanentOwners(input: AzureTipInput): number {
    return input.counted.filter((a) => a.roleDefinitionId.toLowerCase() === OWNER_ROLE_ID && a.state === "active" && a.endDateTime === null && !input.emergencyIds.has(a.principalId.toLowerCase())).length;
}

/** Tenant tips first (only when their number is above 0), then the general tips that always show */
export function buildAzureTips(input: AzureTipInput): Tip<AzureFilterPatch>[] {
    const tips: Tip<AzureFilterPatch>[] = [];

    const noApproval = ownerWithoutApproval(input);
    if (noApproval > 0) {
        tips.push({
            id: "ownerNoApproval",
            source: "tenant",
            title: `Owner activates without approval on ${plural(noApproval, "subscription", "subscriptions")}`,
            text: "Role settings are per role and per scope in Azure: a rule on a management group does not reach the subscriptions below it.",
            // Sets the filter on the page, as an Entra tip does: the chosen scope stays and nothing reloads
            action: { kind: "filter", label: `Show the ${plural(noApproval, "subscription", "subscriptions")}`, filter: { role: OWNER_ROLE_ID, approval: "notRequired", level: "subscription" } },
        });
    }

    const permanent = permanentOwners(input);
    if (permanent > 0) {
        tips.push({
            id: "permanentOwners",
            source: "tenant",
            title: `${plural(permanent, "permanent Owner assignment", "permanent Owner assignments")}`,
            text: "Make them eligible so they need an activation.",
            action: { kind: "filter", label: `Show ${permanent === 1 ? "this assignment" : `these ${permanent} assignments`}`, filter: { status: "active", ends: "permanent", role: OWNER_ROLE_ID, excludeEmergency: true } },
        });
    }

    tips.push(
        {
            id: "general-settings",
            source: "general",
            title: "Settings do not inherit",
            text: "A management group's role settings do not apply to the subscriptions below it. Check them per scope in the Report.",
            action: { kind: "anchor", label: "Open the Report", href: "/azure/report" },
        },
        {
            id: "general-apps",
            source: "general",
            title: "Apps cannot be eligible",
            text: "Apps, managed identities and agents can hold an Azure role only as an active assignment.",
            action: { kind: "link", label: "Read more", href: "https://learn.microsoft.com/en-us/entra/id-governance/privileged-identity-management/pim-resource-roles-assign-roles" },
        },
    );
    return tips;
}
