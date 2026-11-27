import { describe, it, expect } from "vitest";
import { mapAuditEvents, wholeMinutes } from "@/utils/auditEvents";
import { indexActivations } from "@/utils/auditNoActivation";
import type { RawAuditDetail, RawAuditTarget, RawDirectoryAudit } from "@/types/audit.types";

// Invented data only: Contoso names, .example domains, made-up ids.
const MEGAN = { id: "u-1", displayName: "Megan Bowen" };
const SECURITY_ROLE: RawAuditTarget = { type: "Role", id: "role-1", displayName: "Security Administrator", modifiedProperties: [] };
const DIRECTORY: RawAuditTarget = { type: "Directory", displayName: "Contoso" };

interface Spec {
    id: string;
    time: string;
    activity: string;
    auditType?: string;
    category?: string;
    correlationId?: string;
    result?: string;
    resultReason?: string;
    service?: string;
    user?: { id: string; displayName: string; userPrincipalName?: string } | null;
    app?: string | null;
    targets?: RawAuditTarget[];
    details?: Record<string, string>;
}

/** One raw row; a row without a correlation id gets its own, so rows do not merge by accident */
function audit(spec: Spec): RawDirectoryAudit {
    const details: RawAuditDetail[] = Object.entries(spec.details ?? {}).map(([key, value]) => ({ key, value }));
    if (spec.auditType) details.unshift({ key: "AuditType", value: spec.auditType });
    return {
        id: spec.id,
        category: spec.category ?? "RoleManagement",
        correlationId: spec.correlationId ?? `corr-${spec.id}`,
        result: spec.result ?? "success",
        resultReason: spec.resultReason ?? null,
        activityDisplayName: spec.activity,
        activityDateTime: spec.time,
        loggedByService: spec.service ?? "PIM",
        initiatedBy: { user: spec.user ?? null, app: spec.app ? { displayName: spec.app } : null },
        targetResources: spec.targets ?? [],
        additionalDetails: details,
    };
}

/** Megan activates Security Administrator: the request at 08:10:00, the completed event at 08:10:05 */
function activation(correlationId = "corr-1", requestId = "r-1", raId = "ra-1"): RawDirectoryAudit[] {
    const shared = { correlationId, targets: [SECURITY_ROLE, DIRECTORY], user: MEGAN, category: "RoleManagement" };
    const details = { RequestId: requestId, RoleAssignmentRequestId: raId, StartTime: "2026-10-20T08:10:00Z", ExpirationTime: "2026-10-20T09:10:00Z", Justification: "Patch run", IsAuthenticatedWithMfa: "True" };
    return [
        audit({ ...shared, id: `req-${correlationId}`, time: "2026-10-20T08:10:00Z", activity: "Activate role request", auditType: "CreateRequestRoleActivation", details }),
        audit({ ...shared, id: `done-${correlationId}`, time: "2026-10-20T08:10:05Z", activity: "Add member to role completed (PIM activation)", auditType: "ActivateRole", details }),
    ];
}

/** Megan deactivates Security Administrator at 08:40, with a new assignment request id on her request */
function deactivation(raId = "ra-1"): RawDirectoryAudit[] {
    const shared = { correlationId: "corr-2", targets: [SECURITY_ROLE, DIRECTORY], user: MEGAN };
    return [
        audit({ ...shared, id: "deact-req", time: "2026-10-20T08:40:00Z", activity: "Deactivate role request", auditType: "CreateRequestRoleDeactivation", details: { RequestId: "r-2", RoleAssignmentRequestId: "ra-2" } }),
        audit({ ...shared, id: "deact-done", time: "2026-10-20T08:40:05Z", activity: "Remove member from role completed (PIM deactivation)", auditType: "DeactivateRole", details: { RequestId: "r-2", RoleAssignmentRequestId: raId } }),
    ];
}

function byId<T extends { id: string }>(events: T[], id: string): T {
    const found = events.find((event) => event.id === id);
    if (!found) throw new Error(`no event ${id}`);
    return found;
}

describe("wholeMinutes", () => {
    it("counts whole minutes and gives nothing for a reversed or missing time", () => {
        expect(wholeMinutes(0, 90_000)).toBe(1);
        expect(wholeMinutes(0, 60_000 * 30)).toBe(30);
        expect(wholeMinutes(60_000, 0)).toBeUndefined();
        expect(wholeMinutes(Number.NaN, 0)).toBeUndefined();
    });
});

describe("mapAuditEvents: allow list (rule 1)", () => {
    it("never lets forbidden fields reach the output", () => {
        const withUpn = { id: "u-1", displayName: "Megan Bowen", userPrincipalName: "megan@contoso.example" };
        const targetWithUpn = { type: "User", id: "u-2", displayName: "Adele Vance", userPrincipalName: "adele@contoso.example", modifiedProperties: [] };
        const rows = [audit({
            id: "forbidden", time: "2026-10-20T08:10:05Z", activity: "Add member to role completed (PIM activation)", auditType: "ActivateRole",
            user: withUpn,
            targets: [SECURITY_ROLE, DIRECTORY, targetWithUpn as RawAuditTarget],
            details: {
                ipaddr: "198.51.100.23", UserAgent: "ua-forbidden-1", "User-Agent": "ua-forbidden-2", wids: "wids-forbidden-3",
                oid: "oid-forbidden-4", tid: "tid-forbidden-5", acct: "acct-forbidden-6", RequestId: "r-9", RoleAssignmentRequestId: "ra-9",
            },
        })];
        const output = JSON.stringify(mapAuditEvents(rows));
        for (const forbidden of ["198.51.100.23", "ua-forbidden-1", "ua-forbidden-2", "wids-forbidden-3", "oid-forbidden-4", "tid-forbidden-5", "acct-forbidden-6", "megan@contoso.example", "adele@contoso.example"]) {
            expect(output).not.toContain(forbidden);
        }
        expect(output).toContain("Megan Bowen");
    });
});

