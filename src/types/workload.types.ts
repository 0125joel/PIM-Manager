export type WorkloadType =
    | "directoryRoles"
    | "pimGroups"
    | "intune"
    | "exchange"
    | "sharepoint"
    | "defender";

/** Subset of workloads supported by the Configure feature */
export type ConfigureWorkloadType = "directoryRoles" | "pimGroups";

export type LoadingPhase =
    | "idle"
    | "consent"
    | "fetching"
    | "processing"
    | "policies"    // Added for PIM for Groups policy loading
    | "complete"
    | "error";

export interface WorkloadLoadingState {
    phase: LoadingPhase;
    progress: {
        current: number;
        total: number;
    };
    message: string;
    error?: string;
    /** Progress of the blocking phase as a percentage, 0 to 100 */
    percent?: number;
    /**
     * Work that continues after the blocking phase (Directory Roles reads one policy per role). The data is already
     * shown while this runs; `progress` is its own count.
     */
    background?: {
        running: boolean;
        progress: { current: number; total: number };
    };
}

export interface WorkloadConsentState {
    consented: boolean;
    consentedAt?: string; // ISO date string
}

/** `X` is what a workload keeps next to its items (for Directory Roles the authentication contexts and failed roles). */
export interface WorkloadState<T, X = undefined> {
    workload: WorkloadType;
    data: T[];
    extras: X;
    loading: WorkloadLoadingState;
    consent: WorkloadConsentState;
    lastFetched?: string; // ISO date string
}

export interface WorkloadLink {
    workload: WorkloadType;
    roleName: string;
    linkType: "member" | "owner" | "assigned";
}
