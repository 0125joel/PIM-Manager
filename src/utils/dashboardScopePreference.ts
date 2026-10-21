import type { DashboardScope } from "@/utils/dashboardAdvanced";

/** The Privileged roles or All roles choice of the Advanced dashboard (spec 4.1), saved in this browser. */
export const DASHBOARD_SCOPE_STORAGE_KEY = "dashboard-scope";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function parseDashboardScope(value: string | null | undefined): DashboardScope {
    return value === "all" ? "all" : "privileged";
}

export function readDashboardScope(storage: StorageLike | null = typeof localStorage === "undefined" ? null : localStorage): DashboardScope {
    try {
        return parseDashboardScope(storage?.getItem(DASHBOARD_SCOPE_STORAGE_KEY));
    } catch {
        return "privileged";
    }
}

export function writeDashboardScope(scope: DashboardScope, storage: StorageLike | null = typeof localStorage === "undefined" ? null : localStorage): boolean {
    try {
        storage?.setItem(DASHBOARD_SCOPE_STORAGE_KEY, scope);
        return storage !== null;
    } catch {
        return false;
    }
}