describe("mapAuditEvents: the scope id (AU-6b)", () => {
    it("takes ScopedResourceOriginId as directoryScopeId and leaves it out when the log has none", () => {
        const scoped = audit({
            id: "scoped", time: "2026-10-20T08:10:05Z", activity: "Add member to role completed (PIM activation)", auditType: "ActivateRole", user: MEGAN,
            targets: [SECURITY_ROLE, DIRECTORY], details: { ScopedResourceOriginId: "/aaaaaaaa-0000-4000-8000-000000000001" },
        });
        const tenantWide = audit({ id: "wide", time: "2026-10-20T09:10:05Z", activity: "Add member to role completed (PIM activation)", auditType: "ActivateRole", user: MEGAN, targets: [SECURITY_ROLE, DIRECTORY] });
        const events = mapAuditEvents([scoped, tenantWide]);
        expect(byId(events, "scoped").directoryScopeId).toBe("/aaaaaaaa-0000-4000-8000-000000000001");
        expect(byId(events, "wide").directoryScopeId).toBeUndefined();
    });
});

describe("mapAuditEvents: kinds and drops (rules 2 and 3)", () => {
    it("drops ResourceManagement and MS-PIM rows, and keeps an unknown AuditType as System", () => {
        const rows = [
            audit({ id: "azure", category: "ResourceManagement", time: "2026-10-20T08:00:00Z", activity: "Add role assignment", auditType: "CreateRoleAssignment", user: MEGAN }),
            audit({ id: "mspim", service: "Core Directory", time: "2026-10-20T08:01:00Z", activity: "Add member to role", app: "MS-PIM", targets: [{ type: "User", id: "u-2", displayName: "Adele Vance", modifiedProperties: [{ displayName: "Role.DisplayName", newValue: "\"Exchange Administrator\"", oldValue: null }] }] }),
            audit({ id: "unknown", time: "2026-10-20T08:02:00Z", activity: "Something new happened", auditType: "SomethingNew", targets: [SECURITY_ROLE, DIRECTORY] }),
        ];
        const events = mapAuditEvents(rows);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ id: "unknown", kind: "system", sentence: "Something new happened", source: "graph" });
    });

    it("drops a row without a valid time instead of guessing one", () => {
        const events = mapAuditEvents([audit({ id: "no-time", time: "not a time", activity: "Triggered PIM alert", auditType: "ActivateAlert" })]);
        expect(events).toHaveLength(0);
    });

    it("sets the policy change as Setting, with the logged text as newValue and no reason", () => {
        const rows = [audit({
            id: "policy", category: "RoleManagement", time: "2026-10-20T07:00:00Z", activity: "Update role setting in PIM", auditType: "UpdatePolicy", user: MEGAN,
            targets: [SECURITY_ROLE, DIRECTORY, { type: "Policy", id: "p-1", displayName: "Policy" }],
            details: { Justification: "Approval required: no" },
        })];
        const [event] = mapAuditEvents(rows);
        expect(event).toMatchObject({ kind: "setting", sentence: "Setting changed for Security Administrator", newValue: "Approval required: no" });
        expect(event.reason).toBeUndefined();
        expect(event.target).toBeUndefined();
    });

    it("keeps a person's assignment completed by Azure AD PIM as an Assignment with the person as actor", () => {
        const shared = { correlationId: "corr-7", targets: [SECURITY_ROLE, DIRECTORY, { type: "User", id: "u-2", displayName: "Adele Vance" }] };
        const rows = [
            audit({ ...shared, id: "assign-req", time: "2026-10-20T06:00:00Z", activity: "Add eligible member request", auditType: "CreateRequestEligibleRole", user: MEGAN, details: { RequestId: "r-7" } }),
            audit({ ...shared, id: "assign-done", time: "2026-10-20T06:00:03Z", activity: "Add eligible member to role completed", auditType: "AssignEligibleRole", app: "Azure AD PIM" }),
        ];
        const events = mapAuditEvents(rows);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            kind: "assignment",
            time: "2026-10-20T06:00:03.000Z",
            actor: { name: "Megan Bowen", id: "u-1", kind: "person" },
            sentence: "Adele Vance made eligible for Security Administrator",
        });
    });

    it("keeps an assignment with only app events as an Assignment with the app as a system actor", () => {
        const events = mapAuditEvents([audit({ id: "app-only", time: "2026-10-20T06:30:00Z", activity: "Remove eligible member from role", auditType: "RemoveEligibleRole", app: "Azure AD PIM", targets: [SECURITY_ROLE, DIRECTORY, { type: "User", id: "u-2", displayName: "Adele Vance" }] })]);
        expect(events[0]).toMatchObject({ kind: "assignment", actor: { name: "Azure AD PIM", id: "", kind: "system" }, sentence: "Adele Vance removed from Security Administrator" });
    });
});

