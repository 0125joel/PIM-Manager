import { describe, it, expect } from "vitest";
import {
    MS_PIM_APP_ID,
    applyApprovers,
    buildAzureHolderKinds,
    expandGroupActivations,
    hasUnnamedRole,
    mapAzureAuditEvents,
    toRawActivityEvent,
    toRawArmRequest,
    type AzureAuditContext,
} from "@/utils/azureAuditEvents";
import { auditHolderOf, isEmergencyEvent, matchesAuditWho } from "@/utils/auditView";
import { AUDIT_EXPORT_SOURCE_LABEL } from "@/utils/auditExportPlan";
import type { AuditEvent, RawActivityEvent, RawArmRequest, RawDirectoryAudit } from "@/types/audit.types";

// Invented data only: Contoso names, .example domains, made-up ids.
const S1 = "/subscriptions/s-1";
const RG = `${S1}/resourceGroups/rg-1`;
const READER = "acdd72a7-3385-48ef-bd42-f606fba81ae7";
const roleDef = (guid: string) => `${S1}/providers/Microsoft.Authorization/roleDefinitions/${guid}`;
const T = (hms: string) => `2026-11-01T${hms}Z`;
const WRITE_OP = "Microsoft.Authorization/roleAssignments/write";
const DELETE_OP = "Microsoft.Authorization/roleAssignments/delete";

function ctx(extra: Partial<AzureAuditContext> = {}): AzureAuditContext {
    const scopes: Record<string, string> = { [S1]: "Contoso Production" };
    const principals: Record<string, string> = { "u-1": "Megan Bowen", "u-admin": "Alex Wilber", "u-2": "Adele Vance" };
    return {
        scopeName: (id) => scopes[id],
        roleName: (guid) => (guid.toLowerCase() === READER ? "Reader" : undefined),
        principalName: (id) => principals[id],
        eligibilities: [],
        ...extra,
    };
}

interface ReqSpec {
    name: string;
    type: string;
    at?: string;
    status?: string;
    principal?: string;
    principalType?: string;
    requestor?: string;
    role?: string;
    scope?: string;
    approvalId?: string;
    linked?: string;
    ticketNumber?: string;
    ticketSystem?: string;
    duration?: string;
    start?: string;
    endsAt?: string;
    principalName?: string;
    justification?: string;
}

function req(spec: ReqSpec): RawArmRequest {
    const principal = spec.principal ?? "u-1";
    return {
        id: `${S1}/providers/Microsoft.Authorization/roleAssignmentScheduleRequests/${spec.name}`,
        name: spec.name,
        properties: {
            scope: spec.scope ?? RG,
            roleDefinitionId: roleDef(spec.role ?? READER),
            principalId: principal,
            principalType: spec.principalType ?? "User",
            requestorId: spec.requestor ?? principal,
            requestType: spec.type,
            status: spec.status ?? "Provisioned",
            createdOn: spec.at ?? T("10:00:00"),
            justification: spec.justification,
            // With approval the id is a path that ends in the request name; without approval the property is absent
            ...(spec.approvalId ? { approvalId: `/providers/Microsoft.Authorization/roleAssignmentApprovals/${spec.approvalId}` } : {}),
            linkedRoleEligibilityScheduleId: spec.linked,
            ticketInfo: spec.ticketNumber === undefined ? undefined : { ticketNumber: spec.ticketNumber, ticketSystem: spec.ticketSystem },
            scheduleInfo: spec.duration === undefined && spec.start === undefined && spec.endsAt === undefined
                ? undefined
                : { startDateTime: spec.start, expiration: { duration: spec.duration, endDateTime: spec.endsAt } },
            expandedProperties: spec.principalName ? { principal: { displayName: spec.principalName } } : undefined,
        },
    };
}

interface ActSpec {
    id: string;
    corr: string;
    at: string;
    op: string;
    status: string;
    caller?: string;
    resource?: string;
    app?: string;
    request?: string;
    response?: string;
    message?: string;
}

function act(spec: ActSpec): RawActivityEvent {
    return {
        eventDataId: spec.id,
        correlationId: spec.corr,
        eventTimestamp: T(spec.at),
        caller: spec.caller ?? "9b2f0000-0000-0000-0000-000000000001",
        resourceId: spec.resource ?? `${RG}/providers/Microsoft.Authorization/roleAssignments/ra-${spec.corr}`,
        operationName: { value: spec.op },
        status: { value: spec.status },
        claims: spec.app ? { appid: spec.app } : undefined,
        properties: { requestbody: spec.request, responseBody: spec.response, statusMessage: spec.message },
    };
}

const pimBody = (principal: string, scope = RG) => JSON.stringify({ Properties: { PrincipalId: principal, RoleDefinitionId: roleDef(READER), Scope: scope } });
const otherBody = (principal: string) => JSON.stringify({ properties: { principalId: principal, roleDefinitionId: roleDef(READER) } });
const deleteBody = (principal: string, scope = RG) => JSON.stringify({ properties: { principalId: principal, roleDefinitionId: roleDef(READER), scope } });

/** A write by PIM: Started with the names, then Succeeded one second later */
function pimWrite(corr: string, at: string, endAt: string, principal = "u-1"): RawActivityEvent[] {
    return [
        act({ id: `${corr}-a`, corr, at, op: WRITE_OP, status: "Started", app: MS_PIM_APP_ID, request: pimBody(principal) }),
        act({ id: `${corr}-b`, corr, at: endAt, op: WRITE_OP, status: "Succeeded", app: MS_PIM_APP_ID }),
    ];
}

/** A delete by PIM: Started without a body, Succeeded with the response body */
function pimDelete(corr: string, at: string, endAt: string, principal = "u-1"): RawActivityEvent[] {
    return [
        act({ id: `${corr}-a`, corr, at, op: DELETE_OP, status: "Started", app: MS_PIM_APP_ID }),
        act({ id: `${corr}-b`, corr, at: endAt, op: DELETE_OP, status: "Succeeded", app: MS_PIM_APP_ID, response: deleteBody(principal) }),
    ];
}

function run(assignmentRequests: RawArmRequest[], activity: RawActivityEvent[] = [], eligibilityRequests: RawArmRequest[] = [], context = ctx()): AuditEvent[] {
    return mapAzureAuditEvents({ assignmentRequests, eligibilityRequests, activity, context });
}

describe("allow list", () => {
    it("keeps claims, addresses and the app id out of the output", () => {
        const raw: RawActivityEvent = {
            eventDataId: "E-1",
            correlationId: "C-1",
            eventTimestamp: "2026-11-01T10:00:02Z",
            caller: "9b2f0000-0000-0000-0000-000000000001",
            resourceId: `${RG}/providers/Microsoft.Authorization/roleAssignments/RA-1`,
            subscriptionId: "s-1",
            operationName: { value: WRITE_OP },
            status: { value: "Started" },
            claims: { appid: MS_PIM_APP_ID, name: "SECRET-NAME", ipaddr: "203.0.113.5" } as RawActivityEvent["claims"],
            properties: { requestbody: pimBody("u-1") },
        };
        (raw as unknown as Record<string, unknown>).httpRequest = { clientIpAddress: "203.0.113.5" };
        const out = JSON.stringify(run([], [raw]));
        expect(out).not.toContain("SECRET-NAME");
        expect(out).not.toContain("203.0.113.5");
        expect(out).not.toContain(MS_PIM_APP_ID);
        expect(out).not.toContain("approvalId");
    });
});

