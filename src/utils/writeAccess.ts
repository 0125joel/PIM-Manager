/**
 * Who may change what (NG-56, spec 3.2): turns the admin's own roles and groups into one decision per area and per
 * group. Pure; the reads live in `services/writeAccessService.ts`, the hook in `hooks/useWriteAccess.ts`.
 *
 * Facts it relies on (tenant tests of 2026-10-03): a role held through a group comes back with `memberType` Group and
 * counts; the group API answers enums in lower case, the role API in Pascal case, so every comparison ignores case; an
 * eligible-only PIM owner is not in `/me/ownedObjects`, an activated one is, and stays after its end when it is the last
 * active owner (T2h), so an instance with an end in the past still counts. An eligible PIM membership of a group that
 * holds an active role assignment is a role to activate (through the group).
 */
import type { PimGroupData } from "@/types/pimGroup.types";

export const ROLE_TEMPLATES = {
    globalAdministrator: "62e90394-69f5-4237-9190-012177145e10",
    privilegedRoleAdministrator: "e8611ab8-c189-46e8-94e1-60213ab1f814",
    groupsAdministrator: "fdd7a751-b60b-444a-984c-02652fe8fa1c",
    identityGovernanceAdministrator: "45d8d3c5-c802-45c6-b32a-1d70b5e1e86e",
    userAdministrator: "fe930be7-5e62-47db-91af-98c3a49a38b1",
    directoryWriters: "9360feb5-f418-4baa-8175-e2a00bac4301",
} as const;

/** Roles that may change Entra role settings and assignments, and every group (Learn: Graph write APIs, groups-role-settings) */
const FULL_ROLES: ReadonlySet<string> = new Set([ROLE_TEMPLATES.privilegedRoleAdministrator, ROLE_TEMPLATES.globalAdministrator]);
/** Built-in roles holding `microsoft.directory/groups/members/update` and `.../owners/update` (permissions reference) */
const GROUP_ROLES: ReadonlySet<string> = new Set([
    ROLE_TEMPLATES.groupsAdministrator,
    ROLE_TEMPLATES.identityGovernanceAdministrator,
    ROLE_TEMPLATES.userAdministrator,
    ROLE_TEMPLATES.directoryWriters,
]);
const GROUP_ACTIONS = ["microsoft.directory/groups/members/update", "microsoft.directory/groups/owners/update"];
const GROUP_ALL_ACTIONS = "microsoft.directory/groups/allproperties/alltasks";

export interface MyRoleInstance {
    roleDefinitionId: string;
    directoryScopeId?: string | null;
    memberType?: string | null;
    assignmentType?: string | null;
    endDateTime?: string | null;
}

export interface MyGroupInstance {
    groupId: string;
    accessId: string;
    memberType?: string | null;
    assignmentType?: string | null;
    endDateTime?: string | null;
}

export interface RoleDefinitionLike {
    id: string;
    templateId?: string | null;
    displayName: string;
    isBuiltIn?: boolean;
    /** As Graph returns it; read defensively */
    rolePermissions?: ReadonlyArray<unknown> | null;
}

export interface GroupLike {
    id: string;
    displayName: string;
    /** `true` only; null and false mean not role-assignable (T2: Graph answers null) */
    isAssignableToRole?: boolean | null;
    membershipRule?: string | null;
    onPremisesSyncEnabled?: boolean | null;
    isManagementRestricted?: boolean | null;
    isUnderPim: boolean;
}

export interface OwnedGroupRead {
    id: string;
    displayName?: string;
    isAssignableToRole?: boolean | null;
    membershipRule?: string | null;
    onPremisesSyncEnabled?: boolean | null;
    isManagementRestricted?: boolean | null;
}

export type PermissionState = "granted" | "notGranted" | "unknown";