describe("mapAuditEvents: one action, one row (rule 4)", () => {
    it("merges requested and completed into one row at the time of the completed event", () => {
        const events = mapAuditEvents(activation());
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            kind: "usage",
            time: "2026-10-20T08:10:05.000Z",
            sentence: "Megan Bowen activated Security Administrator",
            actor: { name: "Megan Bowen", id: "u-1", kind: "person" },
            role: { name: "Security Administrator", id: "role-1" },
            scope: "Contoso",
            result: "success",
            reason: "Patch run",
            requestedDuration: 60,
            mfa: true,
            correlationId: "corr-1",
        });
    });

    it("never merges on a request id when the correlation ids differ, as daily expiry attempts share one", () => {
        const attempt = (day: string) => audit({
            id: `try-${day}`, correlationId: `corr-${day}`, time: `2026-10-${day}T23:00:00Z`, activity: "Remove member from role (PIM activation expired)",
            auditType: "RemoveActivatedRole", app: "Azure AD PIM", result: "failure", targets: [SECURITY_ROLE, DIRECTORY], details: { RequestId: "r-same" },
        });
        expect(mapAuditEvents([attempt("20"), attempt("21"), attempt("22")])).toHaveLength(3);
    });

    it("keeps an activation and its expiry apart when they share a correlation id, and a failed expiry does not fail the activation", () => {
        const expiry = (result: string) => audit({
            id: "end", correlationId: "corr-1", time: "2026-10-20T09:10:00Z", activity: "Remove member from role (PIM activation expired)",
            auditType: "RemoveActivatedRole", app: "Azure AD PIM", result, targets: [SECURITY_ROLE, DIRECTORY], details: { RoleAssignmentRequestId: "ra-1" },
        });
        const failed = mapAuditEvents([...activation(), expiry("failure")]);
        expect(failed).toHaveLength(2);
        expect(byId(failed, "done-corr-1")).toMatchObject({ kind: "usage", result: "success" });
        expect(byId(failed, "done-corr-1").usedMinutes).toBeUndefined();
        const done = mapAuditEvents([...activation(), expiry("success")]);
        expect(byId(done, "done-corr-1")).toMatchObject({ result: "success", usedMinutes: 59 });
        expect(byId(done, "end")).toMatchObject({ kind: "system" });
    });

    it("does not say it happened when only the request is in the log", () => {
        const [request] = activation();
        expect(mapAuditEvents([request])[0]).toMatchObject({ sentence: "Megan Bowen requested activation of Security Administrator", requestOnly: true, result: "success" });
        expect(mapAuditEvents(activation())[0].requestOnly).toBeUndefined();
        const assignment = audit({
            id: "a-req", time: "2026-10-20T08:00:00Z", activity: "Add eligible member requested", auditType: "CreateRequestEligibleRole", user: MEGAN,
            targets: [SECURITY_ROLE, DIRECTORY, { type: "User", id: "u-2", displayName: "Adele Vance" }],
        });
        expect(mapAuditEvents([assignment])[0].sentence).toBe("Assignment of Adele Vance for Security Administrator requested");
    });

    it("names an update of an assignment as an update, not as its first step", () => {
        const shared = { correlationId: "corr-u", user: MEGAN, targets: [SECURITY_ROLE, DIRECTORY, { type: "User", id: "u-2", displayName: "Adele Vance" }] };
        const events = mapAuditEvents([
            audit({ ...shared, id: "u-req", time: "2026-10-20T08:00:00Z", activity: "Update requested", auditType: "CreateRoleUpdateRequest" }),
            audit({ ...shared, id: "u-rem", time: "2026-10-20T08:00:01Z", activity: "Remove eligible member from role in PIM completed", auditType: "AdminRemoveEligibleRole" }),
            audit({ ...shared, id: "u-add", time: "2026-10-20T08:00:02Z", activity: "Add eligible member to role in PIM completed", auditType: "AssignEligibleRole" }),
        ]);
        expect(events).toHaveLength(1);
        expect(events[0].sentence).toBe("Assignment of Adele Vance for Security Administrator updated");
    });

    it("gives a failed activation its failure reason and result", () => {
        const events = mapAuditEvents([audit({
            id: "failed", result: "failure", resultReason: "Policy requires approval", time: "2026-10-20T08:10:00Z",
            activity: "Activate role request", auditType: "CreateRequestRoleActivation", user: MEGAN, targets: [SECURITY_ROLE, DIRECTORY],
        })]);
        expect(events[0]).toMatchObject({ kind: "usage", result: "failure", failureReason: "Policy requires approval", sentence: "Activation of Security Administrator by Megan Bowen failed" });
    });
});

