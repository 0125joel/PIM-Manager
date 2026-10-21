import type { RoleDetailData } from "@/types/directoryRole.types";
import type { PimGroupData } from "@/types/pimGroup.types";
import { buildKindById, buildNameById } from "@/utils/dashboardFilter";
import { getUnscheduledRoleAssignments, hasNoEnd, isActivated, isActivatedGroupAssignment, isPermanentActive } from "@/utils/assignmentKinds";
import { parseGraphPolicy } from "@/utils/policyParser";
import { buildPolicyView, completeRules, type PolicyViewContext } from "@/utils/policyView";
import { NOTIFICATION_KEYS, SETTINGS_TILES, type ApproverRef, type ExportRow } from "@/utils/exportSchema";
import { getPrincipalKind, getPrincipalKindLabel, type PrincipalKind } from "@/utils/principalUtils";

/** One assignment of a role or a group, the row of the CSV export and of the PDF appendix. */
export interface AssignmentExportRow {
    workload: "Directory role" | "PIM for Groups";
    /** Role or group name */
    resource: string;
    /** "Member" or "Owner" for groups, empty for roles */
    access: string;
    type: "Permanent" | "Eligible" | "Active";
    name: string;
    upn: string;
    objectId: string;
    kind: string;
    memberType: string;
    start: string;
    end: string;
    scope: string;
    /** Role or group id (Report export) */
    resourceId: string;
    /** Roles only: the role is privileged; undefined for groups */
    privileged?: boolean;
    /** The principal is an emergency access account */
    emergency: boolean;
    /** "Activated" or "Assigned" for active rows, empty for eligible rows */
    origin: string;
}

export interface AssignmentRowOptions {
    /** Lower case ids of anonymised people: their object id is left out */
    anonymisedIds?: ReadonlySet<string>;
    /** Lower case ids of the emergency access accounts */
    emergencyIds?: ReadonlySet<string>;
}

const date = (iso?: string | null): string => (iso ? iso.slice(0, 10) : "");
const capitalise = (value: string): string => (value ? value.charAt(0).toUpperCase() + value.slice(1) : value);

/** Every assignment of the given roles and groups; one definition for the CSV and the appendix. Sorted by resource, then name. */
export function buildAssignmentRows(roles: RoleDetailData[], groups: PimGroupData[], { anonymisedIds, emergencyIds }: AssignmentRowOptions = {}): AssignmentExportRow[] {
    const kindById = buildKindById(roles);
    const nameById = buildNameById(roles);
    const rows: AssignmentExportRow[] = [];

    const identity = (principalId: string, principal: { displayName?: string; userPrincipalName?: string; mail?: string; "@odata.type"?: string } | undefined, userType?: string) => {
        const id = principalId.toLowerCase();
        let kind: PrincipalKind = getPrincipalKind(principal);
        if (kind === "unknown") kind = kindById.get(principalId) ?? (userType ? "user" : "unknown");
        const label = userType?.toLowerCase() === "guest" ? "guest" : getPrincipalKindLabel(kind);
        return {
            name: principal?.displayName ?? nameById.get(id) ?? "",
            upn: principal?.userPrincipalName ?? principal?.mail ?? "",
            objectId: anonymisedIds?.has(id) ? "" : principalId,
            kind: label,
            emergency: emergencyIds?.has(id) ?? false,
        };
    };

    for (const role of roles) {
        const resource = role.definition.displayName;
        const roleExtra = { resourceId: role.definition.id, privileged: role.definition.isPrivileged === true };
        const scopeOf = (s?: { scopeInfo?: { displayName?: string }; directoryScopeId?: string }) => s?.scopeInfo?.displayName ?? s?.directoryScopeId ?? "";
        // Only role assignments no active schedule covers: the others are the active rows below (an activation included)
        for (const item of getUnscheduledRoleAssignments(role.assignments)) {
            rows.push({ workload: "Directory role", resource, access: "", type: "Permanent", ...roleExtra, origin: "Assigned", ...identity(item.principalId, item.principal, item.principalUserType), memberType: "Direct", start: date(item.createdDateTime), end: "", scope: scopeOf(item) });
        }
        for (const item of role.assignments.eligible) {
            rows.push({ workload: "Directory role", resource, access: "", type: "Eligible", ...roleExtra, origin: "", ...identity(item.principalId, item.principal, item.principalUserType), memberType: item.memberType ?? "", start: date(item.scheduleInfo?.startDateTime), end: date(item.scheduleInfo?.expiration?.endDateTime), scope: scopeOf(item) });
        }
        for (const item of role.assignments.active) {
            rows.push({ workload: "Directory role", resource, access: "", type: isPermanentActive(item) ? "Permanent" : "Active", ...roleExtra, origin: isActivated(item) ? "Activated" : "Assigned", ...identity(item.principalId, item.principal, item.principalUserType), memberType: item.memberType ?? "", start: date(item.scheduleInfo?.startDateTime), end: date(item.scheduleInfo?.expiration?.endDateTime), scope: scopeOf(item) });
        }
    }
    for (const data of groups) {
        for (const a of data.assignments) {
            const type = a.assignmentType === "eligible" ? "Eligible" : a.assignmentType === "permanent" ? "Permanent" : "Active";
            rows.push({ workload: "PIM for Groups", resource: data.group.displayName, access: capitalise(a.accessType), type, resourceId: data.group.id, origin: a.assignmentType === "eligible" ? "" : isActivatedGroupAssignment(a) ? "Activated" : "Assigned", ...identity(a.principalId, a.principal), memberType: a.memberType ?? "", start: date(a.startDateTime), end: date(a.endDateTime), scope: "" });
        }
    }
    return rows.sort((a, b) => a.workload.localeCompare(b.workload) || a.resource.localeCompare(b.resource) || a.name.localeCompare(b.name));
}