/** What the access check reads from Graph (spec 3.1) */
export interface WriteAccessReads {
    activeRoles: readonly MyRoleInstance[];
    eligibleRoles: readonly MyRoleInstance[];
    /** `/me/ownedObjects/microsoft.graph.group` */
    ownedGroups: readonly OwnedGroupRead[];
    groupActive: readonly MyGroupInstance[];
    groupEligible: readonly MyGroupInstance[];
    /** The groups of each administrative unit a group role of the admin is scoped to */
    administrativeUnitGroups: Readonly<Record<string, readonly OwnedGroupRead[]>>;
    /** The groups a group role of the admin is scoped to one by one (`/{groupId}`), read because the app may not load them */
    scopedGroups?: readonly OwnedGroupRead[];
    appPermission: { directoryRoles: PermissionState; pimGroups: PermissionState };
}

export interface WriteAccessInput extends WriteAccessReads {
    roleDefinitions: readonly RoleDefinitionLike[];
    /** The groups the app has loaded (under PIM and outside it); owned, unit and scoped groups not among them are added */
    groups: readonly GroupLike[];
    /** Active role assignments whose principal is a group, by lower-case group id (from the loaded roles; `groupRoleAssignments`) */
    rolesOfGroups?: Readonly<Record<string, readonly MyRoleInstance[]>>;
}

export type AccessState = "open" | "activate-first" | "closed";

export interface HeldRole {
    roleDefinitionId: string;
    name: string;
    end: string | null;
    viaGroup: boolean;
    /** "/", "/administrativeUnits/{id}" or "/{groupId}" */
    scope: string;
    /** Eligible through PIM membership of this group: activating the membership gives the role */
    throughGroup?: { groupId: string; groupName: string };
}

/** What opens something: a role, or ownership of the group(s) */
export type AccessVia = { kind: "role"; role: HeldRole } | { kind: "ownership" };

/** What to activate first: an eligible role, or an eligible ownership of a group */
export type ActivateTarget = { kind: "role"; role: HeldRole } | { kind: "ownership"; groupId: string; groupName: string };

export interface AreaAccess {
    state: AccessState;
    via: AccessVia | null;
    activate: ActivateTarget | null;
    /**
     * "all": every group of the area is open whatever the loaded list holds (a tenant-wide role); "some": the groups
     * in `openCount` (ownership, an administrative unit); absent for Entra roles.
     */
    reach?: "all" | "some";
    /** For "x of y": how many loaded groups of the area are open */
    openCount?: number;
    total?: number;
}

export interface GroupAccessDecision {
    groupId: string;
    displayName: string;
    isUnderPim: boolean;
    isAssignableToRole: boolean;
    state: AccessState | "locked";
    /** Why: the role or ownership that opens it, what to activate, or what is needed (a sentence for every state) */
    reason: string;
    via: AccessVia | null;
    activate: ActivateTarget | null;
    owner: boolean;
}

export interface WriteAccess {
    roles: AreaAccess;
    roleAssignableGroups: AreaAccess;
    otherGroups: AreaAccess;
    groups: Record<string, GroupAccessDecision>;
    appPermission: WriteAccessInput["appPermission"];
    /** The start page row (spec 3.4) */
    overall: "open" | "activate-first" | "closed" | "consent";
    /** What the row names: the role or ownership that opens most, or the role or ownership to activate */
    headline: { kind: "open"; via: AccessVia } | { kind: "activate"; target: ActivateTarget } | null;
}

export const DYNAMIC_OR_SYNCED_REASON = "Dynamic and on-premises groups cannot be managed by PIM.";
/** Learn (groups-role-settings): PIM does not support groups in a restricted management administrative unit (M-07) */
export const RESTRICTED_UNIT_REASON = "Groups in a restricted management administrative unit cannot be managed by PIM.";

/** Why a group can never come under PIM, whatever the admin holds; null when it can */
export function groupLockReason(g: { membershipRule?: string | null; onPremisesSyncEnabled?: boolean | null; isManagementRestricted?: boolean | null }): string | null {
    if ((g.membershipRule ?? "") !== "" || g.onPremisesSyncEnabled === true) return DYNAMIC_OR_SYNCED_REASON;
    if (g.isManagementRestricted === true) return RESTRICTED_UNIT_REASON;
    return null;
}

