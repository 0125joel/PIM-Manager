/**
 * Pure rules behind the settings page's permission table (spec 3.6): what a silent token probe result means for a cell,
 * which action a row offers. A probe that fails for another reason than a missing consent is `unknown`, never "not granted".
 */

export type ProbeResult = "granted" | "notGranted" | "unknown";

export type CellStatus = "checking" | "granted" | "notGranted" | "unknown" | "readOnly" | "needsLicence";

export type RowAction = "grantRead" | "grantWrite" | "retry" | null;

const CONSENT_ERROR_CODES = new Set(["interaction_required", "consent_required", "login_required"]);

/** MSAL errors carry `errorCode`; an `InteractionRequiredAuthError` means the user has not consented (yet). */
export function classifyProbeError(error: unknown): Exclude<ProbeResult, "granted"> {
    if (error && typeof error === "object") {
        const candidate = error as { errorCode?: unknown; name?: unknown };
        if (candidate.name === "InteractionRequiredAuthError") return "notGranted";
        if (typeof candidate.errorCode === "string" && CONSENT_ERROR_CODES.has(candidate.errorCode)) return "notGranted";
    }
    return "unknown";
}

/** Read cell for a workload probed with a silent request. */
export function readCell(probe: ProbeResult | "checking"): CellStatus {
    return probe;
}

/**
 * Write cell: the probe is authoritative; only when it could not tell (unknown) the stored flag of an earlier grant counts.
 */
export function writeCell(probe: ProbeResult | "checking", storedFlag: boolean): CellStatus {
    if (probe === "checking") return "checking";
    if (probe === "unknown") return storedFlag ? "granted" : "unknown";
    return probe;
}

export type CustomExtensionStatus = "checking" | "noConsent" | "granted" | "forbidden";

export function customExtensionCell(status: CustomExtensionStatus): CellStatus {
    switch (status) {
        case "granted":
            return "granted";
        case "forbidden":
            return "needsLicence";
        case "noConsent":
            return "notGranted";
        default:
            return "checking";
    }
}

/** One action per row: read first, then write; a cell that could not be read offers a retry. */
export function rowAction(read: CellStatus, write: CellStatus): RowAction {
    if (read === "notGranted") return "grantRead";
    if (write === "notGranted") return "grantWrite";
    if (read === "unknown" || write === "unknown") return "retry";
    return null;
}

export function cellLabel(status: CellStatus): string {
    switch (status) {
        case "granted":
            return "Granted";
        case "notGranted":
            return "Not granted";
        case "unknown":
            return "Could not check";
        case "readOnly":
            return "Read only";
        case "needsLicence":
            return "Needs Entra ID Governance or Entra Suite";
        default:
            return "Checking";
    }
}
