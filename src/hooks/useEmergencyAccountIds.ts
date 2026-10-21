"use client";

import { useEmergencyAccounts } from "@/hooks/useEmergencyAccounts";

/**
 * Principal ids (lowercase) marked as emergency access accounts in this browser for the signed-in tenant
 * (spec 3.6, 5.7). One stable set per stored value, so it is safe in memo dependencies. The dashboard filter
 * and the report read it here, so `excludeEmergency` means the same in both.
 */
export function useEmergencyAccountIds(): ReadonlySet<string> {
    return useEmergencyAccounts().ids;
}
