import type { MaxDurationBucket } from "@/types/dashboardFilter.types";

/**
 * Pure predicates on role schedules, shared by the dashboard stats, the Easy to miss rows and the
 * dashboard filter, so a number and the list behind it always use one definition (spec 4.4).
 */

interface ScheduleLike {
    assignmentType?: string;
    scheduleInfo?: {
        expiration?: { type?: string; endDateTime?: string | null; duration?: string | null } | null;
    } | null;
}

/**
 * No end: expiration type `noExpiration`, or no expiration type and no end date at all
 * (a schedule without schedule info). `afterDuration` without a resolved end date still ends.
 */
export function hasNoEnd(schedule: ScheduleLike): boolean {
    const expiration = schedule.scheduleInfo?.expiration;
    if (expiration?.type === "noExpiration") return true;
    if (expiration?.type) return false;
    return !expiration?.endDateTime;
}

function assignmentTypeOf(schedule: ScheduleLike): string {
    return (schedule.assignmentType ?? "").toLowerCase();
}

/** Active schedule created by an administrator (Assigned) without an end: the "Permanent" card. */
export function isPermanentActive(schedule: ScheduleLike): boolean {
    return assignmentTypeOf(schedule) === "assigned" && hasNoEnd(schedule);
}

/** Active schedule made directly by an administrator, with or without an end (Report `assignment:assigned`). */
export function isAssignedActive(schedule: ScheduleLike): boolean {
    return assignmentTypeOf(schedule) === "assigned";
}

/** Active schedule created by activation of an eligibility: the "Active now" card. */
export function isActivated(schedule: ScheduleLike): boolean {
    return assignmentTypeOf(schedule) === "activated";
}

/** A PIM for Groups instance created by activation of an eligibility (Graph `assignmentType` `activated`): "Active now". */
export function isActivatedGroupAssignment(assignment: { assignmentType: string; assignmentOrigin?: string }): boolean {
    return assignment.assignmentType === "active" && assignment.assignmentOrigin === "activated";
}

/** Any active schedule with an end date, activated or assigned: the time-bound slice of the Who donut. */
export function isTimeBoundActive(schedule: ScheduleLike): boolean {
    return !hasNoEnd(schedule);
}

/** Eligibility without an end: the "Eligible without an end date" row. */
export function isEligibleWithoutEnd(schedule: ScheduleLike): boolean {
    return hasNoEnd(schedule);
}

/**
 * Bucket of the maximum activation duration in hours (spec 4.3): up to 1 h, up to 4 h, up to 8 h, up to 12 h,
 * over 12 h. Every value falls in exactly one bucket, so half hours such as 1.5 h land in the next one.
 * Null for an unknown duration.
 */
export function getMaxDurationBucket(hours: number | null | undefined): MaxDurationBucket | null {
    if (hours === null || hours === undefined || Number.isNaN(hours)) return null;
    if (hours <= 1) return "upTo1h";
    if (hours <= 4) return "upTo4h";
    if (hours <= 8) return "upTo8h";
    if (hours <= 12) return "upTo12h";
    return "over12h";
}

/** The labels of the report panel's maximum duration filter, one per bucket. */
export const MAX_DURATION_PANEL_LABELS: Record<MaxDurationBucket, string> = {
    upTo1h: "<1h",
    upTo4h: "2-4h",
    upTo8h: "5-8h",
    upTo12h: "9-12h",
    over12h: ">12h",
};

/**
 * Entries of the legacy `roleAssignments` list (`assignments.permanent`) that no active schedule covers at the same
 * principal and scope. Microsoft Learn says schedules and instances also hold assignments made directly through the
 * role assignments API, so this is normally empty; an entry it does return is standing access the schedules miss,
 * shown as Permanent, Assigned. Matching any active schedule (also an activation) keeps an activation's own role
 * assignment from coming back as standing access.
 */
export function getUnscheduledRoleAssignments<T extends { principalId: string; directoryScopeId: string }>(assignments: {
    permanent: readonly T[];
    active: ReadonlyArray<{ principalId: string; directoryScopeId?: string }>;
}): T[] {
    const key = (principalId: string, scope: string | undefined) => `${principalId.toLowerCase()}|${scope || "/"}`;
    const scheduled = new Set(assignments.active.map((a) => key(a.principalId, a.directoryScopeId)));
    return assignments.permanent.filter((p) => !scheduled.has(key(p.principalId, p.directoryScopeId)));
}
