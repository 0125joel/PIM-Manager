/**
 * The schedule requests of the Configure write path (spec 13.1), shared by the dry run of the pre-flight (NG-57,
 * `isValidationOnly`) and the apply engine (NG-58). Pure: it builds `url` and `body`, the caller sends them. Every
 * request is v1.0, removals included.
 *
 * Start: absent for "when applied" (Graph uses the time of the request; a start in the past is set to now, T6, T7a),
 * the chosen date otherwise; never a start in the future the admin did not choose (T8). End: `afterDateTime` with
 * `endDateTime`, or `noExpiration`.
 */
import type { AssignmentType, BasketAdd, BasketRemove, BasketUpdate, Target } from "@/types/configure.types";

export const SCHEDULE_REQUEST_PATHS = {
    role: {
        eligible: "/roleManagement/directory/roleEligibilityScheduleRequests",
        active: "/roleManagement/directory/roleAssignmentScheduleRequests",
    },
    group: {
        eligible: "/identityGovernance/privilegedAccess/group/eligibilityScheduleRequests",
        active: "/identityGovernance/privilegedAccess/group/assignmentScheduleRequests",
    },
} as const;

export type ScheduleAction = "adminAssign" | "adminUpdate" | "adminExtend" | "adminRenew" | "adminRemove";

export interface ScheduleRequest {
    url: string;
    version: "v1.0";
    body: Record<string, unknown>;
}

export interface ScheduleRequestInput {
    action: ScheduleAction;
    target: Target;
    principalId: string;
    type: AssignmentType;
    /** `directoryScopeId` for roles; ignored for groups */
    scope: string;
    /** ISO date time, or null for "when applied"; not sent for a removal */
    start?: string | null;
    /** ISO date time, or null for no end; not sent for a removal */
    end?: string | null;
    justification?: string;
    /** The dry run: Microsoft checks the request and writes nothing */
    isValidationOnly?: boolean;
}

/** The `scheduleInfo` of a request that sets an end */
export function scheduleInfoOf(start: string | null | undefined, end: string | null | undefined): Record<string, unknown> {
    return {
        ...(start ? { startDateTime: start } : {}),
        expiration: end ? { type: "afterDateTime", endDateTime: end } : { type: "noExpiration" },
    };
}

export function buildScheduleRequest(input: ScheduleRequestInput): ScheduleRequest {
    const { action, target, principalId, type } = input;
    const url = target.kind === "role" ? SCHEDULE_REQUEST_PATHS.role[type] : SCHEDULE_REQUEST_PATHS.group[type];
    const body: Record<string, unknown> = { action, principalId };
    if (target.kind === "role") {
        body.roleDefinitionId = target.id;
        body.directoryScopeId = input.scope || "/";
    } else {
        body.groupId = target.id;
        body.accessId = target.access;
    }
    if (input.justification) body.justification = input.justification;
    if (action !== "adminRemove") body.scheduleInfo = scheduleInfoOf(input.start, input.end);
    if (input.isValidationOnly) body.isValidationOnly = true;
    return { url, version: "v1.0", body };
}

/** The request of a basket change: an add is `adminAssign`, an update its own action, a removal `adminRemove` */
export function requestForChange(change: BasketAdd | BasketUpdate | BasketRemove, options: { isValidationOnly?: boolean } = {}): ScheduleRequest {
    if (change.kind === "add") {
        return buildScheduleRequest({
            action: "adminAssign",
            target: change.target,
            principalId: change.principal.id,
            type: change.type,
            scope: change.scope,
            start: change.start,
            end: change.end,
            justification: change.justification,
            ...options,
        });
    }
    if (change.kind === "update") {
        return buildScheduleRequest({
            action: change.action,
            target: change.target,
            principalId: change.schedule.principal.id,
            type: change.schedule.type,
            scope: change.schedule.scope,
            // The start as read, so a change of end never moves the start (T8: a scheduled assignment keeps its start)
            start: change.schedule.start ?? null,
            end: change.end,
            justification: change.justification,
            ...options,
        });
    }
    return buildScheduleRequest({
        action: "adminRemove",
        target: change.target,
        principalId: change.schedule.principal.id,
        type: change.schedule.type,
        scope: change.schedule.scope,
        ...options,
    });
}
