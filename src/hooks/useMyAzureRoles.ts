"use client";

import { useEffect, useState } from "react";
import { useAzureActions } from "@/contexts/AzureContext";
import { listMyAssignments, listMyEligibilities } from "@/services/azureAssignmentService";
import { getErrorStatusCode } from "@/utils/errorUtils";
import { Logger } from "@/utils/logger";
import { toMyRoleRow, type MyAzureRolesState } from "@/utils/azureReportStates";

/**
 * The signed-in user's own active and eligible Azure roles, asked at root scope with `asTarget()` (Azure spec 8 and
 * 15.5), only while `isEnabled`. Null while it reads, "failed" when either read failed, so the empty state can say so
 * instead of showing nothing.
 */
export function useMyAzureRoles(isEnabled: boolean): MyAzureRolesState {
    const { getArmClient } = useAzureActions();
    const [roles, setRoles] = useState<MyAzureRolesState>(null);

    useEffect(() => {
        if (!isEnabled) return;
        const controller = new AbortController();
        const client = getArmClient();
        // Two fixed calls, read together
        Promise.all([listMyAssignments(client, controller.signal), listMyEligibilities(client, controller.signal)])
            .then(([active, eligible]) => {
                if (!controller.signal.aborted) setRoles({ active: active.map(toMyRoleRow), eligible: eligible.map(toMyRoleRow) });
            })
            .catch((error: unknown) => {
                if (controller.signal.aborted) return;
                setRoles("failed");
                Logger.warn("Azure", `Your own Azure roles could not be read (${getErrorStatusCode(error) ?? "no status"})`);
            });
        return () => controller.abort();
    }, [isEnabled, getArmClient]);

    return isEnabled ? roles : null;
}