describe("requests: kind, status and sentences", () => {
    it.each([
        ["SelfActivate", "usage"], ["SelfExtend", "usage"], ["SelfRenew", "usage"],
        ["AdminAssign", "assignment"], ["AdminRemove", "assignment"], ["AdminUpdate", "assignment"], ["AdminExtend", "assignment"], ["AdminRenew", "assignment"],
        ["SomethingNew", "system"],
    ])("%s is %s", (type, kind) => {
        expect(run([req({ name: "r1", type })])[0].kind).toBe(kind);
    });

    it("takes AdminAssign from both lists", () => {
        const events = run([req({ name: "r1", type: "AdminAssign" })], [], [req({ name: "r2", type: "AdminAssign", at: T("11:00:00") })]);
        expect(events.map((event) => event.sentence)).toEqual([
            "Megan Bowen made eligible for Reader on rg-1",
            "Megan Bowen made active for Reader on rg-1",
        ]);
    });

    it.each(["Provisioned", "Granted", "Revoked"])("status %s is a success", (status) => {
        const event = run([req({ name: "r1", type: "SelfActivate", status })])[0];
        expect(event.result).toBe("success");
        expect(event.requestOnly).toBeUndefined();
    });

    it.each(["Denied", "AdminDenied"])("status %s is denied", (status) => {
        const event = run([req({ name: "r1", type: "SelfActivate", status })])[0];
        expect(event.result).toBe("failure");
        expect(event.denied).toBe(true);
        expect(event.sentence).toBe("Activation of Reader on rg-1 by Megan Bowen denied");
    });

    it.each(["Failed", "FailedAsResourceIsLocked", "TimedOut", "Canceled"])("status %s is a failure with its word", (status) => {
        const event = run([req({ name: "r1", type: "SelfActivate", status })])[0];
        expect(event.result).toBe("failure");
        expect(event.failureReason).toBe(status);
        expect(event.denied).toBeUndefined();
        expect(event.sentence).toBe("Activation of Reader on rg-1 by Megan Bowen failed");
    });

    it.each(["PendingApproval", "", "SomethingElse"])("status '%s' is only requested", (status) => {
        const event = run([req({ name: "r1", type: "SelfActivate", status })])[0];
        expect(event.result).toBe("success");
        expect(event.requestOnly).toBe(true);
        expect(event.sentence).toBe("Megan Bowen requested activation of Reader on rg-1");
    });

    it("tells the sentences of the other types", () => {
        const sentence = (type: string, status = "Provisioned", list: "a" | "e" = "a") => {
            const row = req({ name: "r1", type, status });
            return (list === "a" ? run([row]) : run([], [], [row]))[0].sentence;
        };
        expect(sentence("SelfExtend")).toBe("Megan Bowen extended Reader on rg-1");
        expect(sentence("SelfRenew")).toBe("Megan Bowen renewed Reader on rg-1");
        expect(sentence("SelfExtend", "PendingApproval")).toBe("Megan Bowen requested extension of Reader on rg-1");
        expect(sentence("SelfRenew", "PendingApproval")).toBe("Megan Bowen requested renewal of Reader on rg-1");
        expect(sentence("SelfExtend", "Denied")).toBe("Extension of Reader on rg-1 by Megan Bowen denied");
        expect(sentence("SelfRenew", "Failed")).toBe("Renewal of Reader on rg-1 by Megan Bowen failed");
        expect(sentence("AdminRemove")).toBe("Megan Bowen removed as active from Reader on rg-1");
        expect(sentence("AdminRemove", "Provisioned", "e")).toBe("Megan Bowen removed as eligible from Reader on rg-1");
        expect(sentence("AdminUpdate")).toBe("Assignment of Megan Bowen for Reader on rg-1 updated");
        expect(sentence("AdminExtend")).toBe("Assignment of Megan Bowen for Reader on rg-1 extended");
        expect(sentence("AdminRenew")).toBe("Assignment of Megan Bowen for Reader on rg-1 renewed");
        expect(sentence("AdminAssign", "PendingApproval")).toBe("Assignment of Megan Bowen for Reader on rg-1 requested");
        expect(sentence("AdminAssign", "Denied")).toBe("Assignment of Megan Bowen for Reader on rg-1 denied");
        expect(sentence("AdminExtend", "Failed")).toBe("Assignment of Megan Bowen for Reader on rg-1 failed");
        expect(sentence("SomethingNew")).toBe("SomethingNew request for Reader on rg-1");
    });

    it("names a group target and keeps it a group", () => {
        const events = run([], [], [req({ name: "r1", type: "AdminAssign", principal: "g-1", principalType: "GroupSecurityNotEnabled", principalName: "Contoso Admins" })]);
        expect(events[0].sentence).toBe("Contoso Admins added as eligible to Reader on rg-1");
        expect(events[0].targetIsGroup).toBe(true);
        const active = run([req({ name: "r2", type: "AdminAssign", principal: "g-1", principalType: "Group", principalName: "Contoso Admins" })]);
        expect(active[0].sentence).toBe("Contoso Admins added as active to Reader on rg-1");
    });

    it("keeps an admin as requestor of an app's assignment a person, and the app itself a system", () => {
        const byAdmin = run([req({ name: "r1", type: "AdminAssign", principal: "sp-1", principalType: "ServicePrincipal", requestor: "u-admin", principalName: "Contoso App" })])[0];
        expect(byAdmin.actor).toEqual({ name: "Alex Wilber", id: "u-admin", kind: "person" });
        expect(byAdmin.targetIsApp).toBe(true);
        expect(byAdmin.sentence).toBe("Contoso App made active for Reader on rg-1");
        const byApp = run([req({ name: "r2", type: "AdminAssign", principal: "sp-1", principalType: "ServicePrincipal", requestor: "SP-1", principalName: "Contoso App" })])[0];
        expect(byApp.actor).toEqual({ name: "Contoso App", id: "SP-1", kind: "system" });
    });

    it("falls back from the row to the context to the id", () => {
        const known = run([req({ name: "r1", type: "SelfActivate", principalName: "Megan B." })])[0];
        expect(known.sentence).toBe("Megan B. activated Reader on rg-1");
        const unknown = run([req({ name: "r2", type: "SelfActivate", principal: "u-9", role: "11111111-2222-3333-4444-555555555555" })])[0];
        expect(unknown.sentence).toBe("u-9 activated 11111111-2222-3333-4444-555555555555 on rg-1");
    });

    it("counts a request seen from two lists once", () => {
        const events = run([req({ name: "REQ-1", type: "SelfActivate" })], [], [req({ name: "req-1", type: "SelfActivate" })]);
        expect(events).toHaveLength(1);
        expect(events[0].id).toBe("req-1");
        expect(events[0].correlationId).toBe("req-1");
        expect(events[0].source).toBe("arm");
    });

    it("keeps a row without a valid time, last", () => {
        const events = run([req({ name: "r1", type: "SelfActivate", at: "not a time" }), req({ name: "r2", type: "SelfActivate", at: T("09:00:00") })]);
        expect(events.map((event) => event.id)).toEqual(["r2", "r1"]);
        expect(events[1].time).toBe("");
    });

    it("sorts newest first", () => {
        const events = run([req({ name: "r1", type: "SelfActivate", at: T("09:00:00") }), req({ name: "r2", type: "SelfActivate", at: T("11:00:00") })]);
        expect(events.map((event) => event.id)).toEqual(["r2", "r1"]);
    });

    it("keeps the ticket as typed, and reads the duration", () => {
        const event = run([req({ name: "r1", type: "SelfActivate", ticketNumber: "INC-1 ", ticketSystem: "", duration: "PT1H" })])[0];
        expect(event.ticket).toBe("INC-1 ");
        expect(event.requestedDuration).toBe(60);
        const withSystem = run([req({ name: "r2", type: "SelfActivate", ticketNumber: "INC-2", ticketSystem: "ServiceNow" })])[0];
        expect(withSystem.ticket).toBe("INC-2 (ServiceNow)");
        expect(run([req({ name: "r3", type: "SelfActivate", duration: "PT0S" })])[0].requestedDuration).toBeUndefined();
        expect(run([req({ name: "r4", type: "SelfActivate", duration: "soon" })])[0].requestedDuration).toBeUndefined();
    });

    it("names the scope: context, last segment, and Root", () => {
        const sub = run([req({ name: "r1", type: "SelfActivate", scope: S1 })])[0];
        expect(sub.scope).toBe("Contoso Production");
        expect(sub.azure).toEqual({ scopeId: S1, scopeName: "Contoso Production", scopeLevel: "subscription", subscriptionId: "s-1" });
        const rg = run([req({ name: "r2", type: "SelfActivate" })])[0];
        expect(rg.azure).toEqual({ scopeId: RG, scopeName: "rg-1", scopeLevel: "resourceGroup", subscriptionId: "s-1" });
        const root = run([req({ name: "r3", type: "SelfActivate", scope: "/" })])[0];
        expect(root.scope).toBe("Root");
        expect(root.azure).toEqual({ scopeId: "/", scopeName: "Root", scopeLevel: "root", subscriptionId: "" });
        const unknown = run([req({ name: "r4", type: "SelfActivate", scope: "/something/else" })])[0];
        expect(unknown.scope).toBe("else");
        expect(unknown.azure).toBeUndefined();
    });

    it("sets the group an activation came through, and not for a user's eligibility", () => {
        const eligibilities = [
            { id: `${S1}/providers/Microsoft.Authorization/roleEligibilitySchedules/ES-1`, principalId: "g-1", principalType: "Group", principalName: "Contoso Admins" },
            { id: `${S1}/providers/Microsoft.Authorization/roleEligibilitySchedules/ES-2`, principalId: "u-1", principalType: "User", principalName: "Megan Bowen" },
        ];
        const context = ctx({ eligibilities });
        const viaGroup = run([req({ name: "r1", type: "SelfActivate", linked: `${S1}/providers/Microsoft.Authorization/roleEligibilitySchedules/es-1` })], [], [], context)[0];
        expect(viaGroup.viaGroup).toBe("Contoso Admins");
        expect(viaGroup.target?.name).toBe("Megan Bowen");
        const viaUser = run([req({ name: "r2", type: "SelfActivate", linked: `${S1}/providers/Microsoft.Authorization/roleEligibilitySchedules/ES-2` })], [], [], context)[0];
        expect(viaUser.viaGroup).toBeUndefined();
    });
});

describe("Activity Log operations", () => {
    it("tells outside PIM from PIM on the same operation", () => {
        const outside = [
            act({ id: "o1", corr: "co", at: "09:00:00", op: WRITE_OP, status: "Started", caller: "alex@contoso.example", app: "00000000-aaaa-bbbb-cccc-000000000000", request: otherBody("u-1") }),
            act({ id: "o2", corr: "co", at: "09:00:01", op: WRITE_OP, status: "Succeeded", caller: "alex@contoso.example", app: "00000000-aaaa-bbbb-cccc-000000000000" }),
        ];
        const events = run([], [...outside, ...pimWrite("cp", "09:30:00", "09:30:01")]);
        expect(events.map((event) => [event.kind, event.sentence])).toEqual([
            ["system", "Megan Bowen added to Reader on rg-1 by PIM"],
            ["outside", "Megan Bowen given Reader on rg-1 outside PIM"],
        ]);
        expect(events[1].actor).toEqual({ name: "alex@contoso.example", id: "alex@contoso.example", kind: "person" });
        expect(events[0].actor.kind).toBe("system");
        expect(events[1].source).toBe("activity-log");
    });

    it("tells an outside delete from its response body", () => {
        const rows = [
            act({ id: "d1", corr: "cd", at: "09:00:00", op: DELETE_OP, status: "Started", caller: "alex@contoso.example", app: "other-app" }),
            act({ id: "d2", corr: "cd", at: "09:00:01", op: DELETE_OP, status: "Succeeded", caller: "alex@contoso.example", app: "other-app", response: deleteBody("u-1"), resource: `${S1}/providers/Microsoft.Authorization/roleAssignments/ra-1` }),
        ];
        const [event] = run([], rows);
        expect(event.sentence).toBe("Megan Bowen removed from Reader on rg-1 outside PIM");
        expect(event.azure?.scopeLevel).toBe("resourceGroup");
        expect(event.id).toBe("d2");
    });

    it("gives no row for a request write", () => {
        const rows = ["roleAssignmentScheduleRequests", "roleEligibilityScheduleRequests"].map((kind, index) => act({
            id: `w${index}`, corr: `cw${index}`, at: "09:00:00", op: `Microsoft.Authorization/${kind}/write`, status: "Succeeded",
        }));
        expect(run([], rows)).toEqual([]);
    });

    it("tells unknown operations as system, with a GUID apart", () => {
        const rows = [
            act({ id: "x1", corr: "cx1", at: "09:00:00", op: "Microsoft.Authorization/locks/write", status: "Succeeded" }),
            act({ id: "x2", corr: "cx2", at: "09:01:00", op: "Microsoft.Authorization/11111111-2222-3333-4444-555555555555/write", status: "Succeeded" }),
        ];
        const events = run([], rows);
        expect(events.map((event) => [event.kind, event.sentence])).toEqual([
            ["system", "Other Azure authorization operation"],
            ["system", "Azure operation Microsoft.Authorization/locks/write"],
        ]);
    });

    it("merges Started with Succeeded, and shows Started alone as not completed", () => {
        const merged = run([], [
            act({ id: "M-1", corr: "cm", at: "09:00:00", op: "Microsoft.Authorization/locks/write", status: "Started" }),
            act({ id: "M-2", corr: "cm", at: "09:00:02", op: "Microsoft.Authorization/locks/write", status: "Succeeded" }),
        ]);
        expect(merged).toHaveLength(1);
        expect(merged[0].id).toBe("m-2");
        expect(merged[0].time).toBe("2026-11-01T09:00:02.000Z");
        expect(merged[0].requestOnly).toBeUndefined();
        const alone = run([], [act({ id: "A-1", corr: "ca", at: "09:00:00", op: "Microsoft.Authorization/locks/write", status: "Started" })]);
        expect(alone[0].requestOnly).toBe(true);
        expect(alone[0].id).toBe("a-1");
        expect(alone[0].sentence).toBe("Not completed: Azure operation Microsoft.Authorization/locks/write");
    });

    it("merges nothing for an empty correlation id", () => {
        const rows = ["a", "b"].map((id) => act({ id, corr: "", at: "09:00:00", op: "Microsoft.Authorization/locks/write", status: "Succeeded" }));
        expect(run([], rows)).toHaveLength(2);
    });

    it("shows Failed with its reason and prefix", () => {
        const rows = [
            act({ id: "f1", corr: "cf", at: "09:00:00", op: WRITE_OP, status: "Started", caller: "alex@contoso.example", app: "other-app", request: otherBody("u-1") }),
            act({ id: "f2", corr: "cf", at: "09:00:01", op: WRITE_OP, status: "Failed", caller: "alex@contoso.example", app: "other-app", message: JSON.stringify({ status: "Failed", error: { code: "AuthorizationFailed", message: "No access" } }) }),
        ];
        const [event] = run([], rows);
        expect(event.result).toBe("failure");
        expect(event.failureReason).toBe("AuthorizationFailed: No access");
        expect(event.sentence).toBe("Failed: Megan Bowen given Reader on rg-1 outside PIM");
        const onlyCode = run([], [act({ id: "f3", corr: "cf3", at: "09:00:01", op: "Microsoft.Authorization/locks/write", status: "Failed", response: JSON.stringify({ error: { code: "Conflict" } }) })]);
        expect(onlyCode[0].failureReason).toBe("Conflict");
    });

    it("prefixes an outside event that did not complete", () => {
        const [event] = run([], [act({ id: "n1", corr: "cn", at: "09:00:00", op: WRITE_OP, status: "Started", caller: "alex@contoso.example", app: "other-app", request: otherBody("u-1") })]);
        expect(event.sentence).toBe("Not completed: Megan Bowen given Reader on rg-1 outside PIM");
        expect(event.requestOnly).toBe(true);
    });

    it("reads both casings of a body, and survives malformed JSON and a missing resource id", () => {
        const upper = run([], [act({ id: "u1", corr: "cu", at: "09:00:00", op: WRITE_OP, status: "Succeeded", app: "other-app", request: pimBody("u-2") })]);
        expect(upper[0].sentence).toBe("Adele Vance given Reader on rg-1 outside PIM");
        const lower = run([], [act({ id: "u0", corr: "cu0", at: "09:00:00", op: WRITE_OP, status: "Succeeded", app: "other-app", request: otherBody("u-2") })]);
        expect(lower[0].sentence).toBe("Adele Vance given Reader on rg-1 outside PIM");
        const rows = [
            act({ id: "u2", corr: "cu2", at: "09:00:00", op: WRITE_OP, status: "Started", app: "other-app", request: "{not json" }),
            act({ id: "u3", corr: "cu2", at: "09:00:01", op: WRITE_OP, status: "Succeeded", app: "other-app", resource: "" }),
        ];
        const [event] = run([], rows);
        expect(event.kind).toBe("outside");
        expect(event.sentence).toBe("Role assignment given on  outside PIM");
        expect(event.scope).toBe("");
        expect(event.azure).toBeUndefined();
    });

    it("names a person's role and scope by id when the context does not know them", () => {
        const [event] = run([], [act({ id: "k1", corr: "ck", at: "09:00:00", op: WRITE_OP, status: "Succeeded", app: "other-app", request: JSON.stringify({ properties: { principalId: "u-9", roleDefinitionId: roleDef("role-9") } }) })], [], ctx());
        expect(event.sentence).toBe("u-9 given role-9 on rg-1 outside PIM");
    });

    it("reads a policy write in both casings, with its scope from the resource id", () => {
        const resource = `${S1}/providers/Microsoft.Authorization/roleManagementPolicies/p1`;
        const op = "Microsoft.Authorization/roleManagementPolicies/write";
        const lower = JSON.stringify({ properties: { rules: [{ id: "Expiration_EndUser_Assignment" }, { id: "Approval_EndUser_Assignment" }] } });
        const upper = JSON.stringify({ Properties: { Rules: [{ id: "Enablement_Admin_Eligibility" }] } });
        const rows = [
            act({ id: "p1", corr: "cp1", at: "09:00:00", op, status: "Started", resource, request: lower }),
            act({ id: "p2", corr: "cp1", at: "09:00:01", op, status: "Succeeded", resource }),
            act({ id: "p3", corr: "cp2", at: "10:00:00", op, status: "Started", resource, request: upper }),
            act({ id: "p4", corr: "cp2", at: "10:00:01", op, status: "Succeeded", resource }),
        ];
        const events = run([], rows);
        expect(events[1].kind).toBe("setting");
        expect(events[1].newValue).toBe("Expiration_EndUser_Assignment,Approval_EndUser_Assignment");
        expect(events[0].newValue).toBe("Enablement_Admin_Eligibility");
        expect(events[1].sentence).toBe("Setting changed on Contoso Production");
        expect(events[1].role).toEqual({ name: "", id: "" });
        expect(events[1].azure).toEqual({ scopeId: S1, scopeName: "Contoso Production", scopeLevel: "subscription", subscriptionId: "s-1" });
    });

    it("tells a custom role change and delete", () => {
        const resource = `${S1}/providers/Microsoft.Authorization/roleDefinitions/cr-1`;
        const rows = [
            act({ id: "c1", corr: "cc1", at: "09:00:00", op: "Microsoft.Authorization/roleDefinitions/write", status: "Started", resource, request: JSON.stringify({ properties: { roleName: "Contoso Custom" } }) }),
            act({ id: "c2", corr: "cc1", at: "09:00:01", op: "Microsoft.Authorization/roleDefinitions/write", status: "Succeeded", resource }),
            act({ id: "c3", corr: "cc2", at: "10:00:01", op: "Microsoft.Authorization/roleDefinitions/delete", status: "Succeeded", resource, response: JSON.stringify({ properties: { roleName: "Contoso Old" } }) }),
        ];
        const events = run([], rows);
        expect(events.map((event) => event.sentence)).toEqual(["Custom role Contoso Old deleted", "Custom role Contoso Custom changed"]);
        expect(events[1].role).toEqual({ name: "Contoso Custom", id: "cr-1" });
        expect(events[1].kind).toBe("setting");
    });
});