// --- Policy rows (settings files, Report spec 10.3 and 10.4) ---

export interface ExportLists {
    authenticationContexts?: readonly { id: string; displayName: string }[];
    /** The tenant's custom extensions; null or undefined when the list could not be read */
    customExtensions?: readonly { id: string; displayName: string }[] | null;
}

type Approvers = readonly { id: string; type?: "user" | "group" | "manager"; displayName?: string }[];

/**
 * The flat policy part of a row, keyed like the columns of `exportSchema` (`maxActivationDuration`, `n.activation.admin.isEnabled`).
 * Null when the policy has no rules (not loaded or not configured). Group rules are completed first (NG-41).
 */
export function policyFieldsOf(rawRules: readonly unknown[] | null | undefined, lists: ExportLists, resolved?: Approvers): ExportRow | null {
    if (!rawRules || rawRules.length === 0) return null;
    const settings = parseGraphPolicy({ rules: completeRules(rawRules) });
    const requirement = settings.activationRequirement;
    const approverRefs: ApproverRef[] = (settings.approvers ?? []).map((a) => ({ type: a.type, id: a.id }));
    const approverNames = (settings.approvers ?? []).map((a) => resolved?.find((r) => r.id === a.id)?.displayName ?? a.displayName ?? a.id);
    const extensionName = (link: { customExtensionId: string; displayName?: string } | undefined): string | undefined =>
        link ? (link.displayName || lists.customExtensions?.find((e) => e.id === link.customExtensionId)?.displayName || link.customExtensionId) : undefined;
    const pre = settings.customExtensions?.preApproval;
    const post = settings.customExtensions?.postApproval;
    const fields: ExportRow = {
        maxActivationDuration: settings.maxActivationDuration || undefined,
        mfaRequired: requirement === "mfa",
        justificationRequired: settings.requireJustificationOnActivation,
        approvalRequired: settings.requireApproval,
        approverNames: approverNames.length > 0 ? approverNames.join("; ") : undefined,
        authContextName: requirement === "authenticationContext" && settings.authenticationContextId
            ? (lists.authenticationContexts?.find((c) => c.id === settings.authenticationContextId)?.displayName ?? settings.authenticationContextId)
            : undefined,
        preExtensionName: extensionName(pre),
        postExtensionName: extensionName(post),
        requireOnActivation: requirement,
        authContextId: requirement === "authenticationContext" ? settings.authenticationContextId : undefined,
        ticketRequired: settings.requireTicketInfo,
        approvers: approverRefs.length > 0 ? approverRefs : undefined,
        preExtensionId: pre?.customExtensionId,
        preExtensionEnabled: pre ? pre.isEnabled : undefined,
        postExtensionId: post?.customExtensionId,
        postExtensionEnabled: post ? post.isEnabled : undefined,
        allowPermanentEligible: settings.allowPermanentEligible,
        eligibleExpiration: settings.eligibleExpiration || undefined,
        allowPermanentActive: settings.allowPermanentActive,
        activeExpiration: settings.activeExpiration || undefined,
        activeRequiresMfa: settings.requireMfaOnActiveAssignment,
        activeRequiresJustification: settings.requireJustificationOnActiveAssignment,
    };
    const n = settings.notifications as unknown as Record<string, Record<string, Record<string, unknown>>>;
    for (const key of NOTIFICATION_KEYS) {
        const [, category, recipient, name] = key.split(".");
        const value = n[category]?.[recipient]?.[name];
        fields[key] = name === "additionalRecipients" ? (value === "" ? undefined : value) : value;
    }
    return fields;
}