describe("mapAuditEvents: direct add once (rule 5)", () => {
    const coreAdd = (time: string) => audit({
        id: `core-${time}`, service: "Core Directory", time, activity: "Add member to role", user: MEGAN,
        targets: [
            { type: "Role", id: "role-2" },
            { type: "User", id: "u-2", displayName: "Adele Vance", modifiedProperties: [{ displayName: "Role.DisplayName", newValue: "\"Exchange Administrator\"", oldValue: null }] },
            DIRECTORY,
        ],
    });
    const alert = (time: string) => audit({
        id: `alert-${time}`, time, activity: "Add member to role outside of PIM (permanent)", auditType: "RoleElevatedOutsidePimAlert", user: MEGAN,
        targets: [{ type: "Role", id: "role-2", displayName: "Exchange Administrator" }, { type: "User", id: "u-2", displayName: "Adele Vance" }, DIRECTORY],
    });

    it("gives one row, at the first time, when the core change and the alert are within 5 minutes", () => {
        const events = mapAuditEvents([coreAdd("2026-10-20T08:04:00Z"), alert("2026-10-20T08:00:00Z")]);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            kind: "outside",
            time: "2026-10-20T08:00:00.000Z",
            sentence: "Adele Vance added to Exchange Administrator outside PIM",
            role: { name: "Exchange Administrator", id: "role-2" },
            actor: { name: "Megan Bowen", kind: "person" },
            target: { name: "Adele Vance", id: "u-2" },
        });
    });

    it("gives two rows when they are 6 minutes apart", () => {
        const events = mapAuditEvents([coreAdd("2026-10-20T08:06:00Z"), alert("2026-10-20T08:00:00Z")]);
        expect(events).toHaveLength(2);
        expect(events.every((event) => event.kind === "outside")).toBe(true);
    });

    it("sets the removal from a core change in oldValue as an outside removal", () => {
        const removal = audit({
            id: "core-remove", service: "Core Directory", time: "2026-10-20T09:00:00Z", activity: "Remove member from role", user: MEGAN,
            targets: [{ type: "User", id: "u-2", displayName: "Adele Vance", modifiedProperties: [{ displayName: "Role.DisplayName", newValue: null, oldValue: "\"Exchange Administrator\"" }] }],
        });
        const [event] = mapAuditEvents([removal]);
        expect(event).toMatchObject({ kind: "outside", role: { name: "Exchange Administrator" }, sentence: "Adele Vance removed from Exchange Administrator outside PIM" });
    });
});

describe("mapAuditEvents: the end of an assignment", () => {
    const row = (auditType: string, details: Record<string, string>) => audit({
        id: "a", time: "2026-10-20T08:00:00Z", activity: "x", auditType, user: MEGAN, details,
        targets: [SECURITY_ROLE, DIRECTORY, { type: "User", id: "u-2", displayName: "Adele Vance" }],
    });

    it("keeps the end on an assignment with an end, in UTC", () => {
        expect(mapAuditEvents([row("AssignEligibleRole", { ExpirationTime: "2027-02-05T10:00:00Z" })])[0].endsAt).toBe("2027-02-05T10:00:00.000Z");
    });

    it("sets nothing without an end, and not on an activation", () => {
        expect(mapAuditEvents([row("AssignEligibleRole", {})])[0].endsAt).toBeUndefined();
        expect(mapAuditEvents([row("ActivateRole", { ExpirationTime: "2027-02-05T10:00:00Z" })])[0].endsAt).toBeUndefined();
    });
});

describe("mapAuditEvents: a Core Directory target has only a UPN", () => {
    const core = (activity: string, time: string, props: object) => audit({
        id: `core-${time}`, service: "Core Directory", time, activity, user: MEGAN,
        targets: [{ type: "User", id: "u-2", userPrincipalName: "adele@contoso.example", modifiedProperties: [{ displayName: "Role.DisplayName", ...props }] }, { type: "Role", id: "role-2" }],
    });

    it("uses the UPN for a direct removal, with the role from the old value", () => {
        const [event] = mapAuditEvents([core("Remove member from role", "2026-10-20T08:00:00Z", { oldValue: "\"Exchange Administrator\"", newValue: null })]);
        expect(event).toMatchObject({ kind: "outside", sentence: "adele@contoso.example removed from Exchange Administrator outside PIM" });
    });

    it("takes the display name from the alert when a direct add merges with it", () => {
        const alert = audit({
            id: "alert", time: "2026-10-20T08:01:30Z", activity: "Add member to role outside of PIM (permanent)", auditType: "RoleElevatedOutsidePimAlert", user: MEGAN,
            targets: [{ type: "Role", id: "role-2", displayName: "Exchange Administrator" }, { type: "User", id: "u-2", displayName: "Adele Vance" }],
        });
        const events = mapAuditEvents([core("Add member to role", "2026-10-20T08:00:00Z", { newValue: "\"Exchange Administrator\"", oldValue: null }), alert]);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ time: "2026-10-20T08:00:00.000Z", sentence: "Adele Vance added to Exchange Administrator outside PIM", target: { name: "Adele Vance" } });
    });
});

describe("mapAuditEvents: used for (rule 6)", () => {
    it("sets used fields on the activation from a linked deactivation and drops the deactivation as its own row", () => {
        const events = mapAuditEvents([...activation(), ...deactivation("ra-1")]);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            kind: "usage",
            usedMinutes: 30,
            endedAt: "2026-10-20T08:40:05.000Z",
            endedBy: { name: "Megan Bowen", id: "u-1", kind: "person" },
        });
    });

    it("sets used fields from a linked expiry without an end person, and keeps the expiry as a System row", () => {
        const expiry = audit({
            id: "expiry", time: "2026-10-20T09:10:05Z", activity: "Remove member from role (PIM activation expired)", auditType: "RemoveActivatedRole",
            app: "Azure AD PIM", targets: [SECURITY_ROLE, DIRECTORY], details: { RoleAssignmentRequestId: "ra-1" },
        });
        const events = mapAuditEvents([...activation(), expiry]);
        expect(events).toHaveLength(2);
        const used = events.find((event) => event.kind === "usage");
        expect(used).toMatchObject({ usedMinutes: 60, endedAt: "2026-10-20T09:10:05.000Z" });
        expect(used?.endedBy).toBeUndefined();
        expect(events.find((event) => event.kind === "system")).toMatchObject({ sentence: "Remove member from role (PIM activation expired)" });
    });

    it("leaves the used fields empty for a failed expiry", () => {
        const expiry = audit({
            id: "expiry-failed", result: "failure", resultReason: "Expired while the request was pending", time: "2026-10-20T09:10:00Z",
            activity: "Remove member from role (PIM activation expired)", auditType: "RemoveActivatedRole", app: "Azure AD PIM",
            targets: [SECURITY_ROLE, DIRECTORY], details: { RoleAssignmentRequestId: "ra-1" },
        });
        const events = mapAuditEvents([...activation(), expiry]);
        const used = byId(events, "done-corr-1");
        expect(used.usedMinutes).toBeUndefined();
        expect(used.endedAt).toBeUndefined();
        expect(byId(events, "expiry-failed")).toMatchObject({ result: "failure", failureReason: "Expired while the request was pending" });
    });

    it("keeps a deactivation without a matching start as a System row, with no used fields", () => {
        const events = mapAuditEvents(deactivation("ra-unknown"));
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ kind: "system", sentence: "Remove member from role completed (PIM deactivation)" });
        expect(events[0].usedMinutes).toBeUndefined();
        expect(events[0].endedBy).toBeUndefined();
    });

    it("leaves the used fields empty for an activation without an end", () => {
        const [event] = mapAuditEvents(activation());
        expect(event.usedMinutes).toBeUndefined();
        expect(event.endedAt).toBeUndefined();
        expect(event.endedBy).toBeUndefined();
    });
});