describe("links between requests and the log", () => {
    const activation = (extra: Partial<ReqSpec> = {}) => req({ name: "REQ-1", type: "SelfActivate", at: T("10:00:00"), ...extra });

    it("activated and used for, then deactivated with who ended it", () => {
        const events = run(
            [activation(), req({ name: "REQ-2", type: "SelfDeactivate", status: "Revoked", at: T("10:30:00") })],
            [...pimWrite("c1", "10:00:02", "10:00:03"), ...pimDelete("c2", "10:30:02", "10:30:03")],
        );
        expect(events).toHaveLength(1);
        expect(events[0].usedMinutes).toBe(30);
        expect(events[0].endedAt).toBe("2026-11-01T10:30:03.000Z");
        expect(events[0].endedBy).toEqual({ name: "Megan Bowen", id: "u-1", kind: "person" });
        expect(events[0].time).toBe("2026-11-01T10:00:00.000Z");
    });

    it("lets a SelfDeactivate end its activation without a delete in the log", () => {
        const events = run([activation(), req({ name: "REQ-2", type: "SelfDeactivate", status: "Revoked", at: T("10:20:00") })]);
        expect(events).toHaveLength(1);
        expect(events[0].usedMinutes).toBe(20);
        expect(events[0].endedBy?.id).toBe("u-1");
    });

    it("keeps a failed SelfDeactivate as a system row", () => {
        const events = run([activation(), req({ name: "REQ-2", type: "SelfDeactivate", status: "Failed", at: T("10:20:00") })]);
        expect(events).toHaveLength(2);
        expect(events[0].kind).toBe("system");
        expect(events[0].result).toBe("failure");
        expect(events[1].usedMinutes).toBeUndefined();
    });

    it("ends an activation by expiry, without endedBy and without a row", () => {
        const events = run([activation()], [...pimWrite("c1", "10:00:02", "10:00:03"), ...pimDelete("c3", "18:00:00", "18:00:01")]);
        expect(events).toHaveLength(1);
        expect(events[0].usedMinutes).toBe(479);
        expect(events[0].endedAt).toBe("2026-11-01T18:00:01.000Z");
        expect(events[0].endedBy).toBeUndefined();
    });

    it("tells an expiry without its start as a system row", () => {
        const events = run([], pimDelete("c3", "18:00:00", "18:00:01"));
        expect(events).toHaveLength(1);
        expect(events[0].kind).toBe("system");
        expect(events[0].sentence).toBe("Activation of Reader on rg-1 ended");
    });

    it("does not let a second delete end an activation that has ended", () => {
        const events = run(
            [activation(), req({ name: "REQ-2", type: "SelfDeactivate", status: "Revoked", at: T("10:30:00") })],
            [...pimWrite("c1", "10:00:02", "10:00:03"), ...pimDelete("c2", "10:30:02", "10:30:03"), ...pimDelete("c9", "11:00:00", "11:00:01")],
        );
        expect(events).toHaveLength(2);
        expect(events[0].sentence).toBe("Activation of Reader on rg-1 ended");
        expect(events[1].endedBy).toBeDefined();
    });

    it("keeps an MS-PIM delete near an eligibility AdminRemove an expiry", () => {
        const events = run(
            [activation()],
            [...pimWrite("c1", "10:00:02", "10:00:03"), ...pimDelete("c3", "18:00:00", "18:00:01")],
            [req({ name: "REQ-3", type: "AdminRemove", at: T("18:00:00") })],
        );
        const activated = events.find((event) => event.id === "req-1");
        expect(activated?.endedAt).toBe("2026-11-01T18:00:01.000Z");
        expect(events.filter((event) => event.kind === "system")).toHaveLength(0);
        expect(events).toHaveLength(2);
    });

    it("links a delete to an AdminRemove of the assignment list, and makes no row", () => {
        const events = run([req({ name: "REQ-3", type: "AdminRemove", at: T("18:00:00") })], pimDelete("c3", "18:00:00", "18:00:01"));
        expect(events).toHaveLength(1);
        expect(events[0].id).toBe("req-3");
    });

    it("links a write 9 minutes from the request, and not 11", () => {
        const near = run([activation()], pimWrite("c1", "10:09:00", "10:09:01"));
        expect(near).toHaveLength(1);
        const far = run([activation()], pimWrite("c1", "10:11:00", "10:11:01"));
        expect(far).toHaveLength(2);
        expect(far[0].sentence).toBe("Megan Bowen added to Reader on rg-1 by PIM");
    });

    it("links a write only to a request with the same principal, role and scope", () => {
        const events = run([activation({ scope: S1 })], pimWrite("c1", "10:00:02", "10:00:03"));
        expect(events).toHaveLength(2);
    });

    it("links an approval to its write hours later, counting use from the write", () => {
        const approved = activation({ approvalId: "REQ-1" });
        const events = run([approved], [...pimWrite("c1", "13:00:01", "13:00:02"), ...pimDelete("c3", "14:00:00", "14:00:01")]);
        expect(events).toHaveLength(1);
        expect(events[0].time).toBe("2026-11-01T10:00:00.000Z");
        expect(events[0].usedMinutes).toBe(59);
        const withoutWrite = run([approved], pimDelete("c3", "14:00:00", "14:00:01"));
        expect(withoutWrite).toHaveLength(1);
        expect(withoutWrite[0].usedMinutes).toBe(240);
    });

    it("gives two approvals on one principal, role and scope their own write", () => {
        const events = run(
            [activation({ approvalId: "REQ-1" }), req({ name: "REQ-B", type: "SelfActivate", at: T("10:05:00"), approvalId: "REQ-B" })],
            [...pimWrite("c1", "12:00:01", "12:00:02"), ...pimWrite("c2", "15:00:01", "15:00:02")],
        );
        expect(events).toHaveLength(2);
        expect(events.every((event) => event.kind === "usage")).toBe(true);
    });

    it("does not link a write to a request that was not done", () => {
        const events = run([activation({ status: "PendingApproval" })], pimWrite("c1", "10:00:02", "10:00:03"));
        expect(events).toHaveLength(2);
    });
});

