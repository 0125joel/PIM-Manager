/**
 * "Show more details" (calm details spec 2.1 and 2.2). The setting in Settings > Display says how the Dashboard and the
 * Report open; with "fewer" each page and view remembers its own choice. Only "fewer", "more", "1" and "0" are stored.
 */
export const DETAILS_STORAGE_KEY = "details-preference";

export type DetailsPreference = "fewer" | "more";

/** The six pages and views that remember their own choice */
export const DETAILS_PAGES = ["entra-dashboard-basic", "entra-dashboard-advanced", "entra-report", "azure-dashboard-basic", "azure-dashboard-advanced", "azure-report"] as const;

export type DetailsPage = (typeof DETAILS_PAGES)[number];

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const defaultStorage = (): StorageLike | null => (typeof localStorage === "undefined" ? null : localStorage);

export function detailsPageKey(page: DetailsPage): string {
    return `details-${page}`;
}

export function parseDetailsPreference(value: string | null | undefined): DetailsPreference | null {
    return value === "fewer" || value === "more" ? value : null;
}

export function readDetailsPreference(storage: StorageLike | null = defaultStorage()): DetailsPreference {
    try {
        return parseDetailsPreference(storage?.getItem(DETAILS_STORAGE_KEY)) ?? "fewer";
    } catch {
        return "fewer";
    }
}

/** Writes the setting and clears the six page choices, so every page starts again from the new setting */
export function writeDetailsPreference(value: DetailsPreference, storage: StorageLike | null = defaultStorage()): boolean {
    try {
        storage?.setItem(DETAILS_STORAGE_KEY, value);
        clearPageDetails(storage);
        return storage !== null;
    } catch {
        return false;
    }
}

/** The remembered choice of one page: true when its details are shown. Missing, unknown or unreadable: false */
export function readPageDetails(page: DetailsPage, storage: StorageLike | null = defaultStorage()): boolean {
    try {
        return storage?.getItem(detailsPageKey(page)) === "1";
    } catch {
        return false;
    }
}

export function writePageDetails(page: DetailsPage, isDetailed: boolean, storage: StorageLike | null = defaultStorage()): boolean {
    try {
        storage?.setItem(detailsPageKey(page), isDetailed ? "1" : "0");
        return storage !== null;
    } catch {
        return false;
    }
}

export function clearPageDetails(storage: StorageLike | null = defaultStorage()): void {
    try {
        for (const page of DETAILS_PAGES) storage?.removeItem(detailsPageKey(page));
    } catch {
        // without storage there is nothing to clear
    }
}

/** What a page shows: with "more" everything and no checkbox; with "fewer" its own choice */
export function resolveDetails(preference: DetailsPreference, pageChoice: boolean): { isDetailed: boolean; canToggle: boolean } {
    return preference === "more" ? { isDetailed: true, canToggle: false } : { isDetailed: pageChoice, canToggle: true };
}
