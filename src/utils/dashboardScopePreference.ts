import type { DashboardScope } from "@/utils/dashboardAdvanced";

/** The Privileged roles or All roles choice of the Advanced dashboard (spec 4.1), saved in this browser. */
export const DASHBOARD_SCOPE_STORAGE_KEY = "dashboard-scope";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function parseDashboardScope(value: string | null | undefined): DashboardScope {
    return value === "all" ? "all" : "privileged";
}

export function readDashboardScope(storage: StorageLike | null = typeof localStorage === "undefined" ? null : localStorage, key: string = DASHBOARD_SCOPE_STORAGE_KEY): DashboardScope {
    try {
        return parseDashboardScope(storage?.getItem(key));
    } catch {
        return "privileged";
    }
}

export function writeDashboardScope(scope: DashboardScope, storage: StorageLike | null = typeof localStorage === "undefined" ? null : localStorage, key: string = DASHBOARD_SCOPE_STORAGE_KEY): boolean {
    try {
        storage?.setItem(key, scope);
        return storage !== null;
    } catch {
        return false;
    }
}