describe("mapAuditEvents: names and missing values (rules 4a and 7)", () => {
    it("names a group role as member of or owner of the group from the Other target", () => {
        const groupTargets = (memberKind: string): RawAuditTarget[] => [
            { type: "Role", id: "member-role", displayName: memberKind },
            { type: "Other", id: "g-1", displayName: "Engineering Team" },
            { type: "User", id: "u-2", displayName: "Adele Vance" },
        ];
        const rows = [
            audit({ id: "member", category: "GroupManagement", time: "2026-10-20T10:00:00Z", activity: "Add member to group", auditType: "AssignGrantedRole", user: MEGAN, targets: groupTargets("Member") }),
            audit({ id: "owner", category: "GroupManagement", time: "2026-10-20T11:00:00Z", activity: "Add owner to group", auditType: "AssignEligibleRole", user: MEGAN, targets: groupTargets("Owner") }),
        ];
        const events = mapAuditEvents(rows);
        expect(byId(events, "member")).toMatchObject({ environment: "group", sentence: "Adele Vance made active for member of Engineering Team", role: { name: "member of Engineering Team", id: "g-1" } });
        expect(byId(events, "owner")).toMatchObject({ environment: "group", sentence: "Adele Vance made eligible for owner of Engineering Team", role: { name: "owner of Engineering Team", id: "g-1" } });
    });

    it("leaves missing values empty and falls back to the activity when a sentence cannot be built", () => {
        const [event] = mapAuditEvents([audit({ id: "bare", time: "2026-10-20T12:00:00Z", activity: "Something without names", auditType: "ActivateRole" })]);
        expect(event).toMatchObject({ kind: "usage", sentence: "Something without names", role: { name: "", id: "" }, scope: "", actor: { name: "", kind: "system" } });
        expect(event.target).toBeUndefined();
    });

    it("does not throw on malformed modifiedProperties and reads the role only from valid entries", () => {
        const malformed = [
            { type: "User", id: "u-2", displayName: "Adele Vance", modifiedProperties: "oops" },
            { type: "Role", id: "role-2", modifiedProperties: [null, 3, { displayName: 5 }, { displayName: "Role.DisplayName", newValue: "\"Exchange Administrator\"" }] },
        ] as unknown as RawAuditTarget[];
        const rows = [audit({ id: "malformed", service: "Core Directory", time: "2026-10-20T13:00:00Z", activity: "Add member to role", user: MEGAN, targets: malformed })];
        const [event] = mapAuditEvents(rows);
        expect(event).toMatchObject({ kind: "outside", role: { name: "Exchange Administrator" }, sentence: "Adele Vance added to Exchange Administrator outside PIM" });
    });

    it("sorts the rows newest first", () => {
        const events = mapAuditEvents([
            audit({ id: "old", time: "2026-10-01T08:00:00Z", activity: "Triggered PIM alert", auditType: "ActivateAlert" }),
            audit({ id: "new", time: "2026-10-20T08:00:00Z", activity: "Triggered PIM alert", auditType: "ActivateAlert" }),
        ]);
        expect(events.map((event) => event.id)).toEqual(["new", "old"]);
    });
});

