"use client";

import { useEffect, useMemo, useState } from "react";
import { useMsal } from "@azure/msal-react";
import type { RoleDetailData } from "@/types/directoryRole.types";
import type { PimGroupData } from "@/types/pimGroup.types";
import { useGraphClient } from "@/hooks/usePimSelectors";
import { fetchBlueprintNames } from "@/services/agentBlueprintService";
import { collectBlueprintAppIds, readBlueprintCache, writeBlueprintCache } from "@/utils/agentBlueprints";
import { isAbortError } from "@/utils/errorUtils";
import { Logger } from "@/utils/logger";

const sessionStore = (): Storage | null => {
    try {
        return typeof sessionStorage === "undefined" ? null : sessionStorage;
    } catch {
        return null;
    }
};

/** Blueprint ids asked for during this page load, found or not: never asked twice */
const asked = new Set<string>();

/** Blueprint names by lower-case appId for the agents in the loaded data (AG-5); empty until known, never throws. */
export function useAgentBlueprintNames(roles: readonly RoleDetailData[], groups: readonly PimGroupData[]): ReadonlyMap<string, string> {
    const getClient = useGraphClient();
    const { accounts } = useMsal();
    const tenantId = accounts[0]?.tenantId ?? "";
    const appIds = useMemo(() => collectBlueprintAppIds(roles, groups), [roles, groups]);
    const [cachedNames, setCachedNames] = useState(() => ({
        tenantId,
        names: readBlueprintCache(tenantId, sessionStore()),
    }));
    const names = cachedNames.tenantId === tenantId ? cachedNames.names : readBlueprintCache(tenantId, sessionStore());

    useEffect(() => {
        if (!tenantId) return;
        const cached = readBlueprintCache(tenantId, sessionStore());
        const missing = appIds.filter((id) => !cached.has(id) && !asked.has(id));
        if (missing.length === 0) return;
        missing.forEach((id) => asked.add(id));
        const controller = new AbortController();
        void (async () => {
            const client = await getClient();
            const found = await fetchBlueprintNames(client, missing, controller.signal);
            if (found.size === 0) return;
            const next = new Map([...readBlueprintCache(tenantId, sessionStore()), ...found]);
            writeBlueprintCache(tenantId, next, sessionStore());
            setCachedNames({ tenantId, names: next });
        })().catch((error: unknown) => {
            if (isAbortError(error)) {
                missing.forEach((id) => asked.delete(id));
                return;
            }
            Logger.warn("agentBlueprint", "Reading blueprint names failed:", error);
        });
        return () => controller.abort();
    }, [appIds, tenantId, getClient]);

    return names;
}
