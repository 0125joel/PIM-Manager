/**
 * Principal kind from the `@odata.type` that Graph returns on an expanded `principal` (`#microsoft.graph.user`, `group`,
 * `servicePrincipal`, and the Agent ID types `agentIdentity`, `agentUser`, `agentIdentityBlueprintPrincipal`).
 * One place so that every screen tells users, groups, apps and agents apart the same way.
 */

import type { PrincipalKind } from "@/types/shared.types";
import { COPILOT_STUDIO_BLUEPRINT_APP_ID } from "@/config/constants";

export type { PrincipalKind };

const ODATA_PREFIX = "#microsoft.graph.";

type PrincipalLike = { "@odata.type"?: string; servicePrincipalType?: string | null } | null | undefined;

export function getPrincipalKind(principal: PrincipalLike): PrincipalKind {
    const odataType = principal?.["@odata.type"];
    if (!odataType) return "unknown";
    const name = (odataType.startsWith(ODATA_PREFIX) ? odataType.slice(ODATA_PREFIX.length) : odataType).toLowerCase();
    if (name === "user") return "user";
    if (name === "group") return "group";
    if (name === "agentidentity") return "agentIdentity";
    if (name === "agentuser") return "agentUser";
    if (name === "agentidentityblueprintprincipal") return "agentIdentityBlueprintPrincipal";
    if (name === "serviceprincipal") {
        // roleAssignments with $expand=principal returns an agent identity as the base type; only agent identities use
        // ServiceIdentity (tenant test 2026-10-11)
        return principal?.servicePrincipalType?.toLowerCase() === "serviceidentity" ? "agentIdentity" : "servicePrincipal";
    }
    return "unknown";
}

/** The three Agent ID kinds */
export function isAgentKind(kind: PrincipalKind): boolean {
    return kind === "agentIdentity" || kind === "agentUser" || kind === "agentIdentityBlueprintPrincipal";
}

/**
 * The kind Configure works with (decision D6): an agent identity and a blueprint principal are service principals, an
 * agent's user account is a user. Every other kind stays as it is.
 */
export function toBasicKind(kind: PrincipalKind): "user" | "group" | "servicePrincipal" | "unknown" {
    switch (kind) {
        case "agentIdentity":
        case "agentIdentityBlueprintPrincipal":
            return "servicePrincipal";
        case "agentUser":
            return "user";
        default:
            return kind;
    }
}

/** Plain label for UI text and exports: "user", "group", "app", the Microsoft name of an agent kind, or "principal" when unknown. */
export function getPrincipalKindLabel(kind: PrincipalKind): string {
    switch (kind) {
        case "user":
            return "user";
        case "group":
            return "group";
        case "servicePrincipal":
            return "app";
        case "agentIdentity":
            return "agent identity";
        case "agentUser":
            return "agent's user account";
        case "agentIdentityBlueprintPrincipal":
            return "agent identity blueprint principal";
        default:
            return "principal";
    }
}

export type AgentOrigin = "copilotStudio";

/** Product names as Microsoft writes them */
export const AGENT_ORIGIN_NAMES: Record<AgentOrigin, string> = { copilotStudio: "Microsoft Copilot Studio" };

/** The product that made an agent identity, from its blueprint id; null when no fixed id says so (Foundry, own agents, ...). */
export function getAgentOrigin(principal: { agentIdentityBlueprintId?: string | null } | null | undefined): AgentOrigin | null {
    return principal?.agentIdentityBlueprintId?.toLowerCase() === COPILOT_STUDIO_BLUEPRINT_APP_ID ? "copilotStudio" : null;
}

/**
 * "Direct" or "Group" for an assignment: Graph's `memberType` when present, otherwise derived from
 * the principal (permanent assignments have no memberType). A service principal or an agent is a direct member.
 * Null when neither is known.
 */
export function getAssignmentMemberType(assignment: {
    memberType?: string;
    principal?: PrincipalLike;
}): "Direct" | "Group" | null {
    if (assignment.memberType) {
        // Graph documents direct and group, its samples write Direct: compare without case
        return assignment.memberType.toLowerCase() === "group" ? "Group" : "Direct";
    }
    if (!assignment.principal?.["@odata.type"]) return null;
    return getPrincipalKind(assignment.principal) === "group" ? "Group" : "Direct";
}
