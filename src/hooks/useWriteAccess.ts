"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMsal } from "@azure/msal-react";
import { useUnifiedActions, useUnifiedData, useUnifiedLoading } from "@/contexts/UnifiedPimContext";
import { WORKLOAD_SCOPES, WORKLOAD_WRITE_SCOPES, isWriteConsentGranted } from "@/hooks/useIncrementalConsent";
import {
    fetchAdministrativeUnitGroups,
    fetchMyActiveRoles,
    fetchMyEligibleRoles,
    fetchMyGroupInstances,
    fetchMyOwnedGroups,
    fetchScopedGroup,
} from "@/services/writeAccessService";
import type { PimGroupData } from "@/types/pimGroup.types";
import type { RoleDetailData } from "@/types/directoryRole.types";
import type { WorkloadType } from "@/types/workload.types";
import { isAccessCheckReady } from "@/utils/accessCheckReadiness";
import { classifyProbeError } from "@/utils/permissionStatus";
import { getErrorMessage } from "@/utils/errorUtils";
import { Logger } from "@/utils/logger";
import { deriveWriteAccess, groupRoleAssignments, scopesToRead, type GroupLike, type MyGroupInstance, type OwnedGroupRead, type PermissionState, type RoleDefinitionLike, type WriteAccess, type WriteAccessReads } from "@/utils/writeAccess";

export type WriteAccessStatus = "waiting" | "checking" | "ready" | "failed";

export interface WriteAccessState {
    status: WriteAccessStatus;
    access: WriteAccess | null;
    /** When the reads behind `access` were done */
    checkedAt: Date | null;
    error: string | null;
    /** Reads again (Refresh, entering the review, right before the first write); resolves with the new decision */
    recheck: () => Promise<WriteAccess | null>;
}

/**
 * Who may change what (spec 3): reads the admin's own roles and groups once the core load is done (or failed), with
 * scopes the app has, and decides per area and group with `deriveWriteAccess`. The decision follows the loaded roles
 * and groups without reading again; `recheck()` reads again. Reads again by itself when PIM for Groups consent arrives.
 * An eligible PIM membership counts through the roles its group holds active in the loaded roles.
 */
/** The last check of this page load, shared by the pages that mount the hook (N-020) */
let shared: { key: string; reads: WriteAccessReads; checkedAt: Date } | null = null;
const SHARED_FOR_MS = 10 * 60_000;
function rememberCheck(key: string, reads: WriteAccessReads, checkedAt: Date): void {
    shared = { key, reads, checkedAt };
}
function recallCheck(key: string): { reads: WriteAccessReads; checkedAt: Date } | null {
    return shared && shared.key === key && Date.now() - shared.checkedAt.getTime() < SHARED_FOR_MS ? shared : null;
}