describe("applyApprovers", () => {
    function directory(type: string, requestId: string, approver: string, category = "ResourceManagement"): RawDirectoryAudit {
        return {
            id: `d-${requestId}`,
            category,
            correlationId: "dc",
            result: "success",
            activityDisplayName: "Approve",
            activityDateTime: T("10:05:00"),
            loggedByService: "PIM",
            initiatedBy: { user: { id: "u-admin", displayName: approver } },
            targetResources: [],
            additionalDetails: [{ key: "AuditType", value: type }, { key: "RoleAssignmentRequestId", value: requestId }],
        };
    }

    const events = run([
        req({ name: "REQ-1", type: "SelfActivate", status: "PendingApproval", at: T("10:00:00") }),
        req({ name: "REQ-2", type: "SelfActivate", status: "PendingApproval", at: T("09:00:00") }),
    ]);

    it("sets one approver and keeps count and order", () => {
        const out = applyApprovers(events, [directory("ApproveRoleActivation", "req-1", "Alex Wilber")]);
        expect(out.map((event) => event.id)).toEqual(events.map((event) => event.id));
        expect(out[0].approver).toBe("Alex Wilber");
        expect(out[0].result).toBe("success");
        expect(out[0].requestOnly).toBe(true);
        expect(out[1]).toBe(events[1]);
    });

    it("keeps denied and result as they are for a rejection", () => {
        const out = applyApprovers(events, [directory("RejectRoleActivation", "REQ-2", "Alex Wilber")]);
        expect(out[1].approver).toBe("Alex Wilber");
        expect(out[1].denied).toBeUndefined();
    });

    it("ignores other categories and other audit types", () => {
        const out = applyApprovers(events, [
            directory("ApproveRoleActivation", "REQ-1", "Alex Wilber", "RoleManagement"),
            directory("RequestApprovalRoleActivation", "REQ-2", "Alex Wilber"),
        ]);
        expect(out).toEqual(events);
    });
});

describe("expandGroupActivations", () => {
    function groupEvent(extra: Partial<AuditEvent> = {}): AuditEvent {
        return {
            id: "G-1",
            time: "2026-11-01T10:00:00.000Z",
            kind: "usage",
            environment: "group",
            sentence: "Megan Bowen activated member of Contoso Admins",
            actor: { name: "Megan Bowen", id: "u-1", kind: "person" },
            target: { name: "Megan Bowen", id: "u-1" },
            role: { name: "member of Contoso Admins", id: "G-ID-1" },
            scope: "",
            result: "success",
            source: "graph",
            correlationId: "gc-1",
            reason: "Patch run",
            ...extra,
        };
    }
    const holdings = [
        { groupId: "g-id-1", roleId: READER, roleName: "Reader", scopeId: RG },
        { groupId: "g-id-1", roleId: "role-2", roleName: "Contributor", scopeId: S1 },
        { groupId: "g-id-2", roleId: "role-3", roleName: "Owner", scopeId: S1 },
    ];
    const names = { scopeName: ctx().scopeName };

    it("gives one row per holding", () => {
        const rows = expandGroupActivations([groupEvent()], holdings, names);
        expect(rows).toHaveLength(2);
        expect(rows[0].id).toBe(`g-1|${READER}|${RG}`.toLowerCase());
        expect(rows[0].sentence).toBe("Megan Bowen activated Reader on rg-1 through Contoso Admins");
        expect(rows[1].sentence).toBe("Megan Bowen activated Contributor on Contoso Production through Contoso Admins");
        expect(rows[0].role).toEqual({ id: READER, name: "Reader" });
        expect(rows[0].scope).toBe("rg-1");
        expect(rows[1].scope).toBe("Contoso Production");
        expect(rows[0].viaGroup).toBe("Contoso Admins");
        expect(rows[0].azure?.scopeLevel).toBe("resourceGroup");
        expect(rows[0].reason).toBe("Patch run");
        expect(rows[0].environment).toBe("group");
    });

    it("gives no row for an owner, or for what is not an activation or assignment", () => {
        expect(expandGroupActivations([groupEvent({ role: { name: "owner of Contoso Admins", id: "G-ID-1" } })], holdings, names)).toEqual([]);
        expect(expandGroupActivations([groupEvent({ kind: "setting" })], holdings, names)).toEqual([]);
    });

    it("gives an assignment to the group a row per role, under Assignments", () => {
        const rows = expandGroupActivations([groupEvent({ kind: "assignment", sentence: "Megan Bowen made eligible for member of Contoso Admins", actor: { name: "Alex Wilber", id: "u-admin", kind: "person" } })], holdings, names);
        expect(rows).toHaveLength(2);
        expect(rows[0].kind).toBe("assignment");
        expect(rows[0].sentence).toBe("Megan Bowen made eligible for Reader on rg-1 through Contoso Admins");
        expect(rows[0].actor.name).toBe("Alex Wilber");
        expect(rows[0].viaGroup).toBe("Contoso Admins");
        const [removed] = expandGroupActivations([groupEvent({ kind: "assignment", sentence: "Megan Bowen removed from member of Contoso Admins" })], holdings, names);
        expect(removed.sentence).toBe("Megan Bowen removed from Reader on rg-1 through Contoso Admins");
        const [plain] = expandGroupActivations([groupEvent({ kind: "assignment", sentence: "Something the log says" })], holdings, names);
        expect(plain.sentence).toBe("Something the log says: Reader on rg-1 through Contoso Admins");
    });

    it("shows every outcome, as for a direct activation", () => {
        const [waiting] = expandGroupActivations([groupEvent({ requestOnly: true })], holdings, names);
        expect(waiting.sentence).toBe("Megan Bowen requested activation of Reader on rg-1 through Contoso Admins");
        expect(waiting.requestOnly).toBe(true);
        const [failed] = expandGroupActivations([groupEvent({ result: "failure", failureReason: "Timed out" })], holdings, names);
        expect(failed.sentence).toBe("Activation of Reader on rg-1 by Megan Bowen through Contoso Admins failed");
        expect(failed.result).toBe("failure");
        expect(failed.failureReason).toBe("Timed out");
        const [denied] = expandGroupActivations([groupEvent({ result: "failure", denied: true, approver: "Alex Wilber" })], holdings, names);
        expect(denied.sentence).toBe("Activation of Reader on rg-1 by Megan Bowen through Contoso Admins denied");
        expect(denied.denied).toBe(true);
        expect(denied.approver).toBe("Alex Wilber");
    });

    it("keeps all the event tells, so a row through a group reads as a direct one", () => {
        const [row] = expandGroupActivations([groupEvent({ targetIsGuest: true, approver: "Alex Wilber", usedMinutes: 30, requestedDuration: 60, endedAt: "2026-11-01T10:30:00.000Z", mfa: true, directoryScopeId: "/x" })], holdings, names);
        expect(row.targetIsGuest).toBe(true);
        expect(row.approver).toBe("Alex Wilber");
        expect(row.usedMinutes).toBe(30);
        expect(row.requestedDuration).toBe(60);
        expect(row.endedAt).toBe("2026-11-01T10:30:00.000Z");
        expect(auditHolderOf(row)).toBe("guest");
        expect(matchesAuditWho(row, "guest")).toBe(true);
        expect(matchesAuditWho(row, "group")).toBe(true);
        expect(matchesAuditWho(row, "user")).toBe(false);
        expect(row.mfa).toBeUndefined();
        expect(row.directoryScopeId).toBeUndefined();
    });

    it("gives rows when the access is unknown", () => {
        const rows = expandGroupActivations([groupEvent({ role: { name: "Contoso Admins", id: "G-ID-1" } })], holdings, names);
        expect(rows).toHaveLength(2);
        expect(rows[0].viaGroup).toBe("Contoso Admins");
    });

    it("gives no row without a holding", () => {
        expect(expandGroupActivations([groupEvent({ role: { name: "member of Other", id: "g-id-9" } })], holdings, names)).toEqual([]);
    });

    it("names the person, never an id, when a name is known", () => {
        const rows = expandGroupActivations([groupEvent({ target: { name: "", id: "U-1" } })], holdings, names);
        expect(rows[0].sentence).toBe("Megan Bowen activated Reader on rg-1 through Contoso Admins");
    });
});

describe("export labels", () => {
    it("keeps the Entra labels and adds the Azure ones", () => {
        expect(AUDIT_EXPORT_SOURCE_LABEL.graph).toBe("Entra audit log");
        expect(AUDIT_EXPORT_SOURCE_LABEL.workspace).toBe("Log Analytics workspace");
        expect(AUDIT_EXPORT_SOURCE_LABEL.arm).toBe("PIM requests");
        expect(AUDIT_EXPORT_SOURCE_LABEL["activity-log"]).toBe("Azure activity log");
        expect(AUDIT_EXPORT_SOURCE_LABEL["azure-workspace"]).toBe("Log Analytics workspace");
    });
});