const lower = (v: string | null | undefined) => (v ?? "").toLowerCase();

function templateOf(roleId: string, definitions: ReadonlyMap<string, RoleDefinitionLike>): string {
    const def = definitions.get(lower(roleId));
    return lower(def?.templateId || roleId);
}

function actionsOf(def: RoleDefinitionLike | undefined): Set<string> {
    const actions = new Set<string>();
    for (const p of def?.rolePermissions ?? []) {
        const list = (p as { allowedResourceActions?: unknown } | null)?.allowedResourceActions;
        if (Array.isArray(list)) for (const a of list) if (typeof a === "string") actions.add(a.toLowerCase());
    }
    return actions;
}

function holdsGroupActions(def: RoleDefinitionLike | undefined): boolean {
    const actions = actionsOf(def);
    return actions.has(GROUP_ALL_ACTIONS) || GROUP_ACTIONS.every((a) => actions.has(a));
}

function held(instance: MyRoleInstance, definitions: ReadonlyMap<string, RoleDefinitionLike>): HeldRole {
    return {
        roleDefinitionId: instance.roleDefinitionId,
        name: definitions.get(lower(instance.roleDefinitionId))?.displayName ?? "Unknown role",
        end: instance.endDateTime ?? null,
        viaGroup: lower(instance.memberType) === "group",
        scope: instance.directoryScopeId || "/",
    };
}

const isTenantWide = (scope: string) => scope === "/" || scope === "";

export function administrativeUnitOf(scope: string | null | undefined): string | null {
    const match = /^\/administrativeUnits\/([^/]+)$/i.exec(scope ?? "");
    return match ? match[1] : null;
}

/** A scope of one object (`/{id}`), the shape a custom group role can take */
function objectOf(scope: string): string | null {
    const match = /^\/([0-9a-f-]{36})$/i.exec(scope);
    return match ? match[1].toLowerCase() : null;
}

function isFullRole(instance: MyRoleInstance, definitions: ReadonlyMap<string, RoleDefinitionLike>): boolean {
    return FULL_ROLES.has(templateOf(instance.roleDefinitionId, definitions)) && isTenantWide(instance.directoryScopeId || "/");
}

/** A role that holds the group actions: the built-in group roles, or a custom role with both actions */
export function isGroupRole(instance: Pick<MyRoleInstance, "roleDefinitionId">, definitions: readonly RoleDefinitionLike[] | ReadonlyMap<string, RoleDefinitionLike>): boolean {
    const map = definitions instanceof Map ? definitions as ReadonlyMap<string, RoleDefinitionLike> : new Map((definitions as readonly RoleDefinitionLike[]).map((d) => [lower(d.id), d]));
    if (GROUP_ROLES.has(templateOf(instance.roleDefinitionId, map))) return true;
    const def = map.get(lower(instance.roleDefinitionId));
    return !!def && def.isBuiltIn === false && holdsGroupActions(def);
}

/** Prefer, in this order: Privileged Role Administrator, Global Administrator, tenant-wide roles, the rest */
function rank(role: HeldRole, definitions: ReadonlyMap<string, RoleDefinitionLike>): number {
    const t = templateOf(role.roleDefinitionId, definitions);
    if (t === ROLE_TEMPLATES.privilegedRoleAdministrator) return 0;
    if (t === ROLE_TEMPLATES.globalAdministrator) return 1;
    return isTenantWide(role.scope) ? 2 : 3;
}

function best(list: HeldRole[], definitions: ReadonlyMap<string, RoleDefinitionLike>): HeldRole | null {
    return [...list].sort((a, b) => rank(a, definitions) - rank(b, definitions))[0] ?? null;
}