// Shapes measured in the test tenant on 2026-11-05; names and ids invented
describe("an activation with approval", () => {
    const ADELE = { id: "u-2", displayName: "Adele Vance" };
    const APPROVER = { id: "u-9", displayName: "Patti Fernandez" };
    const ROLE: RawAuditTarget = { type: "Role", id: "role-2", displayName: "Message Center Reader", modifiedProperties: [] };
    const USER: RawAuditTarget = { type: "User", id: ADELE.id, displayName: ADELE.displayName };
    const targets = [ROLE, DIRECTORY, USER];
    const RA = { RoleAssignmentRequestId: "ra-9" };
    const TICKET = { TicketNumber: "INC-1", TicketSystem: "TEST" };

    const request = audit({ id: "req", correlationId: "c-a", time: "2026-11-05T18:13:41Z", activity: "Add member to role requested (PIM activation)", auditType: "CreateRequestRoleActivation", user: ADELE, targets, details: { ...RA, ...TICKET, Justification: "Monthly check", StartTime: "2026-11-05T18:13:40Z", ExpirationTime: "2026-11-06T02:13:40Z" } });
    const approvalRequest = audit({ id: "appr-req", correlationId: "c-a", time: "2026-11-05T18:13:42Z", activity: "Add member to role approval requested (PIM activation)", auditType: "RequestApprovalRoleActivation", user: ADELE, targets, details: { ...RA, ...TICKET, Justification: "Monthly check" } });
    const approved = audit({ id: "approved", correlationId: "c-b", time: "2026-11-05T18:16:55Z", activity: "Add member to role request approved (PIM activation)", auditType: "ApproveRoleActivation", user: APPROVER, targets, resultReason: "Approver text", details: { ...RA, Justification: "Approver text" } });
    const completed = audit({ id: "done", correlationId: "c-b", time: "2026-11-05T18:17:01Z", activity: "Add member to role completed (PIM activation)", auditType: "ActivateRole", user: ADELE, targets, details: { ...RA, ...TICKET, Justification: "Monthly check" } });
    const denied = audit({ id: "denied", correlationId: "c-c", time: "2026-11-05T18:25:20Z", activity: "Add member to role request denied (PIM activation)", auditType: "RejectRoleActivation", user: APPROVER, targets, resultReason: "Approver text", details: { ...RA, Justification: "Approver text" } });
    const counted = (rows: RawDirectoryAudit[]) => indexActivations(mapAuditEvents(rows), 0, Date.parse("2026-11-06T00:00:00Z")).size;

    it("waiting for approval is a request: never activated, never counted", () => {
        const events = mapAuditEvents([request, approvalRequest]);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ kind: "usage", requestOnly: true, result: "success", sentence: "Adele Vance requested activation of Message Center Reader", ticket: "INC-1 (TEST)" });
        expect(events[0].approver).toBeUndefined();
        expect(counted([request, approvalRequest])).toBe(0);
    });

    it("approved and completed is one activation, by the requester, with the approver apart", () => {
        const events = mapAuditEvents([request, approvalRequest, approved, completed]);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            id: "done", time: "2026-11-05T18:17:01.000Z", kind: "usage", result: "success", sentence: "Adele Vance activated Message Center Reader",
            actor: { name: "Adele Vance", kind: "person" }, approver: "Patti Fernandez", ticket: "INC-1 (TEST)", reason: "Monthly check",
        });
        expect(events[0].requestOnly).toBeUndefined();
        expect(events[0].denied).toBeUndefined();
        expect(counted([request, approvalRequest, approved, completed])).toBe(1);
    });

    it("approved without a completion in the log is not told as done", () => {
        const events = mapAuditEvents([request, approvalRequest, approved]);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ requestOnly: true, approver: "Patti Fernandez", sentence: "Adele Vance requested activation of Message Center Reader" });
        expect(counted([request, approvalRequest, approved])).toBe(0);
    });

    it("denied is one event, by the requester, denied by the approver, and does not count", () => {
        const events = mapAuditEvents([request, approvalRequest, denied]);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ id: "denied", kind: "usage", result: "failure", denied: true, approver: "Patti Fernandez", actor: { name: "Adele Vance" }, reason: "Monthly check", sentence: "Activation of Message Center Reader by Adele Vance denied" });
        expect(events[0].failureReason).toBeUndefined();
        expect(counted([request, approvalRequest, denied])).toBe(0);
    });

    it("the approver's text is never the reason, also when the request fell outside the read", () => {
        const [lone] = mapAuditEvents([denied]);
        expect(lone).toMatchObject({ denied: true, approver: "Patti Fernandez", actor: { name: "Adele Vance", id: ADELE.id, kind: "person" } });
        expect(lone.reason).toBeUndefined();
        const [late] = mapAuditEvents([approved, completed]);
        expect(late).toMatchObject({ actor: { name: "Adele Vance" }, approver: "Patti Fernandez", reason: "Monthly check" });
    });

    it("never names the approver as the requester when only the decision is in the log (measured)", () => {
        const onGroup = audit({ id: "denied-g", time: "2026-11-05T19:17:38Z", activity: "Add member to role request denied (PIM activation)", auditType: "RejectRoleActivation", user: APPROVER, category: "GroupManagement", targets: [{ type: "Role", id: "r", displayName: "Member" }, { type: "Other", id: "g-1", displayName: "PIM-Sales" }, { type: "User", id: APPROVER.id, displayName: APPROVER.displayName }], details: { RoleAssignmentRequestId: "ra-7", Justification: "Approver text" } });
        const [event] = mapAuditEvents([onGroup]);
        expect(event).toMatchObject({ denied: true, approver: "Patti Fernandez", actor: { name: "" }, result: "failure", sentence: "Add member to role request denied (PIM activation)" });
        expect(event.target).toBeUndefined();
        expect(event.reason).toBeUndefined();
    });

    it("joins a group's approval flow to one activation by the requester", () => {
        const group: RawAuditTarget[] = [{ type: "Role", id: "r", displayName: "Member" }, { type: "Other", id: "g-1", displayName: "PIM-Sales" }];
        const row = (id: string, c: string, time: string, activity: string, auditType: string, who: { id: string; displayName: string }, Justification: string) => audit({ id, correlationId: c, time, activity, auditType, user: who, category: "GroupManagement", targets: [...group, { type: "User", id: who.id, displayName: who.displayName }], details: { RoleAssignmentRequestId: "ra-8", Justification } });
        const events = mapAuditEvents([
            row("g1", "x", "2026-11-05T19:10:07Z", "Add member to role requested (PIM activation)", "CreateRequestRoleActivation", ADELE, "Monthly check"),
            row("g2", "x", "2026-11-05T19:10:08Z", "Add member to role approval requested (PIM activation)", "RequestApprovalRoleActivation", ADELE, "Monthly check"),
            row("g3", "y", "2026-11-05T19:10:42Z", "Add member to role request approved (PIM activation)", "ApproveRoleActivation", APPROVER, "Approver text"),
            row("g4", "y", "2026-11-05T19:10:48Z", "Add member to role completed (PIM activation)", "ActivateRole", ADELE, "Monthly check"),
        ]);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ environment: "group", sentence: "Adele Vance activated member of PIM-Sales", target: { name: "Adele Vance" }, actor: { name: "Adele Vance" }, approver: "Patti Fernandez", reason: "Monthly check", role: { id: "g-1" } });
    });

    it("keeps a deactivation out of the join and links it to the activation it ends", () => {
        const deactivation = audit({ id: "deact", correlationId: "c-d", time: "2026-11-05T18:22:41Z", activity: "Remove member from role completed (PIM deactivate)", auditType: "DeactivateRole", user: ADELE, targets, details: RA });
        const events = mapAuditEvents([request, approvalRequest, approved, completed, deactivation]);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ usedMinutes: 5, endedBy: { name: "Adele Vance" }, approver: "Patti Fernandez" });
    });

    it("reads a ticket without a system, and no ticket as none", () => {
        const onlyNumber = audit({ id: "n", time: "2026-11-05T18:00:00Z", activity: "Add member to role completed (PIM activation)", auditType: "ActivateRole", user: ADELE, targets, details: { TicketNumber: "INC-2" } });
        expect(mapAuditEvents([onlyNumber])[0].ticket).toBe("INC-2");
        const none = audit({ id: "x", time: "2026-11-05T18:00:00Z", activity: "Add member to role completed (PIM activation)", auditType: "ActivateRole", user: ADELE, targets });
        expect(mapAuditEvents([none])[0].ticket).toBeUndefined();
    });

    it("tells a refused deactivation by the person as a refused deactivation, an admin's refused removal as a failed removal (AU-17)", () => {
        const refused = audit({ id: "ref", time: "2026-11-05T18:18:38Z", activity: "Process role removal request", auditType: "CreateRoleRemovalRequest", result: "failure", resultReason: "ActiveDurationTooShort", user: ADELE, targets });
        expect(mapAuditEvents([refused])[0]).toMatchObject({ kind: "usage", result: "failure", failureReason: "ActiveDurationTooShort", sentence: "Deactivation of Message Center Reader by Adele Vance refused" });
        const byAdmin = audit({ id: "ref-a", time: "2026-11-05T18:18:38Z", activity: "Process role removal request", auditType: "CreateRoleRemovalRequest", result: "failure", user: APPROVER, targets });
        expect(mapAuditEvents([byAdmin])[0]).toMatchObject({ kind: "assignment", sentence: "Removal of Adele Vance from Message Center Reader failed" });
    });

    it("names the group of a role activation through an eligible group, as measured (AU-17)", () => {
        const GROUP: RawAuditTarget = { type: "Group", id: "g-1", displayName: "Contoso Message Readers" };
        const viaGroup = audit({ id: "vg", time: "2026-11-12T18:57:24Z", activity: "Add member to role completed (PIM activation)", auditType: "ActivateRole", user: ADELE, targets: [...targets, GROUP] });
        expect(mapAuditEvents([viaGroup])[0]).toMatchObject({ kind: "usage", viaGroup: "Contoso Message Readers", target: { name: "Adele Vance" } });
        const direct = audit({ id: "d", time: "2026-11-12T18:57:24Z", activity: "Add member to role completed (PIM activation)", auditType: "ActivateRole", user: ADELE, targets });
        expect(mapAuditEvents([direct])[0].viaGroup).toBeUndefined();
    });

    it("tells an activation ended by an admin's removal from one that expired, by who initiated the end (AU-17)", () => {
        const done = audit({ id: "on", correlationId: "c-on", time: "2026-11-12T15:18:52Z", activity: "Add member to role completed (PIM activation)", auditType: "ActivateRole", user: ADELE, targets, details: RA });
        const ADMIN = { id: "u-7", displayName: "Alex Wilber", userPrincipalName: "alexw@contoso.com" };
        const removedEnd = audit({ id: "end", correlationId: "c-rm", time: "2026-11-12T15:24:36Z", activity: "Remove member from role (PIM activation expired)", auditType: "RemoveActivatedRole", user: ADMIN, targets, details: RA });
        const [removed] = mapAuditEvents([done, removedEnd]);
        expect(removed).toMatchObject({ usedMinutes: 5, endedBy: { name: "Alex Wilber" } });
        expect(mapAuditEvents([done, removedEnd])).toHaveLength(1);
        const SERVICE = { id: "svc-1", displayName: "Azure AD PIM" };
        const expiredEnd = audit({ id: "exp", correlationId: "c-ex", time: "2026-11-12T15:24:36Z", activity: "Remove member from role (PIM activation expired)", auditType: "RemoveActivatedRole", user: SERVICE, targets, details: RA });
        const expired = mapAuditEvents([done, expiredEnd]);
        expect(expired.find((event) => event.id === "on")?.endedBy).toBeUndefined();
        expect(expired).toHaveLength(2);
    });

    it("reads the scope of a scoped activation as measured", () => {
        const scoped = audit({ id: "s", time: "2026-11-05T18:11:44Z", activity: "Add member to role completed (PIM activation)", auditType: "ActivateRole", user: ADELE, targets, details: { ResourceOriginId: "/", ScopedResourceOriginId: "/administrativeUnits/au-1" } });
        expect(mapAuditEvents([scoped])[0].directoryScopeId).toBe("/administrativeUnits/au-1");
    });

    it("tells a removal as a removal, whatever row comes first (measured)", () => {
        const removal = (id: string, requestType: string, doneType: string) => [
            audit({ id: `${id}-r`, correlationId: id, time: "2026-11-05T18:30:47Z", activity: "Remove eligible member from role in PIM requested (timebound)", auditType: requestType, user: APPROVER, targets }),
            audit({ id: `${id}-d`, correlationId: id, time: "2026-11-05T18:30:48Z", activity: "Remove eligible member from role in PIM completed (timebound)", auditType: doneType, user: APPROVER, targets }),
        ];
        expect(mapAuditEvents(removal("e", "CreateRequestEligibleRoleRemoval", "AdminRemoveEligibleRole"))[0].sentence).toBe("Adele Vance removed from Message Center Reader");
        expect(mapAuditEvents(removal("g", "CreateRequestGrantedRoleRemoval", "AdminRemoveGrantedRole"))[0].sentence).toBe("Adele Vance removed from Message Center Reader");
        expect(mapAuditEvents(removal("o", "CreateRequestEligibleRoleRemoval", "AdminRemoveEligibleRole").slice(0, 1))[0].sentence).toBe("Assignment of Adele Vance for Message Center Reader requested");
    });

    it("names a group as the subject of an assignment to a group, not who made it", () => {
        const toGroup = audit({ id: "tg", time: "2026-11-05T18:08:18Z", activity: "Add eligible member to role in PIM completed (timebound)", auditType: "AssignEligibleRole", user: APPROVER, targets: [ROLE, DIRECTORY, { type: "Group", id: "g-2", displayName: "PIM-Helpdesk" }] });
        expect(mapAuditEvents([toGroup])[0]).toMatchObject({ sentence: "PIM-Helpdesk made eligible for Message Center Reader", target: { name: "PIM-Helpdesk" }, actor: { name: "Patti Fernandez" } });
    });
});