export function useWriteAccess(): WriteAccessState {
    const { instance, accounts } = useMsal();
    const account = accounts[0];
    const { getGraphClient } = useUnifiedActions();
    const { workloads, isWorkloadConsented } = useUnifiedData();
    const loading = useUnifiedLoading();
    const roles = workloads.directoryRoles.data as RoleDetailData[];
    const groupData = workloads.pimGroups.data as PimGroupData[];
    const groupsConsented = isWorkloadConsented("pimGroups");
    // Starts with the fast phase of Directory Roles, not after the policies (FIX-13, utils/accessCheckReadiness.ts)
    const coreDone = isAccessCheckReady({ phase: loading.workloads.directoryRoles?.phase, loadedRoles: roles.length });

    const sharedKey = account?.homeAccountId ? `${account.homeAccountId}|${groupsConsented ? "groups" : "roles"}` : null;
    const sharedKeyRef = useRef(sharedKey);
    useEffect(() => { sharedKeyRef.current = sharedKey; }, [sharedKey]);
    // A check of the last minutes is taken over when another page mounts (N-020): Report and Dashboard only need it for
    // "Change in Configure"; Configure reads it again on Refresh, entering the review and before the first write
    const [recalled] = useState(() => (sharedKey ? recallCheck(sharedKey) : null));
    const [reads, setReads] = useState<WriteAccessReads | null>(recalled?.reads ?? null);
    const [status, setStatus] = useState<WriteAccessStatus>(recalled ? "ready" : "waiting");
    const [checkedAt, setCheckedAt] = useState<Date | null>(recalled?.checkedAt ?? null);
    const [error, setError] = useState<string | null>(null);
    const started = useRef<string | null>(null);
    const runId = useRef(0);

    const definitions = useMemo<RoleDefinitionLike[]>(() => roles.map((r) => r.definition), [roles]);
    const groups = useMemo<GroupLike[]>(() => groupData.map((g) => ({
        id: g.group.id,
        displayName: g.group.displayName,
        isAssignableToRole: g.group.isAssignableToRole ?? null,
        membershipRule: g.group.membershipRule ?? null,
        onPremisesSyncEnabled: g.group.onPremisesSyncEnabled ?? null,
        isManagementRestricted: g.group.isManagementRestricted ?? null,
        isUnderPim: g.isManaged !== false,
    })), [groupData]);
    // Read from callbacks without changing their identity on every background policy batch
    const latest = useRef({ definitions, groups, roles });
    useEffect(() => { latest.current = { definitions, groups, roles }; }, [definitions, groups, roles]);

    const probe = useCallback(async (workload: WorkloadType): Promise<PermissionState> => {
        if (!account) return "unknown";
        try {
            await instance.acquireTokenSilent({ scopes: WORKLOAD_WRITE_SCOPES[workload], account });
            return "granted";
        } catch (e: unknown) {
            const result = classifyProbeError(e);
            // A probe that could not decide falls back to the grant the app stored, as the settings page does
            return result === "unknown" && isWriteConsentGranted(workload) ? "granted" : result;
        }
    }, [instance, account]);

    const read = useCallback(async (): Promise<WriteAccessReads | null> => {
        const id = ++runId.current;
        setStatus("checking");
        setError(null);
        try {
            const client = await getGraphClient();
            const groupReads = async (kind: "eligibility" | "assignment"): Promise<MyGroupInstance[]> => {
                if (!groupsConsented) return [];
                try {
                    return await fetchMyGroupInstances(await getGraphClient(WORKLOAD_SCOPES.pimGroups), kind);
                } catch (e: unknown) {
                    // Without the group scope these lists are not read; ownership from /me/ownedObjects still counts
                    Logger.warn("WriteAccess", `PIM for Groups ${kind} of the admin not read`, e);
                    return [];
                }
            };
            const [activeRoles, eligibleRoles, ownedGroups, groupActive, groupEligible] = await Promise.all([
                fetchMyActiveRoles(client),
                fetchMyEligibleRoles(client),
                fetchMyOwnedGroups(client),
                groupReads("assignment"),
                groupReads("eligibility"),
            ]);
            // Roles held through an eligible membership count too, so their units and groups are read as well
            const members = groupEligible.filter((i) => i.accessId.toLowerCase() === "member").map((i) => i.groupId);
            const throughGroups = Object.values(groupRoleAssignments(latest.current.roles, members)).flat();
            const scopes = scopesToRead([...activeRoles, ...eligibleRoles, ...throughGroups], latest.current.definitions);
            const administrativeUnitGroups: Record<string, OwnedGroupRead[]> = {};
            for (const unit of scopes.units) administrativeUnitGroups[unit] = await fetchAdministrativeUnitGroups(client, unit);
            const scopedGroups: OwnedGroupRead[] = [];
            for (const groupId of scopes.groups) {
                const group = await fetchScopedGroup(client, groupId);
                if (group) scopedGroups.push(group);
            }
            const appPermission = { directoryRoles: await probe("directoryRoles"), pimGroups: await probe("pimGroups") };
            const next: WriteAccessReads = { activeRoles, eligibleRoles, ownedGroups, groupActive, groupEligible, administrativeUnitGroups, scopedGroups, appPermission };
            // A newer read started meanwhile: its answer wins
            if (id !== runId.current) return next;
            const at = new Date();
            setReads(next);
            setCheckedAt(at);
            setStatus("ready");
            if (sharedKeyRef.current) rememberCheck(sharedKeyRef.current, next, at);
            return next;
        } catch (e: unknown) {
            Logger.error("WriteAccess", "Could not check the admin's roles", e);
            if (id === runId.current) {
                setError(getErrorMessage(e));
                setStatus("failed");
            }
            return null;
        }
    }, [getGraphClient, groupsConsented, probe]);

    useEffect(() => {
        const key = sharedKey;
        if (!key || !coreDone || started.current === key) return;
        started.current = key;
        if (recalled && recalled === recallCheck(key)) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- starts the reads once the core load is done (spec 3.3)
        void read();
    }, [sharedKey, coreDone, read, recalled]);

    // Groups the admin is an eligible PIM member of, with the roles they hold active (from the loaded roles)
    const memberGroupIds = useMemo(() => (reads?.groupEligible ?? []).filter((i) => i.accessId.toLowerCase() === "member").map((i) => i.groupId), [reads]);
    const rolesOfGroups = useMemo(() => groupRoleAssignments(roles, memberGroupIds), [roles, memberGroupIds]);
    const access = useMemo(() => (reads ? deriveWriteAccess({ ...reads, roleDefinitions: definitions, groups, rolesOfGroups }) : null), [reads, definitions, groups, rolesOfGroups]);

    const recheck = useCallback(async () => {
        const next = await read();
        if (!next) return null;
        const { definitions: roleDefinitions, groups: loadedGroups, roles: loadedRoles } = latest.current;
        const members = next.groupEligible.filter((i) => i.accessId.toLowerCase() === "member").map((i) => i.groupId);
        return deriveWriteAccess({ ...next, roleDefinitions, groups: loadedGroups, rolesOfGroups: groupRoleAssignments(loadedRoles, members) });
    }, [read]);

    return { status, access, checkedAt, error, recheck };
}
