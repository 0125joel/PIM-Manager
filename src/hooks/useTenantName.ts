"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useGraphClient } from "@/hooks/usePimSelectors";
import { fetchTenantDisplayName } from "@/services/tenantService";
import { tenantNameCacheKey } from "@/utils/shellNavigation";

const CHANGE_EVENT = "pim-tenant-name-change";

function subscribe(onChange: () => void) {
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => window.removeEventListener(CHANGE_EVENT, onChange);
}

function readCached(tenantId: string | undefined): string | null {
    if (!tenantId) return null;
    try {
        return sessionStorage.getItem(tenantNameCacheKey(tenantId));
    } catch {
        return null;
    }
}

const inFlight = new Set<string>();

/**
 * Tenant display name for the account button, cached in sessionStorage per tenant (the `pim_` prefix means
 * sign-out clears it). Null until known; the shell renders nothing for it in the meantime, so there is no
 * flicker. One request per tenant and session, failures are not retried.
 */
export function useTenantName(tenantId: string | undefined): string | null {
    const getGraphClient = useGraphClient();
    const name = useSyncExternalStore(subscribe, () => readCached(tenantId), () => null);

    useEffect(() => {
        if (!tenantId || name || inFlight.has(tenantId)) return;
        let attempted = false;
        try {
            attempted = sessionStorage.getItem(`${tenantNameCacheKey(tenantId)}_tried`) === "1";
        } catch {
            attempted = false;
        }
        if (attempted) return;

        inFlight.add(tenantId);
        (async () => {
            try {
                const client = await getGraphClient();
                const displayName = await fetchTenantDisplayName(client, tenantId);
                try {
                    sessionStorage.setItem(`${tenantNameCacheKey(tenantId)}_tried`, "1");
                    if (displayName) sessionStorage.setItem(tenantNameCacheKey(tenantId), displayName);
                } catch {
                    // storage unavailable: the name simply stays unknown
                }
                window.dispatchEvent(new Event(CHANGE_EVENT));
            } catch {
                // no token or no consent: remember the attempt so the shell does not keep asking
                try {
                    sessionStorage.setItem(`${tenantNameCacheKey(tenantId)}_tried`, "1");
                } catch {
                    // storage unavailable
                }
            } finally {
                inFlight.delete(tenantId);
            }
        })();
    }, [tenantId, name, getGraphClient]);

    return name;
}
