import type { PimScheduleInstance, RoleDetailData } from "@/types/directoryRole.types";
import type { PimGroup, PimGroupData } from "@/types/pimGroup.types";
import { getRolesHeldByGroups, type RoleHeldByGroup } from "@/utils/groupsOutsidePim";

/**
 * Activations through a group (Report spec 5.6). Graph lists a member who activates a role that is eligible for their group
 * as a direct row in `roleAssignmentSchedules`; only `roleAssignmentScheduleInstances` says `memberType` Group, and neither
 * names the group. The first half marks the schedules, the second finds the group from the groups that are eligible for
 * the role and have the user as a member.
 */

type InstanceLike = Pick<PimScheduleInstance, "roleAssignmentScheduleId" | "memberType">;

/** Ids of the active schedules that an instance with `memberType` Group points at. */
export function getViaGroupScheduleIds(instances: readonly InstanceLike[]): Set<string> {
    const ids = new Set<string>();
    for (const instance of instances) {
        if (instance.memberType?.toLowerCase() === "group" && instance.roleAssignmentScheduleId) ids.add(instance.roleAssignmentScheduleId);
    }
    return ids;
}

/** Sets `viaGroup: true` on every schedule whose id is in the set; the others are returned as they are. */
export function markSchedulesViaGroup<T extends { id: string; viaGroup?: boolean }>(schedules: T[], viaGroupIds: ReadonlySet<string>): T[] {
    if (viaGroupIds.size === 0) return schedules;
    return schedules.map((schedule) => (viaGroupIds.has(schedule.id) ? { ...schedule, viaGroup: true } : schedule));
}

export type ActivationGroupResolution =
    | { status: "one"; group: PimGroup }
    | { status: "none" }
    | { status: "several"; groups: PimGroup[] };

/**
 * The group an activation came through: the groups that hold the role eligibly and list the principal as a member.
 * Membership comes from the PIM for Groups data (an eligible or active member assignment) and, for groups that data does
 * not cover, from members read on demand (`knownMembers`: group id to the ids of its members). One candidate names the
 * group; none or several leave it unnamed.
 */
export function resolveActivationGroup(
    role: RoleDetailData,
    principalId: string,
    groups: readonly PimGroupData[],
    knownMembers?: ReadonlyMap<string, ReadonlySet<string>>,
    /** The role's holders by group id, when the caller resolves many activations of one role (`getRolesHeldByGroups([role], ids)`) */
    heldByGroup?: ReadonlyMap<string, readonly RoleHeldByGroup[]>
): ActivationGroupResolution {
    const person = principalId.toLowerCase();
    const held = heldByGroup ?? getRolesHeldByGroups([role], groups.map((g) => g.group.id));
    const candidates: PimGroup[] = [];
    for (const data of groups) {
        const holdsRoleEligibly = (held.get(data.group.id.toLowerCase()) ?? []).some((entry) => entry.kind === "eligible");
        if (!holdsRoleEligibly) continue;
        const isMember = data.assignments.some((a) => a.accessType === "member" && a.principalId?.toLowerCase() === person)
            || (knownMembers?.get(data.group.id.toLowerCase())?.has(person) ?? false);
        if (isMember) candidates.push(data.group);
    }
    if (candidates.length === 1) return { status: "one", group: candidates[0] };
    if (candidates.length === 0) return { status: "none" };
    return { status: "several", groups: candidates };
}