describe("mapAuditEvents: an admin's request and its completion are one row (rule 6b)", () => {
    const ADMIN = { id: "admin-1", displayName: "Adele Vance", userPrincipalName: "adele@contoso.example" };
    const PIM_SERVICE = { id: "pim-service", displayName: "Azure AD PIM" };
    const MEGAN_TARGET: RawAuditTarget = { type: "User", id: "u-1", displayName: "Megan Bowen" };

    /** The admin's request, at 16:06 by default */
    function eligibleRequest(raId: string, time = "2026-11-05T16:06:00Z"): RawDirectoryAudit {
        return audit({
            id: `req-${raId}`, correlationId: `corr-req-${raId}`, time, user: ADMIN, targets: [SECURITY_ROLE, DIRECTORY, MEGAN_TARGET],
            activity: "Add eligible member to role in PIM requested (timebound)", auditType: "CreateRequestEligibleRole",
            details: { RoleAssignmentRequestId: raId },
        });
    }

    /** The completion by the PIM service, at 16:08 by default, with the start in StartTime */
    function eligibleCompletion(raId: string, time = "2026-11-05T16:08:00Z"): RawDirectoryAudit {
        return audit({
            id: `done-${raId}`, correlationId: `corr-done-${raId}`, time, user: PIM_SERVICE, targets: [SECURITY_ROLE, DIRECTORY, MEGAN_TARGET],
            activity: "Add eligible member to role in PIM completed (timebound)", auditType: "AssignEligibleRole",
            details: { RoleAssignmentRequestId: raId, StartTime: "2026-11-05T16:07:00Z" },
        });
    }

    it("gives one row: the completion's sentence, the admin as actor, the time of the request, and the start", () => {
        const events = mapAuditEvents([eligibleCompletion("ra-p3"), eligibleRequest("ra-p3")]);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            kind: "assignment",
            result: "success",
            sentence: "Megan Bowen made eligible for Security Administrator",
            actor: { name: "Adele Vance", id: "admin-1", kind: "person" },
            time: "2026-11-05T16:06:00.000Z",
            startsAt: "2026-11-05T16:08:00.000Z",
        });
        expect(events[0].requestOnly).toBeUndefined();
    });

    it("leaves out startsAt when the completion came 10 seconds after the request", () => {
        const events = mapAuditEvents([eligibleRequest("ra-p4"), eligibleCompletion("ra-p4", "2026-11-05T16:06:10Z")]);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ sentence: "Megan Bowen made eligible for Security Administrator", time: "2026-11-05T16:06:00.000Z" });
        expect(events[0].startsAt).toBeUndefined();
    });

    it("keeps a request alone as a request-only row", () => {
        const events = mapAuditEvents([eligibleRequest("ra-p5")]);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ requestOnly: true, sentence: "Assignment of Megan Bowen for Security Administrator requested", actor: { name: "Adele Vance" } });
        expect(events[0].startsAt).toBeUndefined();
    });

    it("keeps two rows when the request and the completion have different RoleAssignmentRequestIds", () => {
        const events = mapAuditEvents([eligibleRequest("ra-p6"), eligibleCompletion("ra-p7")]);
        expect(events).toHaveLength(2);
        expect(events.map((event) => event.requestOnly === true).sort()).toEqual([false, true]);
    });
});
