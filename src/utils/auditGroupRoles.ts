import type { AuditEvent } from "@/types/audit.types";
import type { RoleDetailData } from "@/types/directoryRole.types";
import { accessOfEvent, groupNameOfEvent, roleNamesByGroup } from "@/utils/auditNoActivation";

/**
 * Links an activation or assignment of group membership on the Entra Audit page to the Entra roles that group holds, as the Azure
 * page does (Joël, 2026-11-07), so a person who got a role through a group shows Through and is found by that role. The log does not
 * tell it: it names the group only, so this compares with the assignments of today. The event stays one row with its own
 * role, because No activation and Privileged only judge a group event by the group. Pure.
 */
export function linkGroupRoles(events: readonly AuditEvent[], roles: readonly RoleDetailData[]): readonly AuditEvent[] {
    const rolesByGroup = roleNamesByGroup(roles);
    if (rolesByGroup.size === 0) return events;
    return events.map((event) => {
        if (event.environment !== "group" || (event.kind !== "usage" && event.kind !== "assignment") || accessOfEvent(event) === "owner") return event;
        const names = rolesByGroup.get(event.role.id.trim().toLowerCase());
        if (!names) return event;
        return { ...event, viaGroup: groupNameOfEvent(event), groupRoles: names };
    });
}
