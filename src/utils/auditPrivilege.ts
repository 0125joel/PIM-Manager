import type { AuditEvent } from "@/types/audit.types";
import type { RoleDetailData } from "@/types/directoryRole.types";
import { getPrincipalKind, type PrincipalKind } from "@/utils/principalUtils";

/**
 * What Privileged only on the Audit page knows, from the role data the app already reads. Pure.
 *
 * `isPrivileged` is beta-only on a role definition, so it can be missing for one role or for all of them. A verdict is
 * therefore true, false or null, and null never reads as "not privileged". Groups have no such flag: a group counts as
 * privileged when it is eligible or active for a privileged role (Joël, 2026-11-06).
 */
export interface AuditPrivilege {
    /** Graph gave `isPrivileged` on at least one role. Without it the filter cannot be applied at all */
    isReported: boolean;
    /** By role id and template id, lower case */
    byRoleId: ReadonlyMap<string, boolean | null>;
    /** By display name, lower case: a row can carry the name of a role and no usable id */
    byRoleName: ReadonlyMap<string, boolean | null>;
    /** Who is eligible or active for a privileged role, lower case; for a group that is what makes it privileged */
    holdersOfPrivileged: ReadonlySet<string>;
    /** The kind of everyone who holds a role, by object id, lower case. The log calls an app and an agent the same; this tells them apart */
    holderKinds: ReadonlyMap<string, PrincipalKind>;
}

export function buildAuditPrivilege(roles: readonly RoleDetailData[]): AuditPrivilege {
    const byRoleId = new Map<string, boolean | null>();
    const byRoleName = new Map<string, boolean | null>();
    const holdersOfPrivileged = new Set<string>();
    const holderKinds = new Map<string, PrincipalKind>();
    let isReported = false;
    for (const role of roles) {
        const { id, templateId, displayName, isPrivileged } = role.definition;
        const verdict = isPrivileged ?? null;
        if (verdict !== null) isReported = true;
        for (const item of [...role.assignments.eligible, ...role.assignments.active, ...role.assignments.permanent]) {
            const kind = getPrincipalKind(item.principal);
            if (kind !== "unknown") holderKinds.set(item.principalId.toLowerCase(), kind);
        }
        byRoleId.set(id.toLowerCase(), verdict);
        if (templateId) byRoleId.set(templateId.toLowerCase(), verdict);
        byRoleName.set(displayName.trim().toLowerCase(), verdict);
        if (verdict !== true) continue;
        const { eligible, active, permanent } = role.assignments;
        for (const item of [...eligible, ...active, ...permanent]) holdersOfPrivileged.add(item.principalId.toLowerCase());
    }
    return { isReported, byRoleId, byRoleName, holdersOfPrivileged, holderKinds };
}

/** The verdict on a group by its id; without an id it cannot be judged */
export function judgeGroupPrivilege(groupId: string, privilege: AuditPrivilege): boolean | null {
    const id = groupId.trim().toLowerCase();
    return id === "" ? null : privilege.holdersOfPrivileged.has(id);
}

/** The verdict on the role or group of an event; null when the role is not known, such as a deleted role or a row without one */
export function judgeEventPrivilege(event: AuditEvent, privilege: AuditPrivilege): boolean | null {
    // An Azure row of a group already names the Azure role it carries: it is judged by that role
    if (event.environment === "group" && !event.azure) return judgeGroupPrivilege(event.role.id, privilege);
    const byId = privilege.byRoleId.get(event.role.id.trim().toLowerCase());
    if (byId !== undefined) return byId;
    return privilege.byRoleName.get(event.role.name.trim().toLowerCase()) ?? null;
}

/** The sentence for what Privileged only kept without knowing, or null when there is none */
export function unjudgedText(count: number, noun: "event" | "assignment"): string | null {
    if (count === 0) return null;
    return count === 1
        ? `1 ${noun} kept because its role could not be judged.`
        : `${count} ${noun}s kept because their role could not be judged.`;
}

export const PRIVILEGE_NOT_REPORTED_TEXT = "Microsoft Graph did not say which roles are privileged.";
