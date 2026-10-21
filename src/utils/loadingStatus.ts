/**
 * Pure helpers behind the one loading language (spec 4.7): a progress line, one status
 * sentence and a "synced N min ago" label. Components only read state and render these.
 */

export interface Progress {
    current: number;
    total: number;
}

export interface LoadingSnapshot {
    /** Directory Roles fast phase (definitions and assignments) */
    rolesLoading: boolean;
    /** Percentage 0 to 100 of the fast phase */
    rolesProgress: number;
    /** Directory Roles background phase (policies per role) */
    policiesLoading: boolean;
    policyProgress: Progress;
    /** PIM for Groups */
    groupsLoading: boolean;
    groupsProgress: Progress | null | undefined;
}

const ROLES_WEIGHT = 0.7;
const GROUPS_WEIGHT = 0.3;

function percent(progress: Progress): number {
    return progress.total > 0 ? (progress.current / progress.total) * 100 : 0;
}

/**
 * Combined progress of every loading workload as a percentage, or null when nothing loads.
 * The fast phase of Directory Roles shows alone; in the background phase roles weigh 70
 * and groups 30, a finished workload counts as complete.
 */
export function combineLoadingProgress(s: LoadingSnapshot): number | null {
    if (s.rolesLoading) return Math.min(100, Math.max(0, s.rolesProgress));
    if (!s.policiesLoading && !s.groupsLoading) return null;

    let weighted = 0;
    let weight = 0;

    if (s.policiesLoading && s.policyProgress.total > 0) {
        weighted += percent(s.policyProgress) * ROLES_WEIGHT;
        weight += ROLES_WEIGHT;
    } else if (!s.policiesLoading) {
        weighted += 100 * ROLES_WEIGHT;
        weight += ROLES_WEIGHT;
    }

    if (s.groupsLoading && s.groupsProgress && s.groupsProgress.total > 0) {
        weighted += percent(s.groupsProgress) * GROUPS_WEIGHT;
        weight += GROUPS_WEIGHT;
    } else if (!s.groupsLoading) {
        weighted += 100 * GROUPS_WEIGHT;
        weight += GROUPS_WEIGHT;
    }

    return weight > 0 ? Math.min(100, weighted / weight) : 0;
}

/** The single status sentence for the page, or null when nothing loads. */
export function buildLoadingSentence(s: LoadingSnapshot, subject: "numbers" | "settings" = "numbers"): string | null {
    // The dashboard waits with numbers, the Report with settings (spec 7.2 of each)
    const placeholder = subject === "numbers" ? "Numbers that need them show a placeholder until they arrive." : "Settings show a placeholder until they arrive.";
    const parts: string[] = [];

    // Before the fast phase is done the skeletons and the progress line carry the state; no spinner (spec 4.7)
    if (!s.rolesLoading && s.policiesLoading) {
        parts.push(
            s.policyProgress.total > 0
                ? `Loading role settings, ${s.policyProgress.current} of ${s.policyProgress.total}. ${placeholder}`
                : `Loading role settings. ${placeholder}`,
        );
    }

    if (s.groupsLoading) {
        parts.push(
            s.groupsProgress && s.groupsProgress.total > 0
                ? `Loading PIM for Groups, ${s.groupsProgress.current} of ${s.groupsProgress.total}.`
                : "Loading PIM for Groups.",
        );
    }

    return parts.length > 0 ? parts.join(" ") : null;
}

/** "synced just now", "synced 12 min ago", "synced 3 h ago", "synced 2 d ago". */
export function formatSyncedAgo(syncedAt: Date, now: Date): string {
    const minutes = Math.floor((now.getTime() - syncedAt.getTime()) / 60000);
    if (minutes < 1) return "synced just now";
    if (minutes < 60) return `synced ${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `synced ${hours} h ago`;
    return `synced ${Math.floor(hours / 24)} d ago`;
}
