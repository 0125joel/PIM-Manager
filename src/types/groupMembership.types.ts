import type { PrincipalKind } from "@/types/shared.types";

/** Members and owners of one group, read on demand (`services/groupMembershipService.ts`, Report spec 5.3) */

export interface GroupMembershipPrincipal {
    id: string;
    displayName: string;
    userPrincipalName?: string;
    /** Member or Guest, users only */
    userType?: string;
    kind: PrincipalKind;
}

export interface GroupMembership {
    members: GroupMembershipPrincipal[];
    owners: GroupMembershipPrincipal[];
}
