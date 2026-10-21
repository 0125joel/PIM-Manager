/** Same-tab change notification: the browser `storage` event only fires in other tabs. */
export const WORKLOAD_STATE_EVENT = "pim-workload-state-change";

export function notifyWorkloadStateChange(): void {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new Event(WORKLOAD_STATE_EVENT));
}

/**
 * Per-browser flags of the workloads: feature enablement (security alerts) and visibility (hidden by the user).
 * Moved out of the removed settings modal; same storage keys, same change notification.
 */

const FEATURE_STORAGE_PREFIX = "pim_feature_enabled_";
const VISIBILITY_STORAGE_PREFIX = "pim_visibility_";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): StorageLike | null {
    try {
        return typeof localStorage === "undefined" ? null : localStorage;
    } catch {
        return null;
    }
}

export function isFeatureEnabled(featureId: string, storage: StorageLike | null = defaultStorage()): boolean {
    try {
        return storage?.getItem(`${FEATURE_STORAGE_PREFIX}${featureId}`) === "true";
    } catch {
        return false;
    }
}

export function setFeatureEnabled(featureId: string, enabled: boolean, storage: StorageLike | null = defaultStorage()): void {
    if (!storage) return;
    try {
        if (enabled) storage.setItem(`${FEATURE_STORAGE_PREFIX}${featureId}`, "true");
        else storage.removeItem(`${FEATURE_STORAGE_PREFIX}${featureId}`);
    } catch {
        return;
    }
    notifyWorkloadStateChange();
}

/** Visible unless explicitly hidden. */
export function isWorkloadVisible(workloadId: string, storage: StorageLike | null = defaultStorage()): boolean {
    try {
        return storage?.getItem(`${VISIBILITY_STORAGE_PREFIX}${workloadId}`) !== "false";
    } catch {
        return true;
    }
}

export function setWorkloadVisible(workloadId: string, visible: boolean, storage: StorageLike | null = defaultStorage()): void {
    if (!storage) return;
    try {
        if (visible) storage.removeItem(`${VISIBILITY_STORAGE_PREFIX}${workloadId}`);
        else storage.setItem(`${VISIBILITY_STORAGE_PREFIX}${workloadId}`, "false");
    } catch {
        return;
    }
    notifyWorkloadStateChange();
}