describe("repair round 1", () => {
    const eligibility = (id: string, type: string, name: string) => ({ id: `${S1}/providers/Microsoft.Authorization/roleEligibilitySchedules/${id}`, principalId: "g-1", principalType: type, principalName: name });
    const link = (id: string) => `${S1}/providers/Microsoft.Authorization/roleEligibilitySchedules/${id}`;

    it("counts GroupSecurityNotEnabled as a group for viaGroup, and falls back to the id", () => {
        const context = ctx({ eligibilities: [eligibility("ES-1", "GroupSecurityNotEnabled", "Contoso Admins"), eligibility("ES-2", "Group", "")] });
        expect(run([req({ name: "r1", type: "SelfActivate", linked: link("ES-1") })], [], [], context)[0].viaGroup).toBe("Contoso Admins");
        expect(run([req({ name: "r2", type: "SelfActivate", linked: link("ES-2") })], [], [], context)[0].viaGroup).toBe("g-1");
    });

    it("leaves viaGroup unset on a SelfExtend linked to a group's eligibility", () => {
        const context = ctx({ eligibilities: [eligibility("ES-1", "Group", "Contoso Admins")] });
        expect(run([req({ name: "r1", type: "SelfExtend", linked: link("ES-1") })], [], [], context)[0].viaGroup).toBeUndefined();
    });

    it("keeps a reason as typed", () => {
        expect(run([req({ name: "r1", type: "SelfActivate", justification: " Patch run " })])[0].reason).toBe(" Patch run ");
    });

    it("knows MS-PIM from any row of the group, and takes the caller from any row", () => {
        const rows = [
            act({ id: "s1", corr: "cs", at: "10:00:02", op: WRITE_OP, status: "Started", app: MS_PIM_APP_ID, request: pimBody("u-1") }),
            act({ id: "s2", corr: "cs", at: "10:00:03", op: WRITE_OP, status: "Succeeded", caller: "" }),
        ];
        const events = run([], rows);
        expect(events).toHaveLength(1);
        expect(events[0].kind).toBe("system");
        expect(events[0].sentence).toBe("Megan Bowen added to Reader on rg-1 by PIM");
        expect(events[0].actor.id).toBe("9b2f0000-0000-0000-0000-000000000001");
        expect(run([req({ name: "r1", type: "SelfActivate" })], rows)).toHaveLength(1);
    });

    it("keeps a direct delete without names outside PIM", () => {
        const started = run([], [act({ id: "d1", corr: "cd1", at: "09:00:00", op: DELETE_OP, status: "Started", caller: "alex@contoso.example", app: "other-app" })]);
        expect(started[0].kind).toBe("outside");
        expect(started[0].sentence).toBe("Not completed: Role assignment removed on rg-1 outside PIM");
        const failed = run([], [act({ id: "d2", corr: "cd2", at: "09:00:00", op: DELETE_OP, status: "Failed", caller: "alex@contoso.example", app: "other-app" })]);
        expect(failed[0].kind).toBe("outside");
        expect(failed[0].sentence).toBe("Failed: Role assignment removed on rg-1 outside PIM");
        const write = run([], [act({ id: "d3", corr: "cd3", at: "09:00:00", op: WRITE_OP, status: "Succeeded", caller: "alex@contoso.example", app: "other-app" })]);
        expect(write[0].sentence).toBe("Role assignment given on rg-1 outside PIM");
        const known = run([], [act({ id: "d4", corr: "cd4", at: "09:00:00", op: WRITE_OP, status: "Succeeded", caller: "alex@contoso.example", app: "other-app", request: JSON.stringify({ properties: { principalId: "u-1" } }) })]);
        expect(known[0].target?.name).toBe("Megan Bowen");
        expect(known[0].sentence).toBe("Role assignment given on rg-1 outside PIM");
    });

    it("uses the fallback sentence for an MS-PIM write or delete without names", () => {
        const rows = [
            act({ id: "m1", corr: "cm1", at: "09:00:00", op: DELETE_OP, status: "Started", app: MS_PIM_APP_ID }),
            act({ id: "m2", corr: "cm2", at: "10:00:00", op: WRITE_OP, status: "Started", app: MS_PIM_APP_ID }),
        ];
        const events = run([], rows);
        expect(events.map((event) => [event.kind, event.sentence])).toEqual([
            ["system", "Not completed: Azure operation Microsoft.Authorization/roleAssignments/write"],
            ["system", "Not completed: Azure operation Microsoft.Authorization/roleAssignments/delete"],
        ]);
    });

    it("lets a failed MS-PIM write link to nothing, so its retry links", () => {
        const failed = [
            act({ id: "f1", corr: "cf1", at: "10:00:00", op: WRITE_OP, status: "Started", app: MS_PIM_APP_ID, request: pimBody("u-1") }),
            act({ id: "f2", corr: "cf1", at: "10:00:01", op: WRITE_OP, status: "Failed", app: MS_PIM_APP_ID }),
        ];
        const events = run([req({ name: "REQ-1", type: "SelfActivate" })], [...failed, ...pimWrite("cr", "10:00:05", "10:00:06")]);
        expect(events).toHaveLength(2);
        const system = events.filter((event) => event.kind === "system");
        expect(system).toHaveLength(1);
        expect(system[0].sentence).toBe("Failed: Megan Bowen added to Reader on rg-1 by PIM");
    });

    it("lets a failed MS-PIM delete leave an activation open", () => {
        const failed = [
            act({ id: "x1", corr: "cx1", at: "18:00:00", op: DELETE_OP, status: "Started", app: MS_PIM_APP_ID }),
            act({ id: "x2", corr: "cx1", at: "18:00:01", op: DELETE_OP, status: "Failed", app: MS_PIM_APP_ID, response: deleteBody("u-1") }),
        ];
        const events = run([req({ name: "REQ-1", type: "SelfActivate" })], [...pimWrite("c1", "10:00:02", "10:00:03"), ...failed]);
        expect(events.find((event) => event.id === "req-1")?.endedAt).toBeUndefined();
        expect(events[0].sentence).toBe("Failed: Activation of Reader on rg-1 ended");
    });

    it("takes the group from the eligibility request when the schedule is gone", () => {
        const eligible = (name: string, principalType: string, extra: Partial<ReqSpec> = {}) =>
            req({ name, type: "AdminAssign", principal: "g-1", principalType, principalName: "Contoso Admins", ...extra });
        const act1 = req({ name: "r1", type: "SelfActivate", linked: link("ES-GROUP") });
        expect(run([act1], [], [eligible("es-group", "GroupSecurityNotEnabled")])[0].viaGroup).toBe("Contoso Admins");
        expect(run([act1], [], [eligible("ES-GROUP", "User")])[0].viaGroup).toBeUndefined();
        // the id when the request has no name, the context name before that
        const bare = req({ name: "ES-GROUP", type: "AdminAssign", principal: "u-2", principalType: "Group" });
        expect(run([act1], [], [bare])[0].viaGroup).toBe("Adele Vance");
        const unnamed = req({ name: "ES-GROUP", type: "AdminAssign", principal: "g-7", principalType: "Group" });
        expect(run([act1], [], [unnamed])[0].viaGroup).toBe("g-7");
        // the context wins when both match
        const context = ctx({ eligibilities: [eligibility("ES-GROUP", "Group", "From Context")] });
        expect(run([act1], [], [eligible("ES-GROUP", "Group")], context)[0].viaGroup).toBe("From Context");
        // only an activation
        const extend = req({ name: "r2", type: "SelfExtend", linked: link("ES-GROUP") });
        expect(run([extend], [], [eligible("ES-GROUP", "Group")])[0].viaGroup).toBeUndefined();
    });

    it("tells a failed activation once, with the reason of the failed write", () => {
        const failedWrite = [
            act({ id: "e1", corr: "ce1", at: "10:00:02", op: WRITE_OP, status: "Started", app: MS_PIM_APP_ID, request: pimBody("u-1") }),
            act({ id: "e2", corr: "ce1", at: "10:00:03", op: WRITE_OP, status: "Failed", app: MS_PIM_APP_ID, message: JSON.stringify({ error: { code: "RoleAssignmentExists", message: "It exists" } }) }),
        ];
        const events = run([req({ name: "REQ-1", type: "SelfActivate", status: "Failed" })], failedWrite);
        expect(events).toHaveLength(1);
        expect(events[0].kind).toBe("usage");
        expect(events[0].failureReason).toContain("RoleAssignmentExists");
        // the status word stays when the write gives no reason
        const noReason = [
            act({ id: "e3", corr: "ce3", at: "10:00:02", op: WRITE_OP, status: "Started", app: MS_PIM_APP_ID, request: pimBody("u-1") }),
            act({ id: "e4", corr: "ce3", at: "10:00:03", op: WRITE_OP, status: "Failed", app: MS_PIM_APP_ID }),
        ];
        const plain = run([req({ name: "REQ-1", type: "SelfActivate", status: "TimedOut" })], noReason);
        expect(plain).toHaveLength(1);
        expect(plain[0].failureReason).toBe("TimedOut");
        // a failed write without a failed request stays a row
        const alone = run([], failedWrite);
        expect(alone).toHaveLength(1);
        expect(alone[0].kind).toBe("system");
        expect(alone[0].sentence.startsWith("Failed: ")).toBe(true);
        // a request more than 10 minutes away is not it
        const far = run([req({ name: "REQ-1", type: "SelfActivate", status: "Failed", at: T("09:00:00") })], failedWrite);
        expect(far).toHaveLength(2);
    });

    describe("expiry at the expected end", () => {
        const long = (extra: Partial<ReqSpec> = {}) => req({ name: "REQ-1", type: "SelfActivate", at: "2026-09-02T08:00:00Z", duration: "PT8H", ...extra });
        const delOn = (corr: string, day: string, hms: string) => {
            const at = `${day}T${hms}Z`;
            const rows = pimDelete(corr, "00:00:00", "00:00:01");
            return rows.map((row, index) => ({ ...row, eventTimestamp: index === 0 ? at : at.replace(/:(\d\d)Z$/, (_m, sec) => `:${String(Number(sec) + 1).padStart(2, "0")}Z`) }));
        };

        it("does not end an activation from 60 days ago with a delete today", () => {
            const events = run([long()], delOn("c1", "2026-11-01", "12:00:00"));
            expect(events).toHaveLength(2);
            expect(events.find((event) => event.id === "req-1")?.endedAt).toBeUndefined();
            expect(events[0].sentence).toBe("Activation of Reader on rg-1 ended");
        });

        it("ends an activation at its end, with an extension, without a known end, and by deactivation", () => {
            expect(run([long()], delOn("c1", "2026-09-02", "16:00:00"))).toHaveLength(1);
            const extended = run(
                [long(), req({ name: "REQ-2", type: "SelfExtend", at: "2026-09-02T15:00:00Z", duration: "PT8H" })],
                delOn("c2", "2026-09-02", "23:00:00"),
            );
            expect(extended.find((event) => event.id === "req-1")?.endedAt).toBe("2026-09-02T23:00:01.000Z");
            expect(extended.filter((event) => event.kind === "system")).toHaveLength(0);
            const unlimited = run([req({ name: "REQ-1", type: "SelfActivate", at: "2026-09-02T08:00:00Z" })], delOn("c3", "2026-11-01", "12:00:00"));
            expect(unlimited).toHaveLength(1);
            expect(unlimited[0].endedAt).toBeDefined();
            const deactivated = run([long(), req({ name: "REQ-3", type: "SelfDeactivate", status: "Revoked", at: "2026-11-01T12:00:00Z" })]);
            expect(deactivated).toHaveLength(1);
            expect(deactivated[0].endedBy?.id).toBe("u-1");
        });

        it("uses the end date of a request over its duration", () => {
            const events = run([long({ endsAt: "2026-09-02T10:00:00Z" })], delOn("c1", "2026-09-02", "16:00:00"));
            expect(events).toHaveLength(2);
        });
    });

    it("never makes an event of a validation", () => {
        for (const kind of ["roleAssignmentScheduleRequests", "roleEligibilityScheduleRequests"]) {
            const op = `Microsoft.Authorization/${kind}/validate/action`;
            const rows = ["Started", "Succeeded", "Failed"].map((status, index) => act({ id: `v${index}`, corr: `cv${index}`, at: "09:00:00", op: op.toUpperCase().replace("MICROSOFT.AUTHORIZATION", "Microsoft.Authorization"), status }));
            expect(run([], rows)).toEqual([]);
        }
        const other = run([], [act({ id: "v9", corr: "cv9", at: "09:00:00", op: "Microsoft.Authorization/roleAssignments/validate/action", status: "Succeeded" })]);
        expect(other).toHaveLength(1);
        expect(other[0].kind).toBe("system");
    });

    describe("window of a write", () => {
        it("links a start 4 hours after creation to the write at the start", () => {
            const delayed = req({ name: "REQ-1", type: "SelfActivate", at: T("10:00:00"), start: T("14:00:00") });
            const linked = run([delayed], [...pimWrite("c1", "14:00:01", "14:00:02"), ...pimDelete("c2", "15:00:00", "15:00:01")]);
            expect(linked).toHaveLength(1);
            expect(linked[0].time).toBe("2026-11-01T10:00:00.000Z");
            expect(linked[0].usedMinutes).toBe(59);
            const unlinked = run([delayed], pimDelete("c2", "15:00:00", "15:00:01"));
            expect(unlinked[0].usedMinutes).toBe(60);
        });

        it("links an approval to a write within 24 hours, not after", () => {
            const approved = (extra: Partial<ReqSpec> = {}) => req({ name: "REQ-1", type: "SelfActivate", at: T("10:00:00"), approvalId: "REQ-1", ...extra });
            const at = (day: string, hms: string) => [
                act({ id: "w1", corr: "cw", at: hms, op: WRITE_OP, status: "Started", app: MS_PIM_APP_ID, request: pimBody("u-1") }),
                act({ id: "w2", corr: "cw", at: hms, op: WRITE_OP, status: "Succeeded", app: MS_PIM_APP_ID }),
            ].map((row) => ({ ...row, eventTimestamp: `${day}T${hms}Z` }));
            expect(run([approved()], at("2026-11-01", "23:00:00"))).toHaveLength(1);
            expect(run([approved()], at("2026-11-02", "09:00:00"))).toHaveLength(1);
            const late = run([approved()], at("2026-11-02", "11:00:00"));
            expect(late).toHaveLength(2);
            expect(late[0].kind).toBe("system");
            // a start 48 hours later moves the limit
            const delayed = approved({ start: "2026-11-03T10:00:00Z" });
            expect(run([delayed], at("2026-11-03", "10:00:00"))).toHaveLength(1);
        });
    });

    describe("guards of the measured rules", () => {
        const failedWriteAt = (corr: string, hms: string): RawActivityEvent[] => [
            act({ id: `${corr}-a`, corr, at: hms, op: WRITE_OP, status: "Started", app: MS_PIM_APP_ID, request: pimBody("u-1") }),
            act({ id: `${corr}-b`, corr, at: hms, op: WRITE_OP, status: "Failed", app: MS_PIM_APP_ID }),
        ];
        const logRows = (events: AuditEvent[]) => events.filter((event) => event.source === "activity-log");
        const deleteAt = (corr: string, iso: string): RawActivityEvent[] => pimDelete(corr, "00:00:00", "00:00:01").map((row, index) => ({
            ...row,
            eventTimestamp: new Date(Date.parse(iso) + index * 1000).toISOString(),
        }));
        const longActivation = req({ name: "REQ-1", type: "SelfActivate", at: "2026-09-02T08:00:00Z", duration: "PT8H" });

        it("absorbs a failed write only into a request of the assignment list", () => {
            const events = run([], failedWriteAt("g1", "10:00:02"), [req({ name: "REQ-1", type: "AdminAssign", status: "Failed" })]);
            expect(events).toHaveLength(2);
            const row = logRows(events);
            expect(row).toHaveLength(1);
            expect(row[0].sentence.startsWith("Failed: ")).toBe(true);
        });

        it("absorbs one failed write per failed request", () => {
            const events = run([req({ name: "REQ-1", type: "SelfActivate", status: "Failed" })], [...failedWriteAt("g1", "10:00:02"), ...failedWriteAt("g2", "10:00:05")]);
            expect(events).toHaveLength(2);
            const row = logRows(events);
            expect(row).toHaveLength(1);
            expect(row[0].sentence.startsWith("Failed: ")).toBe(true);
        });

        it("ends an activation at the end of a SelfRenew", () => {
            const renewed = run(
                [longActivation, req({ name: "REQ-2", type: "SelfRenew", at: "2026-09-02T15:00:00Z", duration: "PT8H" })],
                deleteAt("g3", "2026-09-02T23:00:00Z"),
            );
            expect(renewed.find((event) => event.id === "req-1")?.endedAt).toBe("2026-09-02T23:00:01.000Z");
            expect(logRows(renewed)).toHaveLength(0);
        });

        it("does not count a pending extension for the expected end", () => {
            const events = run(
                [longActivation, req({ name: "REQ-2", type: "SelfExtend", status: "PendingApproval", at: "2026-09-02T15:00:00Z", duration: "PT8H" })],
                deleteAt("g4", "2026-09-02T23:00:00Z"),
            );
            expect(events.find((event) => event.id === "req-1")?.endedAt).toBeUndefined();
            const row = logRows(events);
            expect(row).toHaveLength(1);
            expect(row[0].kind).toBe("system");
        });

        it("links a write to a request whose start lies before its creation", () => {
            const events = run([req({ name: "REQ-1", type: "SelfActivate", at: T("10:00:00"), start: T("09:00:00") })], pimWrite("g5", "10:01:00", "10:01:01"));
            expect(events).toHaveLength(1);
            expect(logRows(events)).toHaveLength(0);
        });

        it("links an approval with a late start to a write 30 hours after creation", () => {
            const approved = req({ name: "REQ-1", type: "SelfActivate", at: T("10:00:00"), start: "2026-11-03T10:00:00Z", approvalId: "REQ-1" });
            const write = pimWrite("g6", "00:00:00", "00:00:01").map((row, index) => ({ ...row, eventTimestamp: `2026-11-02T16:00:0${index}Z` }));
            const events = run([approved], write);
            expect(events).toHaveLength(1);
            expect(logRows(events)).toHaveLength(0);
        });
    });

    it("keeps the row of a failed MS-PIM delete with names, next to a nearby AdminRemove", () => {
        const failed = [
            act({ id: "y1", corr: "cy1", at: "18:00:00", op: DELETE_OP, status: "Started", app: MS_PIM_APP_ID }),
            act({ id: "y2", corr: "cy1", at: "18:00:01", op: DELETE_OP, status: "Failed", app: MS_PIM_APP_ID, response: deleteBody("u-1") }),
        ];
        const events = run([req({ name: "REQ-3", type: "AdminRemove", at: T("18:00:30") })], failed);
        expect(events).toHaveLength(2);
        const row = events.find((event) => event.source === "activity-log");
        expect(row?.kind).toBe("system");
        expect(row?.result).toBe("failure");
        expect(row?.sentence.startsWith("Failed: ")).toBe(true);
    });

    it("keeps the row of an MS-PIM delete that only started, and does not end an activation", () => {
        const started = [act({ id: "z1", corr: "cz1", at: "18:00:00", op: DELETE_OP, status: "Started", app: MS_PIM_APP_ID, response: deleteBody("u-1") })];
        const events = run([req({ name: "REQ-1", type: "SelfActivate" })], [...pimWrite("c1", "10:00:02", "10:00:03"), ...started]);
        const activation = events.find((event) => event.id === "req-1");
        expect(activation?.endedAt).toBeUndefined();
        expect(activation?.usedMinutes).toBeUndefined();
        const row = events.find((event) => event.source === "activity-log");
        expect(row?.requestOnly).toBe(true);
        expect(row?.sentence.startsWith("Not completed: ")).toBe(true);
    });

    it("never links a write to a removal or a deactivation", () => {
        const events = run([req({ name: "REQ-2", type: "SelfDeactivate", status: "Revoked", at: T("10:30:00") })], pimWrite("c1", "10:30:02", "10:30:03"));
        expect(events.map((event) => event.sentence)).toContain("Megan Bowen added to Reader on rg-1 by PIM");
        const removal = run([req({ name: "REQ-3", type: "AdminRemove", at: T("10:30:00") })], pimWrite("c2", "10:30:02", "10:30:03"));
        expect(removal.map((event) => event.sentence)).toContain("Megan Bowen added to Reader on rg-1 by PIM");
    });

    it("ends the activation that was active, not an approval still waiting for its write", () => {
        const events = run(
            [
                req({ name: "REQ-0", type: "SelfActivate", at: T("08:00:00") }),
                req({ name: "REQ-1", type: "SelfActivate", at: T("10:00:00"), approvalId: "REQ-1" }),
                req({ name: "REQ-2", type: "SelfDeactivate", status: "Revoked", at: T("12:55:00") }),
            ],
            pimWrite("c1", "13:00:01", "13:00:02"),
        );
        expect(events.map((event) => event.id)).toEqual(["req-1", "req-0"]);
        expect(events[1].endedAt).toBe("2026-11-01T12:55:00.000Z");
        expect(events[1].usedMinutes).toBe(295);
        expect(events[0].endedAt).toBeUndefined();
    });

    it("links a request 5 minutes after its write, and ends the later of two open activations", () => {
        expect(run([req({ name: "REQ-1", type: "SelfActivate", at: T("10:05:00") })], pimWrite("c1", "10:00:00", "10:00:01"))).toHaveLength(1);
        const events = run([
            req({ name: "REQ-A", type: "SelfActivate", at: T("09:00:00") }),
            req({ name: "REQ-B", type: "SelfActivate", at: T("10:00:00") }),
            req({ name: "REQ-C", type: "SelfDeactivate", status: "Revoked", at: T("11:00:00") }),
        ]);
        expect(events.find((event) => event.id === "req-b")?.usedMinutes).toBe(60);
        expect(events.find((event) => event.id === "req-a")?.endedAt).toBeUndefined();
    });

    it.each(["AgentIdentity", "AgentUser", "AgentServicePrincipal"])("marks %s as an app", (principalType) => {
        expect(run([req({ name: "r1", type: "AdminAssign", principalType })])[0].targetIsApp).toBe(true);
    });

    it("reads a resource id at the authorization root as the root scope", () => {
        const [event] = run([], [act({ id: "r1", corr: "cr1", at: "09:00:00", op: WRITE_OP, status: "Succeeded", app: "other-app", request: otherBody("u-1"), resource: "/providers/Microsoft.Authorization/roleAssignments/x" })]);
        expect(event.scope).toBe("Root");
        expect(event.azure?.scopeLevel).toBe("root");
    });

    it("leaves an event of another source alone in applyApprovers", () => {
        const [arm] = run([req({ name: "REQ-1", type: "SelfActivate", status: "PendingApproval" })]);
        const graph: AuditEvent = { ...arm, source: "graph" };
        const row: RawDirectoryAudit = {
            id: "d", category: "ResourceManagement", correlationId: "dc", result: "success", activityDisplayName: "Approve",
            activityDateTime: T("10:05:00"), loggedByService: "PIM", initiatedBy: { user: { id: "u-admin", displayName: "Alex Wilber" } }, targetResources: [],
            additionalDetails: [{ key: "AuditType", value: "ApproveRoleActivation" }, { key: "RoleAssignmentRequestId", value: "req-1" }],
        };
        const out = applyApprovers([graph], [row]);
        expect(out[0]).toBe(graph);
        expect(out[0].approver).toBeUndefined();
    });

    it("gives no group rows for a usage event of a role", () => {
        const event: AuditEvent = {
            id: "G-1", time: "2026-11-01T10:00:00.000Z", kind: "usage", environment: "role", sentence: "x",
            actor: { name: "Megan Bowen", id: "u-1", kind: "person" }, role: { name: "member of Contoso Admins", id: "g-id-1" },
            scope: "", result: "success", source: "graph", correlationId: "c",
        };
        expect(expandGroupActivations([event], [{ groupId: "g-id-1", roleId: READER, roleName: "Reader", scopeId: RG }], { scopeName: ctx().scopeName })).toEqual([]);
    });

    it("matches a holding whose group id differs in case", () => {
        const event: AuditEvent = {
            id: "G-1", time: "2026-11-01T10:00:00.000Z", kind: "usage", environment: "group", sentence: "x",
            actor: { name: "Megan Bowen", id: "u-1", kind: "person" }, role: { name: "member of Contoso Admins", id: "g-id-1" },
            scope: "", result: "success", source: "graph", correlationId: "c",
        };
        const rows = expandGroupActivations([event], [{ groupId: "G-ID-1", roleId: READER, roleName: "Reader", scopeId: RG }], { scopeName: ctx().scopeName });
        expect(rows).toHaveLength(1);
    });

    it("links a request and a write whose ids differ only in case", () => {
        const resource = "/subscriptions/S-1/resourcegroups/RG-1/providers/Microsoft.Authorization/roleAssignments/ra-1";
        const rows = [
            act({ id: "i1", corr: "ci", at: "10:00:02", op: WRITE_OP, status: "Started", app: MS_PIM_APP_ID, request: pimBody("U-1"), resource }),
            act({ id: "i2", corr: "ci", at: "10:00:03", op: WRITE_OP, status: "Succeeded", app: MS_PIM_APP_ID, resource }),
        ];
        expect(run([req({ name: "REQ-1", type: "SelfActivate" })], rows)).toHaveLength(1);
    });

    it("keeps rows with one correlation id but another operation or resource apart", () => {
        const base = { corr: "cj", at: "09:00:00", status: "Succeeded" };
        const otherOp = run([], [
            act({ id: "j1", ...base, op: "Microsoft.Authorization/locks/write" }),
            act({ id: "j2", ...base, op: "Microsoft.Authorization/locks/delete" }),
        ]);
        expect(otherOp).toHaveLength(2);
        const otherResource = run([], [
            act({ id: "j3", ...base, op: "Microsoft.Authorization/locks/write", resource: `${RG}/providers/Microsoft.Authorization/locks/a` }),
            act({ id: "j4", ...base, op: "Microsoft.Authorization/locks/write", resource: `${RG}/providers/Microsoft.Authorization/locks/b` }),
        ]);
        expect(otherResource).toHaveLength(2);
    });
});