const prefixed = (fields: ExportRow | null, side: "member" | "owner"): ExportRow =>
    fields ? Object.fromEntries(Object.entries(fields).map(([k, v]) => [`${side}.${k}`, v])) : {};

const countOf = (...lists: readonly unknown[][]): number => lists.reduce((sum, l) => sum + l.length, 0);

/** One row per role for the Bulk role policy file; a role without rules has an empty policy part and "PIM Configured" No */
export function buildRolePolicyRows(roles: RoleDetailData[], lists: ExportLists): ExportRow[] {
    return roles.map(({ definition, assignments, policy }) => {
        const fields = policyFieldsOf(policy?.details?.rules, lists, policy?.approvers);
        return {
            roleId: definition.id,
            roleName: definition.displayName,
            description: definition.description ?? "",
            builtIn: definition.isBuiltIn === true,
            privileged: definition.isPrivileged === true,
            pimConfigured: fields !== null,
            permanentCount: assignments.permanent.length,
            eligibleCount: assignments.eligible.length,
            activeCount: assignments.active.length,
            totalAssignments: countOf(assignments.permanent, assignments.eligible, assignments.active),
            ...(fields ?? {}),
        };
    });
}

/** One row per group, Member and Owner side by side (as today's file) */
export function buildGroupPolicyRows(groups: PimGroupData[], lists: ExportLists): ExportRow[] {
    return groups.map(({ group, stats, policies }) => ({
        groupId: group.id,
        groupName: group.displayName,
        groupType: group.groupType,
        roleAssignable: group.isAssignableToRole === true,
        eligibleMembers: stats?.eligibleMembers ?? 0,
        eligibleOwners: stats?.eligibleOwners ?? 0,
        activeMembers: stats?.activeMembers ?? 0,
        activeOwners: stats?.activeOwners ?? 0,
        ...prefixed(policyFieldsOf(policies?.member?.rules, lists, policies?.member?.approvers), "member"),
        ...prefixed(policyFieldsOf(policies?.owner?.rules, lists, policies?.owner?.approvers), "owner"),
    }));
}

// --- Overview settings rows: the tiles of the policy view as text ---

function tileTexts(rawRules: readonly unknown[] | null | undefined, ctx: PolicyViewContext): ExportRow {
    const view = buildPolicyView(rawRules, ctx);
    if (!view) return {};
    const row: ExportRow = {};
    for (const tab of Object.values(view.tabs)) {
        for (const tile of tab.tiles) {
            if (!SETTINGS_TILES.some(([id]) => id === tile.id)) continue;
            row[`tile.${tile.id}`] = tile.lines.map((l) => (l.label ? `${l.label}: ${l.text}` : l.text)).join("; ");
        }
    }
    return row;
}

const settingsState = (hasRules: boolean, failed: boolean, forbidden = false): string => {
    if (hasRules) return "Loaded";
    if (forbidden) return "Not readable";
    return failed ? "Not loaded" : "Not configured";
};

export function buildOverviewRoleSettingsRows(roles: RoleDetailData[], lists: ExportLists): ExportRow[] {
    return roles.map(({ definition, policy, configError, policiesForbidden }) => {
        const rules = policy?.details?.rules;
        const hasRules = !!rules && rules.length > 0;
        return {
            roleName: definition.displayName,
            roleId: definition.id,
            privileged: definition.isPrivileged === true,
            builtIn: definition.isBuiltIn === true,
            settings: settingsState(hasRules, !!configError, policiesForbidden === true),
            ...tileTexts(rules, { ...lists, approvers: policy?.approvers, isPrivileged: definition.isPrivileged === true }),
        };
    });
}

/** One row per group and Member or Owner */
export function buildOverviewGroupSettingsRows(groups: PimGroupData[], lists: ExportLists): ExportRow[] {
    return groups.flatMap(({ group, policies, policiesForbidden }) =>
        (["member", "owner"] as const).map((side) => {
            const policy = policies?.[side];
            const hasRules = !!policy && policy.rules.length > 0;
            return {
                groupName: group.displayName,
                groupId: group.id,
                groupType: group.groupType,
                roleAssignable: group.isAssignableToRole === true,
                access: side === "member" ? "Member" : "Owner",
                // Not readable with this admin's access (FIX-11): said in the row, never "Not configured"
                settings: settingsState(hasRules, false, policiesForbidden === true),
                // A group's activation tab always asks for MFA or a context: groups pass isPrivileged (spec 4.2)
                ...tileTexts(policy?.rules, { ...lists, approvers: policy?.approvers, isPrivileged: true }),
            };
        }));
}

