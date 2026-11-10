/**
 * Azure scope tree and assignment rows, built from the ARM schedule instances.
 *
 * Management group nesting is not in the instance lists: an instance names the management groups above a subscription,
 * but not how they nest. Pass 2 of `buildScopeTree` places them: the Tenant Root Group is the management group whose id
 * ends in the subscription's tenant id, and the other groups hang under the only one or under the Tenant Root Group.
 * When `getEntities` answered (`entities`), its parents replace that guess where the parent is in the tree, and a
 * management group without items that lies between two scopes of the tree is added so the chain is not broken.
 */
import type { ArmEntity, ArmRoleScheduleInstance, ArmSubscription, AzureAssignment, AzureScope, AzureScopeLevel } from "@/types/azureResource.types";

const LEVEL_ORDER: Record<AzureScopeLevel, number> = { root: 0, managementGroup: 1, subscription: 2, resourceGroup: 3, resource: 4 };

/** The level of an ARM scope id, or `null` when the id is not a scope the tree shows */
export function levelFromScopeId(id: string): AzureScopeLevel | null {
    const segs = id.split("/").filter((s) => s !== "");
    const is = (i: number, word: string) => segs[i] !== undefined && segs[i].toLowerCase() === word.toLowerCase();

    if (isRootScope(id)) return "root";
    if (segs.length === 4 && is(0, "providers") && is(1, "Microsoft.Management") && is(2, "managementGroups")) return "managementGroup";
    if (segs.length === 2 && is(0, "subscriptions")) return "subscription";
    if (segs.length === 4 && is(0, "subscriptions") && is(2, "resourceGroups")) return "resourceGroup";
    if (segs.length >= 8 && segs.length % 2 === 0 && is(0, "subscriptions") && is(2, "resourceGroups") && is(4, "providers")) return "resource";
    return null;
}

/** The key of one role at one scope in the policy cache and the export: both ids lowercase (ARM ids are case-insensitive) */
export function azurePolicyKey(scopeId: string, roleDefinitionId: string): string {
    return `${scopeId.toLowerCase()}|${roleDefinitionId.toLowerCase()}`;
}

/** True for the root scope `/`: its role settings are not read (ARM answers 400 InvalidResource, measured) */
export function isRootScope(scopeId: string): boolean {
    return scopeId === "/";
}

/** The subscription id of a subscription path, for example `/subscriptions/s1` */
function subscriptionKey(segs: string[]): string {
    return "/" + segs.slice(0, 2).join("/");
}

