/** The saved dashboard view (Basic or Advanced). `ViewModeContext` and the settings page read and write the same key. */
export const VIEW_MODE_STORAGE_KEY = "dashboard-view-mode";

export type ViewModePreference = "basic" | "advanced";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function parseViewMode(value: string | null | undefined): ViewModePreference | null {
    return value === "basic" || value === "advanced" ? value : null;
}

export function readViewMode(storage: StorageLike | null = typeof localStorage === "undefined" ? null : localStorage): ViewModePreference | null {
    try {
        return parseViewMode(storage?.getItem(VIEW_MODE_STORAGE_KEY));
    } catch {
        return null;
    }
}

export function writeViewMode(mode: ViewModePreference, storage: StorageLike | null = typeof localStorage === "undefined" ? null : localStorage): boolean {
    try {
        storage?.setItem(VIEW_MODE_STORAGE_KEY, mode);
        return storage !== null;
    } catch {
        return false;
    }
}