// --- Bulk assignment rows (Report spec 10.3) ---

export interface BulkAssignmentOptions {
    /** The moment "Duration Days" counts from; the export time */
    now?: Date;
}

export interface BulkAssignmentResult {
    rows: ExportRow[];
    /** Left out and counted for the dialog */
    skipped: { activated: number; viaGroup: number };
}

const DAY_MS = 86_400_000;

/** Whole days left until `end` (at least 1), or "permanent" without one */
function durationDaysOf(end: string | undefined, now: Date): string {
    if (!end) return "permanent";
    const ms = Date.parse(end) - now.getTime();
    return String(Math.max(1, Math.ceil(ms / DAY_MS)));
}

/** Graph documents `memberType` as direct or group and its samples write Direct: compare without case */
const isGroupMember = (memberType: string | undefined): boolean => memberType?.toLowerCase() === "group";

const upnOf = (principal?: { userPrincipalName?: string; mail?: string }): string => principal?.userPrincipalName ?? principal?.mail ?? "";

/**
 * Role assignments an import could create: eligible, assigned active and permanent. Activated schedules end by
 * themselves and members through a group get the role from the group, so both are left out and counted.
 * One row per principal, scope and type: a permanent role assignment can also be an assigned schedule without end.
 */
export function buildBulkRoleAssignmentRows(roles: RoleDetailData[], { now = new Date() }: BulkAssignmentOptions = {}): BulkAssignmentResult {
    const rows: ExportRow[] = [];
    const skipped = { activated: 0, viaGroup: 0 };
    for (const { definition, assignments } of roles) {
        const seen = new Set<string>();
        const push = (item: { principalId: string; principal?: { userPrincipalName?: string; mail?: string }; directoryScopeId: string }, assignmentType: "eligible" | "active", end: string | undefined) => {
            const key = `${item.principalId.toLowerCase()}|${item.directoryScopeId}|${assignmentType}`;
            if (seen.has(key)) return;
            seen.add(key);
            rows.push({
                roleId: definition.id,
                roleName: definition.displayName,
                principalId: item.principalId,
                principalUpn: upnOf(item.principal),
                assignmentType,
                durationDays: durationDaysOf(end, now),
                justification: "",
                action: "add",
                scopeId: item.directoryScopeId,
                endDate: end ?? "permanent",
            });
        };
        const endOf = (item: { scheduleInfo?: { expiration?: { endDateTime?: string | null } | null } | null } & Parameters<typeof hasNoEnd>[0]) =>
            hasNoEnd(item) ? undefined : item.scheduleInfo?.expiration?.endDateTime ?? undefined;
        for (const item of assignments.eligible) {
            if (isGroupMember(item.memberType)) { skipped.viaGroup++; continue; }
            push(item, "eligible", endOf(item));
        }
        for (const item of assignments.active) {
            if (isActivated(item)) { skipped.activated++; continue; }
            if (item.viaGroup || isGroupMember(item.memberType)) { skipped.viaGroup++; continue; }
            push(item, "active", endOf(item));
        }
        // The legacy role assignment list also holds an activation as a role assignment: without an end it would
        // come back as standing access, so only entries no active schedule covers (activations included) are added
        for (const item of getUnscheduledRoleAssignments(assignments)) push(item, "active", undefined);
    }
    return { rows, skipped };
}

/** Group assignments an import could create; the same rules as for roles, a group has no scope */
export function buildBulkGroupAssignmentRows(groups: PimGroupData[], { now = new Date() }: BulkAssignmentOptions = {}): BulkAssignmentResult {
    const rows: ExportRow[] = [];
    const skipped = { activated: 0, viaGroup: 0 };
    for (const { group, assignments } of groups) {
        for (const a of assignments) {
            if (isActivatedGroupAssignment(a)) { skipped.activated++; continue; }
            if (isGroupMember(a.memberType)) { skipped.viaGroup++; continue; }
            const end = a.assignmentType === "permanent" ? undefined : a.endDateTime || a.scheduleInfo?.expiration?.endDateTime || undefined;
            rows.push({
                groupId: group.id,
                groupName: group.displayName,
                principalId: a.principalId,
                principalUpn: upnOf(a.principal),
                accessType: a.accessType,
                assignmentType: a.assignmentType === "eligible" ? "eligible" : "active",
                durationDays: durationDaysOf(end, now),
                justification: "",
                action: "add",
                endDate: end ?? "permanent",
            });
        }
    }
    return { rows, skipped };
}