describe("raw rows: only the named fields", () => {
    it("toRawActivityEvent keeps none of httpRequest, authorization, claims.name, claims.ipaddr", () => {
        const row = {
            eventDataId: "E-1", correlationId: "C-1", eventTimestamp: "2026-11-01T10:00:00Z", caller: "a@contoso.example", resourceId: RG, subscriptionId: "s-1",
            operationName: { value: WRITE_OP, localizedValue: "x" }, status: { value: "Started" },
            claims: { appid: MS_PIM_APP_ID, name: "SECRET-NAME", ipaddr: "203.0.113.5" },
            httpRequest: { clientIpAddress: "203.0.113.9" }, authorization: { scope: "SECRET-SCOPE" },
            properties: { requestbody: "{}", serviceRequestId: "SECRET-SERVICE" },
        };
        const out = toRawActivityEvent(row);
        expect(out.claims).toEqual({ appid: MS_PIM_APP_ID });
        expect(out.operationName).toEqual({ value: WRITE_OP });
        const text = JSON.stringify(out);
        for (const secret of ["SECRET-NAME", "203.0.113", "SECRET-SCOPE", "SECRET-SERVICE", "httpRequest", "authorization"]) expect(text).not.toContain(secret);
    });

    it("does not throw on a row that is not an object", () => {
        for (const value of [null, undefined, "x", 4, []]) {
            expect(() => toRawActivityEvent(value)).not.toThrow();
            expect(() => toRawArmRequest(value)).not.toThrow();
        }
        expect(toRawArmRequest(null)).toEqual({ id: "", name: "", properties: {} });
    });

    it("toRawArmRequest copies the named fields only", () => {
        const out = toRawArmRequest({
            id: "i", name: "n", type: "x",
            properties: { scope: RG, principalId: "u-1", requestType: "SelfActivate", condition: "SECRET", expandedProperties: { principal: { displayName: "A", userPrincipalName: "a@x.example", email: "SECRET-MAIL" } } },
        });
        expect(out.properties.principalId).toBe("u-1");
        expect(out.properties.expandedProperties?.principal).toEqual({ displayName: "A", userPrincipalName: "a@x.example" });
        expect(JSON.stringify(out)).not.toContain("SECRET");
    });
});