/** Whether a group role at this scope covers the group */
function covers(role: HeldRole, groupId: string, units: Readonly<Record<string, readonly OwnedGroupRead[]>>): boolean {
    if (isTenantWide(role.scope)) return true;
    const unit = administrativeUnitOf(role.scope);
    if (unit) return (units[unit] ?? units[lower(unit)] ?? []).some((g) => lower(g.id) === groupId);
    return objectOf(role.scope) === groupId;
}

function isLocked(g: { membershipRule?: string | null; onPremisesSyncEnabled?: boolean | null; isManagementRestricted?: boolean | null }): boolean {
    return groupLockReason(g) !== null;
}

export function deriveWriteAccess(input: WriteAccessInput): WriteAccess {
    const definitions = new Map<string, RoleDefinitionLike>(input.roleDefinitions.map((d) => [lower(d.id), d]));
    const units = input.administrativeUnitGroups;

    const activeFull = input.activeRoles.filter((r) => isFullRole(r, definitions)).map((r) => held(r, definitions));
    const eligibleFull = input.eligibleRoles.filter((r) => isFullRole(r, definitions)).map((r) => held(r, definitions));
    const activeGroupRoles = input.activeRoles.filter((r) => isGroupRole(r, definitions)).map((r) => held(r, definitions));
    const eligibleGroupRoles = input.eligibleRoles.filter((r) => isGroupRole(r, definitions)).map((r) => held(r, definitions));

    // An eligible PIM membership of a group holding an active role: that role, once the membership is activated
    const groupNames = new Map<string, string>();
    for (const g of input.groups) groupNames.set(lower(g.id), g.displayName);
    for (const inst of input.groupEligible) {
        if (lower(inst.accessId) !== "member") continue;
        const groupId = lower(inst.groupId);
        for (const r of input.rolesOfGroups?.[groupId] ?? []) {
            const role = { ...held(r, definitions), viaGroup: true, throughGroup: { groupId: inst.groupId, groupName: groupNames.get(groupId) ?? inst.groupId } };
            if (isFullRole(r, definitions)) eligibleFull.push(role);
            if (isGroupRole(r, definitions)) eligibleGroupRoles.push(role);
        }
    }

    const owned = new Set(input.ownedGroups.map((g) => lower(g.id)));
    for (const inst of input.groupActive) if (lower(inst.accessId) === "owner") owned.add(lower(inst.groupId));
    const eligibleOwner = new Set(input.groupEligible.filter((i) => lower(i.accessId) === "owner").map((i) => lower(i.groupId)));

    const full = best(activeFull, definitions);
    const fullToActivate = best(eligibleFull, definitions);
    const tenantGroupRole = best(activeGroupRoles.filter((r) => isTenantWide(r.scope)), definitions);
    const tenantGroupRoleToActivate = best(eligibleGroupRoles.filter((r) => isTenantWide(r.scope)), definitions);

    // Owned groups, groups in a unit and groups a role is scoped to that the app has not loaded (outside PIM and not
    // role-assignable) still count
    const known = new Set(input.groups.map((g) => lower(g.id)));
    const allGroups: GroupLike[] = [...input.groups];
    const extra = [...input.ownedGroups, ...Object.values(units).flat(), ...(input.scopedGroups ?? [])];
    for (const g of extra) {
        if (known.has(lower(g.id))) continue;
        known.add(lower(g.id));
        allGroups.push({
            id: g.id,
            displayName: g.displayName ?? g.id,
            isAssignableToRole: g.isAssignableToRole ?? null,
            membershipRule: g.membershipRule ?? null,
            onPremisesSyncEnabled: g.onPremisesSyncEnabled ?? null,
            isManagementRestricted: g.isManagementRestricted ?? null,
            isUnderPim: false,
        });
    }

    const groups: Record<string, GroupAccessDecision> = {};
    for (const group of allGroups) {
        const id = lower(group.id);
        const isOwner = owned.has(id);
        const roleAssignable = group.isAssignableToRole === true;
        const base = { groupId: group.id, displayName: group.displayName, isUnderPim: group.isUnderPim, isAssignableToRole: roleAssignable, owner: isOwner };
        const decide = (state: GroupAccessDecision["state"], reason: string, via: AccessVia | null, activate: ActivateTarget | null) => {
            groups[group.id] = { ...base, state, reason, via, activate };
        };
        if (isLocked(group)) { decide("locked", groupLockReason(group) ?? DYNAMIC_OR_SYNCED_REASON, null, null); continue; }
        if (full) { decide("open", full.name, { kind: "role", role: full }, null); continue; }
        if (isOwner) { decide("open", "You own it", { kind: "ownership" }, null); continue; }
        const viaRole = roleAssignable ? null : best(activeGroupRoles.filter((r) => covers(r, id, units)), definitions);
        if (viaRole) { decide("open", viaRole.name, { kind: "role", role: viaRole }, null); continue; }
        if (eligibleOwner.has(id)) {
            decide("activate-first", `Activate your ownership of ${group.displayName} first`, null, { kind: "ownership", groupId: group.id, groupName: group.displayName });
            continue;
        }
        const toActivate = fullToActivate ?? (roleAssignable ? null : best(eligibleGroupRoles.filter((r) => covers(r, id, units)), definitions));
        if (toActivate) { decide("activate-first", `Activate ${toActivate.name} first`, null, { kind: "role", role: toActivate }); continue; }
        decide("closed", roleAssignable
            ? "Needs Privileged Role Administrator, Global Administrator or ownership of this group."
            : "Needs Privileged Role Administrator, a group role such as Groups Administrator, or ownership of this group.", null, null);
    }

    const roles: AreaAccess = full
        ? { state: "open", via: { kind: "role", role: full }, activate: null }
        : fullToActivate
            ? { state: "activate-first", via: null, activate: { kind: "role", role: fullToActivate } }
            : { state: "closed", via: null, activate: null };

    const area = (filter: (g: GroupLike) => boolean, tenantRole: HeldRole | null, tenantRoleToActivate: HeldRole | null): AreaAccess => {
        const list = allGroups.filter((g) => filter(g) && groups[g.id]?.state !== "locked");
        const openGroups = list.filter((g) => groups[g.id]?.state === "open");
        const counts = { openCount: openGroups.length, total: list.length };
        // A tenant-wide role opens the whole area, whatever the loaded list holds (it can still be loading)
        if (tenantRole) return { state: "open", via: { kind: "role", role: tenantRole }, activate: null, reach: "all", ...counts };
        if (openGroups.length > 0) {
            const first = groups[openGroups[0].id];
            const via = openGroups.every((g) => groups[g.id]?.via?.kind === "ownership") ? { kind: "ownership" as const } : first.via;
            return { state: "open", via, activate: null, reach: "some", ...counts };
        }
        if (tenantRoleToActivate) return { state: "activate-first", via: null, activate: { kind: "role", role: tenantRoleToActivate }, ...counts };
        const pending = list.map((g) => groups[g.id]).find((d) => d?.state === "activate-first");
        if (pending) return { state: "activate-first", via: null, activate: pending.activate, ...counts };
        return { state: "closed", via: null, activate: null, ...counts };
    };
    const roleAssignableGroups = area((g) => g.isAssignableToRole === true, full, fullToActivate);
    const otherGroups = area((g) => g.isAssignableToRole !== true, full ?? tenantGroupRole, fullToActivate ?? tenantGroupRoleToActivate);

    const areas = [roles, roleAssignableGroups, otherGroups];
    const anyOpen = areas.some((a) => a.state === "open");
    const granted = (workload: "directoryRoles" | "pimGroups") => input.appPermission[workload] === "granted";
    const canWrite = (roles.state === "open" && granted("directoryRoles"))
        || ((roleAssignableGroups.state === "open" || otherGroups.state === "open") && granted("pimGroups"));
    const overall: WriteAccess["overall"] = anyOpen
        ? (canWrite ? "open" : "consent")
        : areas.some((a) => a.state === "activate-first") ? "activate-first" : "closed";

    const openVia = areas.filter((a) => a.state === "open" && a.via).map((a) => a.via as AccessVia);
    const headlineRole = best(openVia.filter((v): v is { kind: "role"; role: HeldRole } => v.kind === "role").map((v) => v.role), definitions);
    const toActivate = areas.map((a) => a.activate).filter((a): a is ActivateTarget => !!a);
    const activateRole = best(toActivate.filter((a): a is { kind: "role"; role: HeldRole } => a.kind === "role").map((a) => a.role), definitions);
    const headline: WriteAccess["headline"] = anyOpen
        ? { kind: "open", via: headlineRole ? { kind: "role", role: headlineRole } : { kind: "ownership" } }
        : activateRole
            ? { kind: "activate", target: { kind: "role", role: activateRole } }
            : toActivate[0] ? { kind: "activate", target: toActivate[0] } : null;

    return { roles, roleAssignableGroups, otherGroups, groups, appPermission: input.appPermission, overall, headline };
}

