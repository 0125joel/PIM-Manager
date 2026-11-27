"use client";

import { useEffect, useState } from "react";
import { useAzureActions } from "@/contexts/AzureContext";
import { useUnifiedActions } from "@/contexts/UnifiedPimContext";
import { WORKLOAD_SCOPES } from "@/hooks/useIncrementalConsent";
import { usePimGroupsConsented } from "@/hooks/usePimSelectors";
import { listMyAssignments, listMyEligibilities } from "@/services/azureAssignmentService";
import { lookupPrincipals } from "@/services/principalLookupService";
import { fetchMyGroupInstances } from "@/services/writeAccessService";
import { getErrorStatusCode } from "@/utils/errorUtils";
import { Logger } from "@/utils/logger";
import { toMyRoleRow, type MyAzureRoleRow, type MyAzureRolesState } from "@/utils/azureReportStates";
import { myGroupPaths, type MyGroupPathsState } from "@/utils/myGroupPaths";

/**
 * The signed-in user's own active and eligible Azure roles, asked at root scope with `asTarget()` (Azure spec 8 and
 * 15.5), only while `isEnabled`. Null while it reads, "failed" when either read failed, so the empty state can say so
 * instead of showing nothing.
 *
 * `asTarget()` does not return the Azure role of a group the user is only an eligible member of (measured 2026-11-13),
 * so with PIM for Groups consented the eligible group memberships are read as well, with the read scope that workload
 * already has. A failed group read never fails the Azure roles: it shows as its own state.
 */
export function useMyAzureRoles(isEnabled: boolean): MyAzureRolesState {
    const { getArmClient } = useAzureActions();
    const { getGraphClient } = useUnifiedActions();
    const groupsConsented = usePimGroupsConsented();
    const [roles, setRoles] = useState<{ active: MyAzureRoleRow[]; eligible: MyAzureRoleRow[] } | "failed" | null>(null);
    const [groupRead, setGroupRead] = useState<MyGroupPathsState | null>(null);

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

    useEffect(() => {
        if (!isEnabled || !groupsConsented) return;
        const controller = new AbortController();
        void (async () => {
            try {
                // The workload's read scope, as the access check asks for it (useWriteAccess)
                const client = await getGraphClient(WORKLOAD_SCOPES.pimGroups);
                if (controller.signal.aborted) return;
                const [eligible, active] = await Promise.all([fetchMyGroupInstances(client, "eligibility", controller.signal), fetchMyGroupInstances(client, "assignment", controller.signal)]);
                const ids = myGroupPaths(eligible, active, new Map()).map((path) => path.groupId);
                const index = ids.length > 0 ? await lookupPrincipals(client, { ids, upns: [] }, controller.signal) : null;
                if (controller.signal.aborted) return;
                const names = new Map<string, string>();
                for (const [id, ref] of index?.byId ?? []) names.set(id, ref.displayName);
                setGroupRead({ kind: "listed", groups: myGroupPaths(eligible, active, names) });
            } catch (error: unknown) {
                if (controller.signal.aborted) return;
                setGroupRead({ kind: "failed" });
                Logger.warn("Azure", `Your PIM group memberships could not be read (${getErrorStatusCode(error) ?? "no status"})`);
            }
        })();
        return () => controller.abort();
    }, [isEnabled, groupsConsented, getGraphClient]);

    if (!isEnabled || roles === null) return null;
    if (roles === "failed") return "failed";
    if (!groupsConsented) return { ...roles, groups: { kind: "noConsent" } };
    // The group read is still running: the Azure roles wait for it, so the section does not change under the user's eyes
    if (groupRead === null) return null;
    return { ...roles, groups: groupRead };
}
