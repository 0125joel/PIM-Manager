"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { GroupMembershipState } from "@/hooks/useGroupMembership";

/** The hook that reads the members and owners of a group. The page passes the real one, the fixture route a fake, so the rows do not need the workload provider. */
export type UseMembership = (groupId: string | undefined) => GroupMembershipState;

const MembershipContext = createContext<UseMembership | null>(null);

export function MembershipProvider({ useMembership, children }: { useMembership: UseMembership; children: ReactNode }) {
    return <MembershipContext.Provider value={useMembership}>{children}</MembershipContext.Provider>;
}

export function useMembershipHook(): UseMembership {
    const hook = useContext(MembershipContext);
    if (!hook) throw new Error("useMembershipHook must be used within a MembershipProvider");
    return hook;
}