describe("guests, apps and groups", () => {
    const GUEST_UPN = "kim_fabrikam.example#EXT#@contoso.example";
    const guestRequest = (extra: Partial<ReqSpec> = {}) => {
        const request = req({ name: "g1", type: "AdminAssign", principal: "u-guest", ...extra });
        request.properties.expandedProperties = { principal: { displayName: "Kim", userPrincipalName: GUEST_UPN } };
        return request;
    };
    const outsideWrite = (principal: string, caller = "admin@contoso.example") => [
        act({ id: "o1", corr: "co", at: "11:00:00", op: WRITE_OP, status: "Started", caller, request: otherBody(principal) }),
        act({ id: "o2", corr: "co", at: "11:00:02", op: WRITE_OP, status: "Succeeded", caller }),
    ];

    it("a request for a guest has targetIsGuest, and the actor is a guest when the requestor is the principal", () => {
        const [other] = run([guestRequest({ requestor: "u-admin" })]);
        expect(other.targetIsGuest).toBe(true);
        expect(other.actor.isGuest).toBeUndefined();
        const [self] = run([guestRequest({ requestor: "u-guest" })]);
        expect(self.actor.isGuest).toBe(true);
    });

    it("a log row takes the guest from a request with that principal, and from context.principal", () => {
        const fromRequest = run([guestRequest()], outsideWrite("u-guest")).find((event) => event.source === "activity-log");
        expect(fromRequest?.targetIsGuest).toBe(true);
        const fromContext = run([], outsideWrite("u-ctx"), [], ctx({ principal: (id) => (id === "u-ctx" ? { type: "User", upn: GUEST_UPN } : undefined) }))[0];
        expect(fromContext.targetIsGuest).toBe(true);
        expect(run([], outsideWrite("u-ctx"))[0].targetIsGuest).toBeUndefined();
    });

    it("the actor of a log row is a guest when the caller is", () => {
        expect(run([], outsideWrite("u-1", GUEST_UPN))[0].actor.isGuest).toBe(true);
    });

    it("a log row with no type takes targetIsApp and targetIsGroup from a request or the context", () => {
        const app = req({ name: "a1", type: "AdminAssign", principal: "sp-1", principalType: "ServicePrincipal" });
        expect(run([app], outsideWrite("sp-1")).find((event) => event.source === "activity-log")?.targetIsApp).toBe(true);
        const group = run([], outsideWrite("g-1"), [], ctx({ principal: () => ({ type: "Group" }) }))[0];
        expect(group.targetIsGroup).toBe(true);
    });
});

describe("buildAzureHolderKinds", () => {
    const request = (principalId: string, principalType: string): RawArmRequest => req({ name: `r-${principalId}`, type: "AdminAssign", principal: principalId, principalType });

    it("maps each type, without case, and makes no entry for other types", () => {
        const kinds = buildAzureHolderKinds({
            requests: [request("A1", "AgentIdentity"), request("A2", "agentserviceprincipal"), request("A3", "AgentUser"), request("S1", "ServicePrincipal"), request("U1", "User")],
            assignments: [{ principalId: "S2", principalType: "ServicePrincipal" }, { principalId: "G1", principalType: "Group" }],
            servicePrincipalTypes: new Map(),
        });
        expect(Object.fromEntries(kinds)).toEqual({ a1: "agentIdentity", a2: "agentIdentity", a3: "agentUser", s1: "servicePrincipal", s2: "servicePrincipal" });
    });

    it("an AgentIdentity request and a ServicePrincipal assignment for one id give agentIdentity, in both orders", () => {
        const requestFirst = buildAzureHolderKinds({ requests: [request("Z1", "AgentIdentity")], assignments: [{ principalId: "z1", principalType: "ServicePrincipal" }], servicePrincipalTypes: new Map() });
        const assignmentFirst = buildAzureHolderKinds({ requests: [request("z1", "ServicePrincipal")], assignments: [{ principalId: "Z1", principalType: "AgentIdentity" }], servicePrincipalTypes: new Map() });
        expect(requestFirst.get("z1")).toBe("agentIdentity");
        expect(assignmentFirst.get("z1")).toBe("agentIdentity");
    });

    it("an agent in one list wins over an app in another, and ServiceIdentity from Graph wins over both", () => {
        const kinds = buildAzureHolderKinds({
            requests: [request("X1", "ServicePrincipal")],
            assignments: [{ principalId: "x1", principalType: "AgentIdentity" }, { principalId: "x2", principalType: "AgentIdentity" }],
            servicePrincipalTypes: new Map([["x2", "Application"], ["x3", "serviceidentity"]]),
        });
        expect(kinds.get("x1")).toBe("agentIdentity");
        expect(kinds.get("x2")).toBe("servicePrincipal");
        expect(kinds.get("x3")).toBe("agentIdentity");
        expect(kinds.has("unknown")).toBe(false);
    });
});

describe("the approver from the tenant log (step of an approval)", () => {
    const STEP_OP = "Microsoft.Authorization/roleAssignmentApprovals/stages/write";
    const stepResource = (name: string) => `${RG}/providers/Microsoft.Authorization/roleAssignmentApprovals/${name}/stages/stage-1`;
    const step = (name: string, status: string, caller = "approver@contoso.example", corr = "stage-c1", at = "10:20:00") =>
        act({ id: `${corr}-${status}`, corr, at, op: STEP_OP, status, caller, resource: stepResource(name) });
    const approved = (extra: Partial<ReqSpec> = {}) => req({ name: "REQ-1", type: "SelfActivate", at: T("10:00:00"), approvalId: "REQ-1", ...extra });

    it("gives the request the caller of a succeeded step, and the step no row of its own", () => {
        const events = run([approved()], [step("REQ-1", "Started"), step("REQ-1", "Succeeded")]);
        expect(events).toHaveLength(1);
        expect(events[0].id).toBe("req-1");
        expect(events[0].approver).toBe("approver@contoso.example");
        expect(events[0].hadApproval).toBe(true);
    });

    it("matches the operation and the path without case", () => {
        const row = act({ id: "s1", corr: "stage-c1", at: "10:20:00", op: STEP_OP.toUpperCase(), status: "SUCCEEDED", caller: "approver@contoso.example", resource: stepResource("REQ-1").replace("roleAssignmentApprovals", "ROLEASSIGNMENTAPPROVALS") });
        const events = run([approved()], [row]);
        expect(events).toHaveLength(1);
        expect(events[0].approver).toBe("approver@contoso.example");
    });

    it("lets the name of the Entra log win through applyApprovers", () => {
        const events = run([approved()], [step("REQ-1", "Succeeded")]);
        const directory: RawDirectoryAudit = {
            id: "d1", category: "ResourceManagement", correlationId: "dc", result: "success", activityDisplayName: "Approve", activityDateTime: T("10:20:00"), loggedByService: "PIM",
            initiatedBy: { user: { id: "u-admin", displayName: "Alex Wilber" } }, targetResources: [],
            additionalDetails: [{ key: "AuditType", value: "ApproveRoleActivation" }, { key: "RoleAssignmentRequestId", value: "REQ-1" }],
        };
        expect(applyApprovers(events, [directory])[0].approver).toBe("Alex Wilber");
    });

    it("keeps a Started-only step as a system row, and sets no approver", () => {
        const events = run([approved()], [step("REQ-1", "Started")]);
        expect(events).toHaveLength(2);
        expect(events.find((event) => event.id === "req-1")?.approver).toBeUndefined();
        expect(events.filter((event) => event.kind === "system")).toHaveLength(1);
    });

    it("keeps a step of an unknown name as a system row", () => {
        const events = run([approved()], [step("NOT-A-REQUEST", "Succeeded")]);
        expect(events).toHaveLength(2);
        expect(events.find((event) => event.id === "req-1")?.approver).toBeUndefined();
        expect(events.filter((event) => event.kind === "system")).toHaveLength(1);
    });

    it("says only that a decision exists: hadApproval needs a non-empty approvalId", () => {
        expect(run([approved()])[0].hadApproval).toBe(true);
        expect(run([req({ name: "REQ-2", type: "SelfActivate" })])[0].hadApproval).toBeUndefined();
    });
});

describe("the caller of an Activity Log row", () => {
    const UPN = "bg01@contoso.example";
    const direct = (caller = UPN) => [
        act({ id: "d-a", corr: "dc", at: "10:00:00", op: WRITE_OP, status: "Started", caller, request: otherBody("u-2") }),
        act({ id: "d-b", corr: "dc", at: "10:00:01", op: WRITE_OP, status: "Succeeded", caller }),
    ];
    const outside = (events: AuditEvent[]) => events.find((event) => event.kind === "outside") as AuditEvent;

    it("resolves the sign-in name through a request of the read: the id and the display name of its principal", () => {
        const request = req({ name: "REQ-9", type: "AdminAssign", principal: "u-bg", principalName: "Break Glass 01" });
        (request.properties.expandedProperties as { principal: { userPrincipalName?: string } }).principal.userPrincipalName = UPN.toUpperCase();
        const event = outside(run([request], direct()));
        expect(event.actor.id).toBe("u-bg");
        expect(event.actor.name).toBe("Break Glass 01");
        expect(isEmergencyEvent(event, new Set(["u-bg"]))).toBe(true);
    });

    it("resolves it through the context when no request names it, and takes the name from the context", () => {
        const context = ctx({ principalIdOfUpn: (upn) => (upn.toLowerCase() === UPN ? "u-1" : undefined) });
        const event = outside(run([], direct(), [], context));
        expect(event.actor.id).toBe("u-1");
        expect(event.actor.name).toBe("Megan Bowen");
        expect(isEmergencyEvent(event, new Set(["u-1"]))).toBe(true);
    });

    it("keeps the sign-in name when nothing resolves it, and the emergency tag stays off", () => {
        const event = outside(run([], direct(), [], ctx({ principalIdOfUpn: () => undefined })));
        expect(event.actor.id).toBe(UPN);
        expect(event.actor.name).toBe(UPN);
        expect(isEmergencyEvent(event, new Set(["u-1"]))).toBe(false);
    });

    it("still tells a guest from the sign-in name", () => {
        const guest = "someone_fabrikam.example#EXT#@contoso.example";
        const context = ctx({ principalIdOfUpn: () => "u-1" });
        expect(outside(run([], direct(guest), [], context)).actor.isGuest).toBe(true);
    });
});

