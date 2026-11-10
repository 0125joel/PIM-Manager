"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { DashboardScope } from "@/utils/dashboardAdvanced";
import { DASHBOARD_SCOPE_STORAGE_KEY, readDashboardScope, writeDashboardScope } from "@/utils/dashboardScopePreference";

const CHANGE_EVENT = "pim-dashboard-scope-change";

function subscribeTo(storageKey: string) {
    return function subscribe(onChange: () => void) {
        const onStorage = (event: StorageEvent) => {
            if (event.key === null || event.key === storageKey) onChange();
        };
        window.addEventListener("storage", onStorage);
        window.addEventListener(CHANGE_EVENT, onChange);
        return () => {
            window.removeEventListener("storage", onStorage);
            window.removeEventListener(CHANGE_EVENT, onChange);
        };
    };
}

/** Privileged roles or All roles for the Advanced dashboard, saved in localStorage; `privileged` until read. */
export function useDashboardScope(storageKey: string = DASHBOARD_SCOPE_STORAGE_KEY): [DashboardScope, (scope: DashboardScope) => void] {
    const subscribe = useMemo(() => subscribeTo(storageKey), [storageKey]);
    const scope = useSyncExternalStore(subscribe, () => readDashboardScope(undefined, storageKey), () => "privileged" as DashboardScope);
    const setScope = useCallback((next: DashboardScope) => {
        writeDashboardScope(next, undefined, storageKey);
        window.dispatchEvent(new Event(CHANGE_EVENT));
    }, [storageKey]);
    return [scope, setScope];
}
