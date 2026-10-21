/** The "What's new" row shows a dot until the user has opened it for the running version. */
export const WHATS_NEW_STORAGE_KEY = "pim-whats-new-seen";

export function isWhatsNewUnseen(currentVersion: string | undefined | null, seenVersion: string | null | undefined): boolean {
    if (!currentVersion) return false;
    return currentVersion !== seenVersion;
}