describe("the approver by name and the time of the decision (AU-17, P6)", () => {
    const STEP_OP = "Microsoft.Authorization/roleAssignmentApprovals/stages/write";
    const step = (name: string, at: string, caller: string) =>
        act({ id: `s-${name}`, corr: `c-${name}`, at, op: STEP_OP, status: "Succeeded", caller, resource: `${RG}/providers/Microsoft.Authorization/roleAssignmentApprovals/${name}/stages/stage-1` });
    const withUpn = (spec: ReqSpec, upn: string): RawArmRequest => {
        const raw = req(spec);
        raw.properties.expandedProperties = { principal: { displayName: spec.principalName, userPrincipalName: upn } };
        return raw;
    };

    it("shows the display name when the sign-in name is known in the read, and 11 whole minutes", () => {
        const approver = withUpn({ name: "REQ-9", type: "AdminAssign", principal: "u-admin", principalName: "Alex Wilber" }, "adm.alex@contoso.example");
        const request = req({ name: "REQ-1", type: "SelfActivate", at: T("08:18:35"), approvalId: "REQ-1" });
        const events = run([request, approver], [step("REQ-1", "08:29:47", "adm.alex@contoso.example")]);
        const event = events.find((e) => e.id === "req-1");
        expect(event?.approver).toBe("Alex Wilber");
        expect(event?.decidedAfterMinutes).toBe(11);
    });

    it("keeps an unknown sign-in name", () => {
        const request = req({ name: "REQ-1", type: "SelfActivate", at: T("08:18:35"), approvalId: "REQ-1" });
        const events = run([request], [step("REQ-1", "08:29:47", "nobody@contoso.example")]);
        expect(events[0].approver).toBe("nobody@contoso.example");
    });

    it("counts a denied request too, and leaves the minutes out when the decision is before the request", () => {
        const denied = req({ name: "REQ-2", type: "SelfActivate", status: "Denied", at: T("09:00:00"), approvalId: "REQ-2" });
        const [event] = run([denied], [step("REQ-2", "09:04:30", "approver@contoso.example")]);
        expect(event.denied).toBe(true);
        expect(event.decidedAfterMinutes).toBe(4);
        const early = req({ name: "REQ-3", type: "SelfActivate", at: T("09:00:00"), approvalId: "REQ-3" });
        expect(run([early], [step("REQ-3", "08:00:00", "approver@contoso.example")])[0].decidedAfterMinutes).toBeUndefined();
    });

    it("sets the minutes from the Entra row when it names the approver", () => {
        const request = req({ name: "REQ-1", type: "SelfActivate", status: "Denied", at: T("10:00:00"), approvalId: "REQ-1" });
        const directory: RawDirectoryAudit = {
            id: "d1", category: "ResourceManagement", correlationId: "dc", result: "success", activityDisplayName: "Reject", activityDateTime: T("10:07:59"), loggedByService: "PIM",
            initiatedBy: { user: { id: "u-admin", displayName: "Alex Wilber" } }, targetResources: [],
            additionalDetails: [{ key: "AuditType", value: "RejectRoleActivation" }, { key: "RoleAssignmentRequestId", value: "REQ-1" }],
        };
        const [event] = applyApprovers(run([request]), [directory]);
        expect(event.approver).toBe("Alex Wilber");
        expect(event.decidedAfterMinutes).toBe(7);
    });
});

describe("a scheduled activation shows its start (AU-17, P7)", () => {
    it("sets startsAt when the start is more than 60 seconds after the request", () => {
        const [event] = run([req({ name: "REQ-1", type: "SelfActivate", at: T("19:07:06"), start: T("19:22:50"), duration: "PT1H" })]);
        expect(event.startsAt).toBe(T("19:22:50").replace("Z", ".000Z"));
        expect(event.time).toBe(T("19:07:06").replace("Z", ".000Z"));
    });

    it("sets none for a start 10 seconds after the request", () => {
        const [event] = run([req({ name: "REQ-1", type: "SelfActivate", at: T("19:07:06"), start: T("19:07:16"), duration: "PT1H" })]);
        expect(event.startsAt).toBeUndefined();
    });
});

describe("a refused admin request is not lost (AU-17, P8)", () => {
    const REQ_OP = "Microsoft.Authorization/roleEligibilityScheduleRequests/write";
    const resource = (name: string) => `${RG}/providers/Microsoft.Authorization/roleEligibilityScheduleRequests/${name}`;
    const body = JSON.stringify({ properties: { principalId: "u-1", roleDefinitionId: roleDef(READER), requestType: "AdminExtend" } });
    const pair = (name: string) => [
        act({ id: `${name}-a`, corr: `c-${name}`, at: "10:00:00", op: REQ_OP, status: "Started", caller: "adm@contoso.example", resource: resource(name), request: body }),
        act({ id: `${name}-b`, corr: `c-${name}`, at: "10:00:02", op: REQ_OP, status: "Failed", caller: "adm@contoso.example", resource: resource(name), message: JSON.stringify({ error: { code: "ActiveDurationTooShort", message: "Too short." } }) }),
    ];

    it("gives one failed assignment event with the code when no request has it", () => {
        const events = run([], pair("refused-1"));
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ kind: "assignment", result: "failure", source: "activity-log" });
        expect(events[0].failureReason).toContain("ActiveDurationTooShort");
        expect(events[0].sentence).toBe("Failed: Extension of Megan Bowen for Reader on rg-1");
        expect(events[0].actor.name).toBe("adm@contoso.example");
    });

    it("gives no extra event when a request of the lists has it", () => {
        const events = run([], pair("kept-1"), [req({ name: "kept-1", type: "AdminExtend", status: "Failed" })]);
        expect(events).toHaveLength(1);
        expect(events[0].source).toBe("arm");
    });

    it("tells the person's own refused request as using the role, not as an assignment", () => {
        const own = JSON.stringify({ properties: { principalId: "u-1", roleDefinitionId: roleDef(READER), requestType: "SelfDeactivate" } });
        const [started, failed] = pair("own-1");
        const events = run([], [{ ...started, properties: { ...started.properties, requestbody: own } }, failed]);
        expect(events[0]).toMatchObject({ kind: "usage", result: "failure" });
        expect(events[0].sentence).toBe("Failed: Deactivation of Megan Bowen for Reader on rg-1");
    });

    it("carries the request type on an event from the request lists", () => {
        const events = run([], [], [req({ name: "typed-1", type: "AdminExtend" })]);
        expect(events[0].requestType).toBe("AdminExtend");
    });

    it("still makes the row when the body cannot be read", () => {
        const [started, failed] = pair("nobody-1");
        const events = run([], [{ ...started, properties: { requestbody: "not json" } }, failed]);
        expect(events).toHaveLength(1);
        expect(events[0].result).toBe("failure");
    });
});

describe("the name of a role no assignment names", () => {
    const GONE = "0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d";
    const goneDef = `${S1}/providers/Microsoft.Authorization/roleDefinitions/${GONE}`;
    const removal = (): RawActivityEvent[] => [
        act({ id: "d1", corr: "cd", at: "09:00:00", op: DELETE_OP, status: "Started", caller: "alex@contoso.example", app: "other-app" }),
        act({ id: "d2", corr: "cd", at: "09:00:01", op: DELETE_OP, status: "Succeeded", caller: "alex@contoso.example", app: "other-app", response: JSON.stringify({ properties: { principalId: "u-1", roleDefinitionId: goneDef, scope: RG } }), resource: `${S1}/providers/Microsoft.Authorization/roleAssignments/ra-1` }),
    ];
    const definitionRow = (id: string, at: string, op: string, roleName: string, status = "Succeeded"): RawActivityEvent =>
        // A write tells the name in its request body, a delete in its response body
        act({ id, corr: `c-${id}`, at, op, status, resource: goneDef, request: JSON.stringify({ properties: { roleName } }), response: JSON.stringify({ properties: { roleName } }) });
    const DEFINITION_DELETE = "Microsoft.Authorization/roleDefinitions/delete";
    const DEFINITION_WRITE = "Microsoft.Authorization/roleDefinitions/write";

    it("names a deleted custom role from the delete row of the log, and keeps the id", () => {
        const events = run([], [...removal(), definitionRow("x1", "10:00:00", DEFINITION_DELETE, "Contoso Old Operator")]);
        const removed = events.find((event) => event.kind === "outside");
        expect(removed?.sentence).toBe("Megan Bowen removed from Contoso Old Operator on rg-1 outside PIM");
        expect(removed?.role).toEqual({ name: "Contoso Old Operator", id: GONE });
    });

    it("takes the newest name when the role was written more than once", () => {
        const events = run([], [...removal(), definitionRow("x1", "08:00:00", DEFINITION_WRITE, "Contoso Operator v1"), definitionRow("x2", "08:30:00", DEFINITION_WRITE, "Contoso Operator v2"), definitionRow("x0", "07:00:00", DEFINITION_WRITE, "Contoso Operator v0")]);
        expect(events.find((event) => event.kind === "outside")?.role.name).toBe("Contoso Operator v2");
    });

    it("lets a name the context knows win over the log", () => {
        const context = ctx({ roleName: (guid) => (guid.toLowerCase() === GONE ? "Contoso Operator (assignments)" : undefined) });
        const events = run([], [...removal(), definitionRow("x1", "10:00:00", DEFINITION_DELETE, "Contoso Old Operator")], [], context);
        expect(events.find((event) => event.kind === "outside")?.role.name).toBe("Contoso Operator (assignments)");
    });

    it("leaves the id when nothing names the role", () => {
        const events = run([], removal());
        const removed = events.find((event) => event.kind === "outside");
        expect(removed?.role).toEqual({ name: GONE, id: GONE });
    });
});

describe("hasUnnamedRole", () => {
    const GUID = "0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d";
    const eventWith = (role: { name: string; id: string }): AuditEvent => ({ ...run([req({ name: "R", type: "SelfActivate", at: T("10:00:00") })])[0], role });

    it("is true when the name is the GUID, with or without case", () => {
        expect(hasUnnamedRole([eventWith({ name: GUID, id: GUID })])).toBe(true);
        expect(hasUnnamedRole([eventWith({ name: GUID.toUpperCase(), id: GUID })])).toBe(true);
    });

    it("is false when the role has a name, a name that is not an id, or no role", () => {
        expect(hasUnnamedRole([eventWith({ name: "Reader", id: GUID })])).toBe(false);
        expect(hasUnnamedRole([eventWith({ name: "role-9", id: "role-9" })])).toBe(false);
        expect(hasUnnamedRole([eventWith({ name: "", id: "" })])).toBe(false);
    });
});
