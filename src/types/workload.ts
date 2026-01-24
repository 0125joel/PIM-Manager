export type WorkloadType =
    | "directoryRoles"
    | "pimGroups"
    | "intune"
    | "exchange"
    | "sharepoint"
    | "defender";

export type LoadingPhase =
    | "idle"
    | "consent"
    | "fetching"
    | "processing"
    | "policies"    // Added for PIM Groups policy loading
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
}

export interface WorkloadConsentState {
    consented: boolean;
    consentedAt?: string; // ISO date string
}

export interface WorkloadState<T> {
    workload: WorkloadType;
    data: T[];
    loading: WorkloadLoadingState;
    consent: WorkloadConsentState;
    lastFetched?: string; // ISO date string
}

export interface WorkloadLink {
    workload: WorkloadType;
    roleName: string;
    linkType: "member" | "owner" | "assigned";
}
