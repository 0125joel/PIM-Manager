import type { ArmRoleDefinition, AzureAssignment, AzureScope } from "@/types/azureResource.types";
import { azurePolicyKey, isDelegatedScope, isRootScope } from "@/utils/azureScopes";
import { isPrivilegedRole } from "@/utils/azureDashboard";

export type SubscriptionReadability = "all" | "partly" | "failed";

export interface AzureReadability {
    /** `unread`: the resource groups and resources below it not read yet (Read the rest); `isUnlisted`: not even listed yet */
    subscriptions: { id: string; name: string; status: SubscriptionReadability; isDelegated: boolean; unread: number; isUnlisted: boolean }[];
    whole: number;
    partial: number;
    failed: number;
    /** Resource groups and resources the read budget did not reach yet, over the subscriptions in `subscriptions` */
    unread: number;
    /** Subscriptions whose resource groups and resources the read budget did not list yet */
    unlisted: number;
    /** Privileged role × scope whose settings cannot be read (the root always, and every pair Graph refused) */
    notReadableSettings: { key: string; roleName: string; scopeName: string }[];
}

/** What the signed-in account can read (calm details spec 2.7): per subscription, and the role settings it cannot read */
export function buildAzureReadability(input: {
    scopes: readonly AzureScope[];
    assignments: readonly AzureAssignment[];
    definitions: ReadonlyMap<string, ArmRoleDefinition> | null;
    /** The role settings the page has read, by `azurePolicyKey`; the dashboard and the Report keep different outcome types, both with `status` */
    settings: ReadonlyMap<string, { status: string }>;
    homeTenantId: string | undefined;
    includeDelegated: boolean;
}): AzureReadability {
    const subscriptions = input.scopes
        .filter((s) => s.level === "subscription")
        .map((s) => ({ id: s.id, name: s.name, isDelegated: isDelegatedScope(s, input.homeTenantId), status: (s.access === "failed" ? "failed" : s.access === undefined ? "all" : "partly") as SubscriptionReadability, unread: s.unreadScopeIds?.length ?? 0, isUnlisted: s.isUnlisted === true }))
        .filter((s) => input.includeDelegated || !s.isDelegated);
    const nameOf = (scopeId: string) => input.scopes.find((s) => s.id.toLowerCase() === scopeId.toLowerCase())?.name ?? (isRootScope(scopeId) ? "Root" : scopeId);
    const seen = new Map<string, { key: string; roleName: string; scopeName: string }>();
    for (const a of input.assignments) {
        if (!isPrivilegedRole(a.roleDefinitionId, input.definitions)) continue;
        const key = azurePolicyKey(a.scopeId, a.roleDefinitionId);
        if (seen.has(key)) continue;
        if (isRootScope(a.scopeId) || input.settings.get(key)?.status === "noAccess") seen.set(key, { key, roleName: a.roleName, scopeName: nameOf(a.scopeId) });
    }
    return {
        subscriptions,
        whole: subscriptions.filter((s) => s.status === "all").length,
        partial: subscriptions.filter((s) => s.status === "partly").length,
        failed: subscriptions.filter((s) => s.status === "failed").length,
        unread: subscriptions.reduce((sum, s) => sum + s.unread, 0),
        unlisted: subscriptions.filter((s) => s.isUnlisted).length,
        notReadableSettings: [...seen.values()],
    };
}

/** The sentence under the scope bar (calm details spec 2.7); `second` is null when everything in view is readable */
export function readabilitySentence(r: AzureReadability): { first: string; second: string | null; hasDetails: boolean } {
    const total = r.subscriptions.length;
    const noun = total === 1 ? "subscription" : "subscriptions";
    const first = `You can read ${r.whole} of ${total} ${noun} completely${r.partial > 0 ? `, and ${r.partial} in part` : ""}.${r.failed > 0 ? ` ${r.failed} could not be read.` : ""}`;
    const parts = [r.partial > 0 ? "some resource groups" : null, r.notReadableSettings.length > 0 ? `the settings of ${r.notReadableSettings.length} privileged role × scope` : null].filter((p): p is string => p !== null);
    const second = parts.length > 0 ? `Not everything below is readable for you: ${parts.join(", and ")}.` : null;
    return { first, second, hasDetails: second !== null || r.failed > 0 };
}

/**
 * What the read budget did not reach yet, for the sentence and Read the rest; null when everything readable was read.
 * Never counted as read: these subscriptions are `partly` (or failed) until a round reads the rest.
 */
export function unreadSentence(r: Pick<AzureReadability, "unread" | "unlisted">): string | null {
    const many = (n: number) => (n === 1 ? "1 more subscription" : `${n} more subscriptions`);
    const scopes = r.unread === 1 ? "1 resource group or resource is not read yet" : `${r.unread} resource groups and resources are not read yet`;
    if (r.unread > 0 && r.unlisted > 0) return `${scopes}, and those of ${many(r.unlisted)}.`;
    if (r.unread > 0) return `${scopes}.`;
    if (r.unlisted > 0) return `The resource groups and resources of ${r.unlisted === 1 ? "1 subscription are" : `${r.unlisted} subscriptions are`} not read yet.`;
    return null;
}

/** The note of one subscription in What you can read, for one read in part */
export function partlyNote(s: Pick<AzureReadability["subscriptions"][number], "unread" | "isUnlisted">): string {
    const base = "Only the resource groups and resources you can read are counted";
    if (s.unread > 0) return `${base}; ${s.unread} ${s.unread === 1 ? "is" : "are"} not read yet.`;
    if (s.isUnlisted) return `${base}; they are not read yet.`;
    return `${base}.`;
}