/** Builds the flat scope list; the tree is in `parentId`. `instancesBySubscription` is keyed by `subscriptionId` */
export function buildScopeTree(subscriptions: ArmSubscription[], instancesBySubscription: Record<string, ArmRoleScheduleInstance[]>, entities?: ArmEntity[]): AzureScope[] {
    const scopes = new Map<string, AzureScope>();
    const addIfAbsent = (scope: AzureScope) => {
        const key = scope.id.toLowerCase();
        if (!scopes.has(key)) scopes.set(key, scope);
    };
    const subsByPath = new Map<string, ArmSubscription>();
    for (const sub of subscriptions) subsByPath.set(sub.id.toLowerCase(), sub);

    // The management groups of each subscription, in the order seen, no duplicates
    const mgsBySubscription = new Map<string, string[]>();

    // Pass 1, collect
    for (const sub of subscriptions) {
        addIfAbsent({ id: sub.id, name: sub.displayName, level: "subscription", parentId: null, tenantId: sub.tenantId });
    }
    for (const sub of subscriptions) {
        const mgs: string[] = [];
        mgsBySubscription.set(sub.subscriptionId, mgs);
        for (const item of instancesBySubscription[sub.subscriptionId] ?? []) {
            const scope = item.properties.scope;
            const segs = scope.split("/").filter((s) => s !== "");
            const shown = item.properties.expandedProperties?.scope?.displayName;
            const level = levelFromScopeId(scope);

            if (level === "root") {
                addIfAbsent({ id: "/", name: shown ?? "Root", level: "root", parentId: null });
            } else if (level === "managementGroup") {
                addIfAbsent({ id: scope, name: shown ?? segs[3], level: "managementGroup", parentId: null });
                const stored = scopes.get(scope.toLowerCase())!.id;
                if (!mgs.includes(stored)) mgs.push(stored);
            } else if (level === "resourceGroup") {
                const parent = subsByPath.get(subscriptionKey(segs).toLowerCase());
                if (!parent) continue;
                addIfAbsent({ id: scope, name: segs[3], level: "resourceGroup", parentId: parent.id });
            } else if (level === "resource") {
                const parent = subsByPath.get(subscriptionKey(segs).toLowerCase());
                if (!parent) continue;
                const rgId = "/" + segs.slice(0, 4).join("/");
                if (!scopes.has(rgId.toLowerCase())) {
                    addIfAbsent({ id: rgId, name: segs[3], level: "resourceGroup", parentId: parent.id });
                }
                const rg = scopes.get(rgId.toLowerCase());
                let resourceType = `${segs[5]}/${segs[6]}`;
                for (let i = 8; i < segs.length; i += 2) resourceType += `/${segs[i]}`;
                addIfAbsent({ id: scope, name: segs[segs.length - 1], level: "resource", parentId: rg!.id, resourceType });
            }
            // level "subscription" and null: nothing to add
        }
    }

    // Pass 1b, management groups between two scopes of the tree that have no item of their own (only with `getEntities`)
    const entitiesById = new Map<string, ArmEntity>();
    for (const entity of entities ?? []) entitiesById.set(entity.id.toLowerCase(), entity);
    const parentKeyOf = (key: string): string | null => entitiesById.get(key)?.properties.parent?.id?.toLowerCase() ?? null;
    if (entitiesById.size > 0) {
        for (const start of [...scopes.values()]) {
            if (start.level !== "subscription" && start.level !== "managementGroup") continue;
            const chain: ArmEntity[] = [];
            const seen = new Set<string>([start.id.toLowerCase()]);
            for (let key = parentKeyOf(start.id.toLowerCase()); key !== null && !seen.has(key) && !scopes.has(key); key = parentKeyOf(key)) {
                seen.add(key);
                const entity = entitiesById.get(key);
                if (!entity || levelFromScopeId(entity.id) !== "managementGroup") break;
                chain.push(entity);
            }
            // The Tenant Root Group alone is no chain: it joins the tree only with an intermediate group below it
            if (chain.length === 1 && parentKeyOf(chain[0].id.toLowerCase()) === null) continue;
            for (const entity of chain) {
                addIfAbsent({ id: entity.id, name: entity.properties.displayName ?? entity.name, level: "managementGroup", parentId: null });
            }
        }
    }

    // Pass 2, parents above the subscriptions
    const rootInMap = scopes.has("/");
    const isTenantRoot = (mgId: string, tenantId: string) => (mgId.split("/").pop() ?? "").toLowerCase() === tenantId.toLowerCase();
    // The home tenant: the tenant of the subscriptions that have the Tenant Root Group above them. A subscription of
    // another tenant (Azure Lighthouse) is not placed under the home tenant's root; it is a tree of its own
    const homeTenantIds = new Set<string>();
    for (const sub of subscriptions) {
        const mgIds = mgsBySubscription.get(sub.subscriptionId) ?? [];
        if (mgIds.some((id) => isTenantRoot(id, sub.tenantId))) homeTenantIds.add(sub.tenantId.toLowerCase());
    }
    for (const sub of subscriptions) {
        const mgIds = mgsBySubscription.get(sub.subscriptionId) ?? [];
        const tenantRootId = mgIds.find((id) => isTenantRoot(id, sub.tenantId));
        const others = mgIds.filter((id) => id !== tenantRootId);
        const subScope = scopes.get(sub.id.toLowerCase())!;

        if (others.length === 1) subScope.parentId = others[0];
        else if (tenantRootId !== undefined) subScope.parentId = tenantRootId;
        else if (rootInMap && !(homeTenantIds.size > 0 && !homeTenantIds.has(sub.tenantId.toLowerCase()))) subScope.parentId = "/";
        else subScope.parentId = null;

        if (tenantRootId !== undefined) {
            const tenantRoot = scopes.get(tenantRootId.toLowerCase())!;
            tenantRoot.parentId = rootInMap ? "/" : null;
            for (const id of others) {
                const mg = scopes.get(id.toLowerCase())!;
                if (mg.parentId === null) mg.parentId = tenantRoot.id;
            }
        }
    }
    for (const scope of scopes.values()) {
        if (scope.level === "managementGroup" && scope.parentId === null && rootInMap) scope.parentId = "/";
    }

    // Pass 2b, the parents `getEntities` gave, where the parent is in the tree
    for (const scope of scopes.values()) {
        if (scope.level !== "subscription" && scope.level !== "managementGroup") continue;
        const parentKey = parentKeyOf(scope.id.toLowerCase());
        const parent = parentKey === null || parentKey === scope.id.toLowerCase() ? undefined : scopes.get(parentKey);
        if (parent && parent.level === "managementGroup") scope.parentId = parent.id;
    }

    // Pass 3, order
    return [...scopes.values()].sort(compareScopes);
}

