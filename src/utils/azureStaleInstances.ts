/**
 * The active instances read at a resource group or resource below a subscription the user cannot read, set right with the
 * classic role assignment list of the same scope (tenant test AU-17): that instance list returned an inherited instance of
 * an assignment removed weeks before, and left out the reader's real direct assignment, while the role assignment list
 * held the real one and not the removed one. Pure logic; the reads are in `workloads/azureAssignmentsAdapter.ts`.
 */
import type { ArmRoleAssignment, ArmRoleScheduleInstance } from "@/types/azureResource.types";

/** The active instance list: an instance added here reads as active downstream (`toAssignment`) */
const ACTIVE_INSTANCE_TYPE = "Microsoft.Authorization/roleAssignmentScheduleInstances";

function lastSegment(path: string): string {
    const parts = path.split("/").filter((part) => part !== "");
    return (parts.length > 0 ? parts[parts.length - 1] : "").toLowerCase();
}

const matchKey = (principalId: string, roleDefinitionId: string, scope: string) =>
    `${principalId.toLowerCase()}|${lastSegment(roleDefinitionId)}|${scope.trim().toLowerCase()}`;

/**
 * The instances of one scope read, reconciled with the role assignments read at that scope:
 * - an `Inherited` instance whose `originRoleAssignmentId` (its last segment) names no role assignment in the list is
 *   dropped; one without an `originRoleAssignmentId` is kept;
 * - a role assignment at `scopeId` itself that no instance names as its origin, and whose principal, role and scope match no
 *   instance, is added as a permanent direct active instance.
 * `roleAssignments` null (the read failed) leaves the instances unchanged.
 */
export function reconcileInstances(instances: readonly ArmRoleScheduleInstance[], roleAssignments: readonly ArmRoleAssignment[] | null, scopeId: string): ArmRoleScheduleInstance[] {
    if (roleAssignments === null) return [...instances];
    const assignmentNames = new Set(roleAssignments.map((assignment) => assignment.name.toLowerCase()));
    const kept = instances.filter((instance) => {
        const origin = instance.properties.originRoleAssignmentId;
        if (instance.properties.memberType !== "Inherited" || !origin) return true;
        return assignmentNames.has(lastSegment(origin));
    });

    // Compared with what is kept only: a dropped instance holds nothing, so it never stands in for the real assignment
    const origins = new Set(kept.flatMap((instance) => (instance.properties.originRoleAssignmentId ? [lastSegment(instance.properties.originRoleAssignmentId)] : [])));
    const held = new Set(kept.map((instance) => matchKey(instance.properties.principalId, instance.properties.roleDefinitionId, instance.properties.scope)));
    const scopeKey = scopeId.trim().toLowerCase();
    // The role assignment list has no names. The instances of the same read, the dropped ones too, often name the same person,
    // role and scope (in AU-17 the removed instance named the very person and role that was missing): borrow those names.
    type Expanded = NonNullable<ArmRoleScheduleInstance["properties"]["expandedProperties"]>;
    const principals = new Map<string, Expanded["principal"]>();
    const roles = new Map<string, Expanded["roleDefinition"]>();
    const scopes = new Map<string, Expanded["scope"]>();
    for (const instance of instances) {
        const expanded = instance.properties.expandedProperties;
        if (!expanded) continue;
        const principalId = instance.properties.principalId.toLowerCase();
        const roleId = lastSegment(instance.properties.roleDefinitionId);
        const scope = instance.properties.scope.trim().toLowerCase();
        if (expanded.principal && !principals.has(principalId)) principals.set(principalId, expanded.principal);
        if (expanded.roleDefinition && !roles.has(roleId)) roles.set(roleId, expanded.roleDefinition);
        if (expanded.scope && !scopes.has(scope)) scopes.set(scope, expanded.scope);
    }
    const added: ArmRoleScheduleInstance[] = [];
    for (const assignment of roleAssignments) {
        const p = assignment.properties;
        if (p.scope.trim().toLowerCase() !== scopeKey) continue;
        if (origins.has(assignment.name.toLowerCase())) continue;
        const key = matchKey(p.principalId, p.roleDefinitionId, p.scope);
        if (held.has(key)) continue;
        held.add(key);
        added.push({
            id: assignment.id,
            name: assignment.name,
            type: ACTIVE_INSTANCE_TYPE,
            properties: {
                scope: p.scope,
                roleDefinitionId: p.roleDefinitionId,
                principalId: p.principalId,
                principalType: p.principalType,
                memberType: "Direct",
                status: "Provisioned",
                assignmentType: "Assigned",
                ...(p.createdOn ? { startDateTime: p.createdOn } : {}),
                originRoleAssignmentId: assignment.id,
                ...expandedFor(principals.get(p.principalId.toLowerCase()), roles.get(lastSegment(p.roleDefinitionId)), scopes.get(scopeKey)),
            },
        });
    }
    return [...kept, ...added];
}

/** The names borrowed for an added instance, or nothing when none is known */
function expandedFor(
    principal: NonNullable<ArmRoleScheduleInstance["properties"]["expandedProperties"]>["principal"],
    roleDefinition: NonNullable<ArmRoleScheduleInstance["properties"]["expandedProperties"]>["roleDefinition"],
    scope: NonNullable<ArmRoleScheduleInstance["properties"]["expandedProperties"]>["scope"],
): Pick<ArmRoleScheduleInstance["properties"], "expandedProperties"> {
    if (!principal && !roleDefinition && !scope) return {};
    return { expandedProperties: { ...(principal ? { principal } : {}), ...(roleDefinition ? { roleDefinition } : {}), ...(scope ? { scope } : {}) } };
}
