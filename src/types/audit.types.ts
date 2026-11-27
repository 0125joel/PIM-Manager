// Entra audit model (implementation spec section 1) and the raw directoryAudits row the mapper reads.
// Only the fields the mapper reads are typed here; anything else in a Graph row never enters the app.

import type { AzureScopeLevel } from "@/types/azureResource.types";

export type AuditKind = "usage" | "assignment" | "setting" | "outside" | "system";
export type AuditEnvironment = "role" | "group";
export type AuditResult = "success" | "failure";
export type AuditSource = "graph" | "workspace" | "arm" | "activity-log" | "azure-workspace";
/** How the optional read of the Entra audit log next to the Azure sources went */
export type AzureEntraLogState = "read" | "no permission" | "no token" | "no reader role" | "too many" | "failed";

/** Who did it: a person from the directory, or a system (an app, or a directory service without a user). Missing values are empty strings. */
export interface AuditActor {
    name: string;
    id: string;
    kind: "person" | "system";
    /** A person from outside the tenant: `#EXT#` in the user principal name the log gives */
    isGuest?: boolean;
}

/** A named object: the affected person, the group behind a role, or a role. Missing values are empty strings. */
export interface AuditObject {
    name: string;
    id: string;
}

export interface AuditEvent {
    id: string;
    /** ISO 8601 in UTC */
    time: string;
    kind: AuditKind;
    environment: AuditEnvironment;
    /** The sentence the list and the export show */
    sentence: string;
    actor: AuditActor;
    target?: AuditObject;
    /** The target is a group, as in an assignment to a group: its name stays when names are replaced, as other group names do */
    targetIsGroup?: boolean;
    /** The target is an app: the log gives a service principal, an agent identity and a blueprint the type `ServicePrincipal` (measured) */
    targetIsApp?: boolean;
    /** The target is a guest: `#EXT#` in the user principal name the log gives. The name itself is not kept */
    targetIsGuest?: boolean;
    role: AuditObject;
    scope: string;
    /** The scope the log names for a scoped event (`ScopedResourceOriginId`, such as `/{id}`); absent on a tenant-wide event, which reads as `/` */
    directoryScopeId?: string;
    result: AuditResult;
    /** No completion in the log: waiting for approval, or not yet logged. Never told as done */
    requestOnly?: boolean;
    failureReason?: string;
    reason?: string;
    /** Ticket number with its system, from `TicketNumber` and `TicketSystem` on the request and the completion (measured) */
    ticket?: string;
    /** Who decided an approval: the initiator of the approved or denied event (measured). `denied` says which of the two */
    approver?: string;
    /** The approver denied the request. Its result is `failure`, so Failed or denied finds it, but it is never told as a failure */
    denied?: boolean;
    /** Azure only: the request had an approval (a non-empty `approvalId`). It only says a decision exists, not who made it */
    hadApproval?: boolean;
    /** The UpdatePolicy text as logged, not parsed */
    newValue?: string;
    requestedDuration?: number;
    /** When an assignment ends, ISO 8601 in UTC; only for an assignment with an end in the log */
    endsAt?: string;
    usedMinutes?: number;
    /** When a request with a later start took effect, ISO 8601 in UTC: a scheduled activation, or an assignment that started after its request (AU-17). Absent when it took effect at once. */
    startsAt?: string;
    /** Whole minutes from the request to the approver's decision, on an event that went through approval (AU-17) */
    decidedAfterMinutes?: number;
    endedBy?: AuditActor;
    endedAt?: string;
    mfa?: boolean;
    source: AuditSource;
    /** The Log Analytics workspace the event was read from (its name, else its id); on `source: "workspace"` (Entra) and `source: "azure-workspace"` (Azure). Not a person, so a name-free export keeps it. */
    workspace?: string;
    correlationId: string;
    /** Azure only: the scope as the tree knows it. Absent when the scope is above the tree's levels or not recognised, then `scope` only */
    azure?: { scopeId: string; scopeName: string; scopeLevel: AzureScopeLevel; subscriptionId: string };
    /** The name of the group an activation came through, when that group holds a role */
    viaGroup?: string;
    /** Entra only: the roles the group of `viaGroup` holds today, which the activation gave the person */
    groupRoles?: string[];
    /** Azure only: the last segment of `linkedRoleEligibilityScheduleId`, in lower case: the eligibility the activation used */
    eligibilityId?: string;
    /** Azure only: the ARM request type of an event read from a request list, such as `AdminAssign` or `AdminExtend` */
    requestType?: string;
}

export interface RawModifiedProperty {
    displayName?: string | null;
    oldValue?: string | null;
    newValue?: string | null;
}

export interface RawAuditTarget {
    type?: string | null;
    id?: string | null;
    displayName?: string | null;
    userPrincipalName?: string | null;
    modifiedProperties?: RawModifiedProperty[] | null;
}

export interface RawAuditDetail {
    key: string;
    value?: string | null;
}

/** One row of GET /auditLogs/directoryAudits, with only the fields the mapper reads */
export interface RawDirectoryAudit {
    id: string;
    category: string;
    correlationId: string;
    result: string;
    resultReason?: string | null;
    activityDisplayName: string;
    activityDateTime: string;
    loggedByService: string;
    initiatedBy: {
        user?: { id?: string | null; displayName?: string | null; userPrincipalName?: string | null } | null;
        app?: { displayName?: string | null } | null;
    };
    targetResources: RawAuditTarget[];
    additionalDetails: RawAuditDetail[];
}

/** One request of the ARM role assignment or eligibility schedule requests, with only the fields the mapper reads */
export interface RawArmRequest {
    id: string;
    name: string;
    properties: {
        scope?: string | null;
        roleDefinitionId?: string | null;
        principalId?: string | null;
        principalType?: string | null;
        requestorId?: string | null;
        requestType?: string | null;
        status?: string | null;
        createdOn?: string | null;
        justification?: string | null;
        ticketInfo?: { ticketNumber?: string | null; ticketSystem?: string | null } | null;
        scheduleInfo?: { startDateTime?: string | null; expiration?: { duration?: string | null; endDateTime?: string | null } | null } | null;
        linkedRoleEligibilityScheduleId?: string | null;
        /** A path that ends in the request `name` with approval, absent without approval (measured). Read as non-empty only; it does not enter the model */
        approvalId?: string | null;
        expandedProperties?: {
            principal?: { displayName?: string | null; userPrincipalName?: string | null } | null;
            roleDefinition?: { displayName?: string | null } | null;
        } | null;
    };
}

/** One Activity Log row, with only the fields the mapper reads */
export interface RawActivityEvent {
    eventDataId?: string | null;
    correlationId?: string | null;
    eventTimestamp?: string | null;
    caller?: string | null;
    resourceId?: string | null;
    subscriptionId?: string | null;
    operationName?: { value?: string | null } | null;
    status?: { value?: string | null } | null;
    /** Only `appid` is read; every other claim stays out */
    claims?: { appid?: string | null } | null;
    /** `requestbody`, `responseBody` and `statusMessage` are JSON text */
    properties?: { requestbody?: string | null; responseBody?: string | null; statusMessage?: string | null } | null;
}
