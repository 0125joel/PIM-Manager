/** The view the Azure Report opens in when the URL has no `view`. The settings page and the Azure Report read the same key. */
export const AZURE_REPORT_VIEW_STORAGE_KEY = "azure-report-view";

export type AzureReportViewPreference = "roles" | "assignments";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function parseAzureReportView(value: string | null | undefined): AzureReportViewPreference | null {
    return value === "roles" || value === "assignments" ? value : null;
}

export function readAzureReportView(storage: StorageLike | null = typeof localStorage === "undefined" ? null : localStorage): AzureReportViewPreference {
    try {
        return parseAzureReportView(storage?.getItem(AZURE_REPORT_VIEW_STORAGE_KEY)) ?? "roles";
    } catch {
        return "roles";
    }
}

export function writeAzureReportView(view: AzureReportViewPreference, storage: StorageLike | null = typeof localStorage === "undefined" ? null : localStorage): boolean {
    try {
        storage?.setItem(AZURE_REPORT_VIEW_STORAGE_KEY, view);
        return storage !== null;
    } catch {
        return false;
    }
}