/** The order of the scope list: by level, then name, then id (`buildScopeTree`, and a list that scopes are merged into) */
export function compareScopes(a: AzureScope, b: AzureScope): number {
    const byLevel = LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level];
    if (byLevel !== 0) return byLevel;
    const byName = a.name.localeCompare(b.name, "en");
    if (byName !== 0) return byName;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** One ARM schedule instance as a Report row */
/** The sign-in name, else the e-mail address, of an expanded principal */
function upnOf(principal: { email?: string; userPrincipalName?: string } | undefined): string | undefined {
    const value = principal?.userPrincipalName || principal?.email;
    return value ? value : undefined;
}

export function toAssignment(instance: ArmRoleScheduleInstance): AzureAssignment {
    const p = instance.properties;
    const roleGuid = p.roleDefinitionId.split("/").pop() ?? p.roleDefinitionId;
    // An eligibility schedule or an eligibility instance; the active list is the only other
    const isEligible = /\/roleeligibilityschedule(instance)?s$/.test(instance.type.toLowerCase());
    return {
        id: instance.id,
        scopeId: p.scope,
        principalId: p.principalId,
        principalName: p.expandedProperties?.principal?.displayName ?? p.principalId,
        principalType: p.principalType,
        roleDefinitionId: roleGuid,
        roleName: p.expandedProperties?.roleDefinition?.displayName ?? roleGuid,
        state: isEligible ? "eligible" : "active",
        memberType: p.memberType === "Inherited" ? "inherited" : "direct",
        ...(p.startDateTime ? { startDateTime: p.startDateTime } : {}),
        endDateTime: p.endDateTime ?? null,
        ...(p.memberType === "Group" ? { isViaGroup: true as const } : {}),
        ...(upnOf(p.expandedProperties?.principal) ? { principalUpn: upnOf(p.expandedProperties?.principal) } : {}),
        // Only the active list has `assignmentType` (Learn: Activated or Assigned); the key is absent unless activated
        ...(!isEligible && p.assignmentType?.toLowerCase() === "activated" ? { isActivated: true as const } : {}),
        ...(p.expandedProperties?.roleDefinition?.type?.toLowerCase() === "customrole" ? { isCustomRole: true as const } : {}),
    };
}

/**
 * An eligibility schedule that holds now: started (or no start given) and not ended. The schedule list also returns
 * future-dated items, the instance list does not (Learn, privileged-role-eligibility-rest-sample).
 */
export function isCurrentSchedule(item: ArmRoleScheduleInstance, now: number): boolean {
    const { startDateTime, endDateTime } = item.properties;
    if (startDateTime && Date.parse(startDateTime) > now) return false;
    return !endDateTime || Date.parse(endDateTime) > now;
}

/**
 * The scopes to read below a subscription the user cannot list as a whole (Azure spec 15.5): every resource group the
 * user can read, and every resource whose resource group is not one of them. A list at a scope also returns what is
 * below it, so nothing under a returned scope is read twice. Ids as ARM gave them: the groups in input order, then the
 * resources, shortest id first so a parent resource comes before its children.
 */
export function topReadableScopes(resourceGroups: ReadonlyArray<{ id: string }>, resources: ReadonlyArray<{ id: string }>): string[] {
    const groups = resourceGroups.map((g) => g.id);
    const groupKeys = new Set(groups.map((id) => id.toLowerCase()));
    const result = [...groups];
    const seen = new Set(groupKeys);
    for (const resource of [...resources].sort((a, b) => a.id.length - b.id.length)) {
        const key = resource.id.toLowerCase();
        const segs = resource.id.split("/").filter((s) => s !== "");
        const groupKey = `/${segs.slice(0, 4).join("/")}`.toLowerCase();
        if (groupKeys.has(groupKey) || seen.has(key)) continue;
        // A child resource (a database under a server) is below a parent resource that is read already
        if (result.some((id) => key.startsWith(`${id.toLowerCase()}/`))) continue;
        seen.add(key);
        result.push(resource.id);
    }
    return result;
}

/** A subscription of another tenant than the user's: Azure Lighthouse */
export function isDelegatedScope(scope: Pick<AzureScope, "level" | "tenantId">, homeTenantId: string | undefined): boolean {
    if (scope.level !== "subscription") return false;
    if (!scope.tenantId || !homeTenantId) return false;
    return scope.tenantId.toLowerCase() !== homeTenantId.toLowerCase();
}
