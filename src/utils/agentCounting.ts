import type { RoleDetailData } from "@/types/directoryRole.types";
import type { PimGroupData } from "@/types/pimGroup.types";
import { getPrincipalKind, isAgentKind } from "@/utils/principalUtils";

const isAgent = (item: { principal?: { "@odata.type"?: string; servicePrincipalType?: string | null } | null }) => isAgentKind(getPrincipalKind(item.principal));

/**
 * The roles and groups with every assignment held by an agent left out: what the dashboard counts when the chip Agents
 * is off (decision D4). Roles and groups themselves stay, also when no assignment is left. Returns copies.
 */
export function withoutAgents(roles: readonly RoleDetailData[], groups: readonly PimGroupData[]): { roles: RoleDetailData[]; groups: PimGroupData[] } {
    return {
        roles: roles.map((role) => ({
            ...role,
            assignments: {
                ...role.assignments,
                permanent: role.assignments.permanent.filter((assignment) => !isAgent(assignment)),
                eligible: role.assignments.eligible.filter((assignment) => !isAgent(assignment)),
                active: role.assignments.active.filter((assignment) => !isAgent(assignment)),
            },
        })),
        groups: groups.map((group) => ({ ...group, assignments: group.assignments.filter((assignment) => !isAgent(assignment)) })),
    };
}
