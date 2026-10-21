"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { DashboardScope } from "@/utils/dashboardAdvanced";
import { DASHBOARD_SCOPE_STORAGE_KEY, readDashboardScope, writeDashboardScope } from "@/utils/dashboardScopePreference";

const CHANGE_EVENT = "pim-dashboard-scope-change";

function subscribe(onChange: () => void) {
    const onStorage = (event: StorageEvent) => {
        if (event.key === null || event.key === DASHBOARD_SCOPE_STORAGE_KEY) onChange();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => {
        window.removeEventListener("storage", onStorage);
        window.removeEventListener(CHANGE_EVENT, onChange);
    };
}

/** Privileged roles or All roles for the Advanced dashboard, saved in localStorage; `privileged` until read. */
export function useDashboardScope(): [DashboardScope, (scope: DashboardScope) => void] {
    const scope = useSyncExternalStore(subscribe, () => readDashboardScope(), () => "privileged" as DashboardScope);
    const setScope = useCallback((next: DashboardScope) => {
        writeDashboardScope(next);
        window.dispatchEvent(new Event(CHANGE_EVENT));
    }, []);
    return [scope, setScope];
}