/**
 * The administrative units and single groups the check needs to read: the scopes of group roles of the admin (active or
 * eligible). Without the role definitions (the roles load failed) a custom role cannot be told apart, so every scoped
 * role counts; reading a unit too many is harmless.
 */
export function scopesToRead(roles: readonly MyRoleInstance[], definitions: readonly RoleDefinitionLike[]): { units: string[]; groups: string[] } {
    const map = new Map(definitions.map((d) => [lower(d.id), d]));
    const relevant = roles.filter((r) => map.size === 0 || isGroupRole(r, map));
    const units = new Set<string>();
    const groups = new Set<string>();
    for (const r of relevant) {
        const unit = administrativeUnitOf(r.directoryScopeId);
        if (unit) units.add(unit);
        const group = objectOf(r.directoryScopeId || "/");
        if (group) groups.add(group);
    }
    return { units: [...units], groups: [...groups] };
}

/** Active role assignments whose principal is one of the groups, from the loaded roles (minimal shape, keyed lower case) */
export function groupRoleAssignments(
    roles: ReadonlyArray<{ definition: { id: string }; assignments: { active: ReadonlyArray<{ principalId: string; directoryScopeId?: string | null; scheduleInfo?: { expiration?: { endDateTime?: string } } }> } }>,
    groupIds: Iterable<string>,
): Record<string, MyRoleInstance[]> {
    const wanted = new Set([...groupIds].map(lower));
    const result: Record<string, MyRoleInstance[]> = {};
    if (wanted.size === 0) return result;
    for (const role of roles) {
        for (const a of role.assignments.active) {
            const id = lower(a.principalId);
            if (!wanted.has(id)) continue;
            (result[id] ??= []).push({
                roleDefinitionId: role.definition.id,
                directoryScopeId: a.directoryScopeId ?? "/",
                memberType: "Group",
                endDateTime: a.scheduleInfo?.expiration?.endDateTime ?? null,
            });
        }
    }
    return result;
}

/**
 * The groups the access check found (owned, in a unit, scoped) that the app has not loaded: not role-assignable and
 * outside PIM. Edit lists them in "Not under PIM" so the start page count and the list agree (FIX-14).
 */
export function groupsOutsideLoad(access: WriteAccess | null, loaded: readonly { group: { id: string } }[]): PimGroupData[] {
    if (!access) return [];
    const known = new Set(loaded.map((g) => lower(g.group.id)));
    return Object.values(access.groups)
        .filter((d) => !d.isUnderPim && !known.has(lower(d.groupId)))
        .map((d) => ({
            group: {
                id: d.groupId,
                displayName: d.displayName,
                groupType: "unknown" as const,
                isAssignableToRole: d.isAssignableToRole,
            },
            assignments: [],
            linkedWorkloads: [],
            isManaged: false,
        }));
}
