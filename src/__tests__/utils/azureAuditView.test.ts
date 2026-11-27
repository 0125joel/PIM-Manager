import { describe, expect, it } from "vitest";
import type { AuditEvent } from "@/types/audit.types";
import type { ArmRoleDefinition, AzureScope } from "@/types/azureResource.types";
import { judgeEventPrivilege } from "@/utils/auditPrivilege";
import { AZURE_PRIVILEGED_ROLE_IDS } from "@/utils/azureDashboard";
import type { AzureAuditNotRead } from "@/utils/azureAuditRead";
import { aboveSubscriptionsNote, azureApproverNote, azureAuditCoverage, azureAuditNotice, azureAuditNotReadText, azureGroupLogNotice, buildAzureAuditPrivilege, describeAzureAuditScopeBar, filterAuditEventsByScope, isAzureAuditUnreadable, isAzureAuditUnreadableNow, joinAzureNotices } from "@/utils/azureAuditView";

// Invented data only: Contoso names, made-up ids.
const HOME = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const MG = "/providers/Microsoft.Management/managementGroups/contoso-platform";
const S1 = "/subscriptions/s-1";
const S2 = "/subscriptions/s-2";
const S3 = "/subscriptions/s-3";
const RG1 = `${S1}/resourceGroups/rg-web`;
const RG2 = `${S1}/resourceGroups/rg-data`;

const scopes: AzureScope[] = [
    { id: "/", name: "Root", level: "root", parentId: null },
    { id: MG, name: "Contoso Platform", level: "managementGroup", parentId: "/" },
    { id: S1, name: "Contoso Production", level: "subscription", parentId: MG, tenantId: HOME },
    { id: S2, name: "Fabrikam Delegated", level: "subscription", parentId: MG, tenantId: OTHER },
    { id: S3, name: "Contoso Test", level: "subscription", parentId: MG, tenantId: HOME },
    { id: RG1, name: "rg-web", level: "resourceGroup", parentId: S1 },
    { id: RG2, name: "rg-data", level: "resourceGroup", parentId: S1 },
];

function event(id: string, scopeId: string | null, extra: Partial<AuditEvent> = {}): AuditEvent {
    const segments = (scopeId ?? "").split("/").filter(Boolean);
    return {
        id,
        time: "2026-11-01T10:00:00.000Z",
        kind: "usage",
        environment: "role",
        sentence: id,
        actor: { name: "Megan Bowen", id: "u-1", kind: "person" },
        role: { name: "Reader", id: "acdd72a7-3385-48ef-bd42-f606fba81ae7" },
        scope: "scope",
        result: "success",
        source: "arm",
        correlationId: id,
        ...(scopeId === null ? {} : { azure: { scopeId, scopeName: "scope", scopeLevel: "subscription" as const, subscriptionId: segments[0] === "subscriptions" ? segments[1] : "" } }),
        ...extra,
    };
}

const ids = (events: AuditEvent[]) => events.map((e) => e.id);
const base = { scopes, chosenScopeId: null, includeInherited: false, includeDelegated: true, homeTenantId: HOME };

describe("filterAuditEventsByScope", () => {
    const events = [event("on-s1", S1), event("on-rg1", RG1), event("on-rg2", RG2), event("on-s2", S2), event("on-s3", S3), event("on-mg", MG), event("no-azure", null)];

    it("keeps everything without a chosen scope, also an event without azure", () => {
        expect(ids(filterAuditEventsByScope(events, base))).toEqual(ids(events));
    });

    it("takes the delegated subscription out when it is off, and keeps an event without azure", () => {
        expect(ids(filterAuditEventsByScope(events, { ...base, includeDelegated: false }))).toEqual(["on-s1", "on-rg1", "on-rg2", "on-s3", "on-mg", "no-azure"]);
    });

    it("keeps what is at or below the chosen scope, and drops an event without azure", () => {
        expect(ids(filterAuditEventsByScope(events, { ...base, chosenScopeId: S1 }))).toEqual(["on-s1", "on-rg1", "on-rg2"]);
        expect(ids(filterAuditEventsByScope(events, { ...base, chosenScopeId: RG1 }))).toEqual(["on-rg1"]);
    });

    it("keeps everything below a management group above the subscriptions, through parentId", () => {
        expect(ids(filterAuditEventsByScope(events, { ...base, chosenScopeId: MG }))).toEqual(["on-s1", "on-rg1", "on-rg2", "on-s2", "on-s3", "on-mg"]);
    });

    it("adds what is above the chosen scope with Include inherited", () => {
        expect(ids(filterAuditEventsByScope(events, { ...base, chosenScopeId: RG1, includeInherited: true }))).toEqual(["on-s1", "on-rg1", "on-mg"]);
    });

    it("combines a chosen scope with delegated off", () => {
        expect(ids(filterAuditEventsByScope(events, { ...base, chosenScopeId: MG, includeDelegated: false }))).toEqual(["on-s1", "on-rg1", "on-rg2", "on-s3", "on-mg"]);
    });

    it("treats a chosen id that is not in the tree as none chosen, without case", () => {
        expect(ids(filterAuditEventsByScope(events, { ...base, chosenScopeId: "/subscriptions/unknown" }))).toEqual(ids(events));
        expect(ids(filterAuditEventsByScope(events, { ...base, chosenScopeId: S1.toUpperCase() }))).toEqual(["on-s1", "on-rg1", "on-rg2"]);
    });
});

describe("isAzureAuditUnreadable", () => {
    const refused = (id: string, reason: AzureAuditNotRead["reason"] = "refused"): AzureAuditNotRead => ({ part: "requests", scopeId: `/subscriptions/${id}`, reason });

    it("is true without subscriptions", () => {
        expect(isAzureAuditUnreadable({ subscriptionIds: [], notRead: [], eventCount: 0 })).toBe(true);
    });

    it("lets events win over having no subscriptions, and is true without both", () => {
        expect(isAzureAuditUnreadable({ subscriptionIds: [], notRead: [], eventCount: 3 })).toBe(false);
        expect(isAzureAuditUnreadable({ subscriptionIds: [], notRead: [], eventCount: 0 })).toBe(true);
    });

    it("is false on an empty log with a readable subscription", () => {
        expect(isAzureAuditUnreadable({ subscriptionIds: ["s-1"], notRead: [], eventCount: 0 })).toBe(false);
        expect(isAzureAuditUnreadable({ subscriptionIds: ["s-1", "s-2"], notRead: [refused("s-1")], eventCount: 0 })).toBe(false);
    });

    it("is true when there is no event and every subscription was refused or forbidden, without case", () => {
        expect(isAzureAuditUnreadable({ subscriptionIds: ["S-1", "s-2"], notRead: [refused("s-1"), refused("S-2", "forbidden")], eventCount: 0 })).toBe(true);
    });

    it("is false when a reason is another one, the part is the log, or there are events", () => {
        expect(isAzureAuditUnreadable({ subscriptionIds: ["s-1"], notRead: [refused("s-1", "budget")], eventCount: 0 })).toBe(false);
        expect(isAzureAuditUnreadable({ subscriptionIds: ["s-1"], notRead: [{ part: "log", scopeId: "/subscriptions/s-1", reason: "refused" }], eventCount: 0 })).toBe(false);
        expect(isAzureAuditUnreadable({ subscriptionIds: ["s-1"], notRead: [refused("s-1")], eventCount: 1 })).toBe(false);
    });
});

describe("isAzureAuditUnreadableNow", () => {
    const every: AzureAuditNotRead[] = [{ part: "requests", scopeId: "/subscriptions/s-1", reason: "refused" }];
    const input = { subscriptionIds: ["s-1"], notRead: every, eventCount: 0 };

    it("holds for a finished read and for a failed one where every read was refused", () => {
        expect(isAzureAuditUnreadableNow("ready", input)).toBe(true);
        expect(isAzureAuditUnreadableNow("failed", input)).toBe(true);
    });

    it("leaves a failed read with an empty notRead, and any other status, as they are", () => {
        expect(isAzureAuditUnreadableNow("failed", { ...input, notRead: [] })).toBe(false);
        expect(isAzureAuditUnreadableNow("loading", input)).toBe(false);
        expect(isAzureAuditUnreadableNow("idle", input)).toBe(false);
        expect(isAzureAuditUnreadableNow("too-many", input)).toBe(false);
    });
});

describe("azureAuditNotice", () => {
    it("is null without a read that gave nothing in a subscription", () => {
        expect(azureAuditNotice([], scopes)).toBeNull();
        expect(azureAuditNotice([{ part: "log", scopeId: "/", reason: "forbidden" }, { part: "log", scopeId: MG, reason: "forbidden" }], scopes)).toBeNull();
    });

    it("names the subscription and the reason, and counts a resource group below one for that subscription once", () => {
        const notice = azureAuditNotice([
            { part: "requests", scopeId: S1, reason: "refused" },
            { part: "requests", scopeId: RG1, reason: "refused" },
            { part: "requests", scopeId: RG2, reason: "refused" },
        ], scopes);
        expect(notice).toEqual({
            title: "1 of 3 subscriptions could not be read",
            detail: "(Contoso Production: your role does not allow this). Events from them are missing from this list.",
        });
    });

    it("joins the names and the reasons when they differ, and falls back to the id", () => {
        const notice = azureAuditNotice([
            { part: "requests", scopeId: S1, reason: "forbidden" },
            { part: "log", scopeId: S2, reason: "gone" },
            { part: "requests", scopeId: "/subscriptions/s-9", reason: "budget" },
        ], scopes);
        expect(notice?.title).toBe("3 of 3 subscriptions could not be read");
        expect(notice?.detail).toBe("(Contoso Production: no access; Fabrikam Delegated: no longer there; s-9: not reached in this read). Events from them are missing from this list.");
    });
});

describe("export lines", () => {
    it("tells what could not be read for the Not read line, and nothing when all was read", () => {
        expect(azureAuditNotReadText([], scopes)).toBeUndefined();
        expect(azureAuditNotReadText([{ part: "requests", scopeId: S1, reason: "refused" }], scopes))
            .toBe("1 of 3 subscriptions could not be read (Contoso Production: your role does not allow this). Events from them are missing from this list.");
        expect(azureAuditNotReadText([{ part: "log", scopeId: MG, reason: "forbidden" }], scopes)).toBe("Changes above the subscriptions are not in this export: the exporter's roles do not reach them.");
    });

    it("describes the scope bar choices, and nothing for the defaults", () => {
        const defaults = { scopes, chosenScopeId: null, includeInherited: false, includeDelegated: true };
        expect(describeAzureAuditScopeBar(defaults)).toBe("");
        expect(describeAzureAuditScopeBar({ ...defaults, chosenScopeId: RG1, includeInherited: true, includeDelegated: false }))
            .toBe("Scope: rg-web (Resource group), Include inherited, Delegated subscriptions off");
        // Include inherited means nothing without a chosen scope, and an id the tree does not hold is none chosen
        expect(describeAzureAuditScopeBar({ ...defaults, includeInherited: true })).toBe("");
        expect(describeAzureAuditScopeBar({ ...defaults, chosenScopeId: "/subscriptions/unknown", includeInherited: true })).toBe("");
    });
});

describe("azureAuditNotice reasons per subscription", () => {
    it("names each subscription with its own reason, in the order the brief gives", () => {
        const notice = azureAuditNotice([
            { part: "requests", scopeId: S1, reason: "refused" },
            { part: "requests", scopeId: S2, reason: "forbidden" },
        ], scopes);
        expect(notice?.detail).toBe("(Contoso Production: your role does not allow this; Fabrikam Delegated: no access). Events from them are missing from this list.");
    });

    it.each([
        [["budget", "gone", "refused", "forbidden"], "no access"],
        [["budget", "gone", "refused"], "your role does not allow this"],
        [["budget", "gone"], "no longer there"],
        [["budget"], "not reached in this read"],
    ] as const)("shows one reason for a subscription with %j: %s", (reasons, text) => {
        const notice = azureAuditNotice(reasons.map((reason, index) => ({ part: index % 2 === 0 ? "log" as const : "requests" as const, scopeId: index % 2 === 0 ? S1 : RG1, reason })), scopes);
        expect(notice?.detail).toBe(`(Contoso Production: ${text}). Events from them are missing from this list.`);
    });
});

describe("azureAuditCoverage", () => {
    it("names the Azure sources, and adds the Entra audit log when it was read", () => {
        expect(azureAuditCoverage([], "no permission")).toEqual({ label: "Azure activity log and PIM requests", notes: ["Azure leaves out what your roles cannot see."] });
        expect(azureAuditCoverage([], "read").label).toBe("Azure activity log, PIM requests, Entra audit log");
        expect(azureAuditCoverage([], null).label).toBe("Azure activity log and PIM requests");
    });

    it("adds one note when the read added the user's own requests on scopes the user cannot read, and none otherwise", () => {
        expect(azureAuditCoverage([], "read", undefined, 2).notes).toEqual(["Your own requests on scopes you cannot read are included.", "Azure leaves out what your roles cannot see."]);
        expect(azureAuditCoverage([], "read", undefined, 0).notes).toEqual(["Azure leaves out what your roles cannot see."]);
        expect(azureAuditCoverage([], "read").notes).not.toContain("Your own requests on scopes you cannot read are included.");
    });

    it("says when activations through a group are missing, never a silent gap", () => {
        expect(azureGroupLogNotice("no permission", 30, true)?.title).toBe("Activity through a group is missing.");
        expect(azureGroupLogNotice("no permission", 30, true)?.detail).toContain("permission for that log has not been granted");
        expect(azureGroupLogNotice("failed", 30, true)?.detail).toContain("could not be read");
        expect(azureGroupLogNotice("read", 90, true)?.title).toBe("Activity through a group goes back 30 days.");
        expect(azureGroupLogNotice("read", 30, true)).toBeNull();
        expect(azureGroupLogNotice("no permission", 90, false)).toBeNull();
        expect(azureGroupLogNotice(null, 90, true)).toBeNull();
    });

    it("joins two notices under the first title", () => {
        const a = { title: "A", detail: "First." };
        const b = { title: "B.", detail: "Second." };
        expect(joinAzureNotices(a, b)).toEqual({ title: "A", detail: "First. B. Second." });
        expect(joinAzureNotices(null, b)).toBe(b);
        expect(joinAzureNotices(a, null)).toBe(a);
        expect(joinAzureNotices(null, null)).toBeNull();
    });

    it("says what is above the subscriptions before the standing note", () => {
        const note = "Changes above the subscriptions are not in this list: your roles do not reach them.";
        expect(azureAuditCoverage([{ part: "log", scopeId: "/", reason: "forbidden" }], "read").notes).toEqual([note, "Azure leaves out what your roles cannot see."]);
        expect(azureAuditCoverage([{ part: "log", scopeId: MG, reason: "refused" }], "read").notes[0]).toBe(note);
        expect(azureAuditCoverage([{ part: "log", scopeId: S1, reason: "refused" }], "read").notes).toEqual(["Azure leaves out what your roles cannot see."]);
    });
});

describe("azureApproverNote", () => {
    const now = new Date("2026-11-05T12:00:00Z");
    const decided = (extra: Partial<AuditEvent> = {}) => event("a", S1, { hadApproval: true, time: "2026-11-01T10:00:00.000Z", ...extra });

    it("is null without an approval, or when the approver is known", () => {
        expect(azureApproverNote(event("a", S1), "read", now)).toBeNull();
        expect(azureApproverNote(decided({ approver: "Alex Wilber" }), "no permission", now)).toBeNull();
    });

    it("says the Entra audit log keeps 30 days for an older event, first", () => {
        const text = "The Entra audit log keeps 30 days, so the approver of this request is no longer there.";
        expect(azureApproverNote(decided({ time: "2026-09-01T10:00:00.000Z" }), "no permission", now)).toBe(text);
        expect(azureApproverNote(decided({ time: "2026-09-01T10:00:00.000Z" }), "read", now)).toBe(text);
    });

    it("points to the permission when it is missing, and says the log could not be read in any other state", () => {
        expect(azureApproverNote(decided(), "no permission", now)).toBe("Azure does not say who decided. That is in the Entra audit log: grant its permission on the Entra Audit page to show it here.");
        for (const state of ["no token", "no reader role", "too many", "failed"] as const) {
            expect(azureApproverNote(decided(), state, now)).toBe("Azure does not say who decided, and the Entra audit log could not be read.");
        }
    });

    it("draws the line at 30 days: 29 days old gets the permission text, 31 days old the keeps-30-days text", () => {
        const daysOld = (days: number) => decided({ time: new Date(now.getTime() - days * 86_400_000).toISOString() });
        expect(azureApproverNote(daysOld(29), "no permission", now)).toBe("Azure does not say who decided. That is in the Entra audit log: grant its permission on the Entra Audit page to show it here.");
        expect(azureApproverNote(daysOld(31), "no permission", now)).toBe("The Entra audit log keeps 30 days, so the approver of this request is no longer there.");
    });

    it("says nothing for a request without a decision yet", () => {
        expect(azureApproverNote(decided({ requestOnly: true }), "no permission", now)).toBeNull();
        expect(azureApproverNote(decided({ requestOnly: true, time: "2026-09-01T10:00:00.000Z" }), "failed", now)).toBeNull();
    });

    it("says nothing when the Entra audit log was read, or not asked for yet", () => {
        expect(azureApproverNote(decided(), "read", now)).toBeNull();
        expect(azureApproverNote(decided(), null, now)).toBeNull();
    });
});

describe("buildAzureAuditPrivilege", () => {
    const READER = "acdd72a7-3385-48ef-bd42-f606fba81ae7";
    const CUSTOM_BIG = "aaaaaaaa-0000-0000-0000-000000000001";
    const OWNER = [...AZURE_PRIVILEGED_ROLE_IDS][0];
    const definition = (id: string, actions: string[]): ArmRoleDefinition => ({
        id: `/providers/Microsoft.Authorization/roleDefinitions/${id}`,
        name: id,
        type: "Microsoft.Authorization/roleDefinitions",
        properties: { roleName: id, type: "CustomRole", permissions: [{ actions, notActions: [], dataActions: [], notDataActions: [] }] },
    });
    const definitions = new Map([[READER, definition(READER, ["*/read"])], [CUSTOM_BIG, definition(CUSTOM_BIG, ["Microsoft.Authorization/roleAssignments/write"])]]);
    const judged = (privilege: ReturnType<typeof buildAzureAuditPrivilege>, roleId: string, extra: Partial<AuditEvent> = {}) => judgeEventPrivilege(event("x", S1, { role: { id: roleId, name: "Role" }, ...extra }), privilege);

    it("is reported, with empty names and holders, and the holder kinds as given", () => {
        const kinds = new Map([["sp-1", "servicePrincipal" as const]]);
        const privilege = buildAzureAuditPrivilege(null, kinds);
        expect(privilege.isReported).toBe(true);
        expect(privilege.byRoleName.size).toBe(0);
        expect(privilege.holdersOfPrivileged.size).toBe(0);
        expect(privilege.holderKinds).toBe(kinds);
    });

    it("judges the built-in privileged roles true, and a role it does not know null, before the definitions are in", () => {
        const privilege = buildAzureAuditPrivilege(null, new Map());
        expect(judged(privilege, OWNER)).toBe(true);
        expect(judged(privilege, OWNER.toUpperCase())).toBe(true);
        expect(judged(privilege, READER)).toBeNull();
    });

    it("judges each role of the definitions by its actions, true and false, and a role outside them null", () => {
        const privilege = buildAzureAuditPrivilege(definitions, new Map());
        expect(judged(privilege, CUSTOM_BIG)).toBe(true);
        expect(judged(privilege, READER)).toBe(false);
        expect(judged(privilege, OWNER)).toBe(true);
        expect(judged(privilege, "bbbbbbbb-0000-0000-0000-000000000002")).toBeNull();
    });

    it("judges an Azure group row by the Azure role in role.id, and an Entra group row by the group", () => {
        const privilege = buildAzureAuditPrivilege(definitions, new Map());
        expect(judged(privilege, CUSTOM_BIG, { environment: "group" })).toBe(true);
        expect(judged(privilege, READER, { environment: "group" })).toBe(false);
        const entraGroup = event("g", null, { environment: "group", role: { id: CUSTOM_BIG, name: "Member of Admins" } });
        expect(judgeEventPrivilege(entraGroup, privilege)).toBe(false);
    });
});

describe("aboveSubscriptionsNote (AU-17, I4)", () => {
    it("names what a long period cannot hold above the subscriptions, only with a workspace and past 90 days", () => {
        expect(aboveSubscriptionsNote(180, true)).toBe("Older than 90 days, above the subscriptions only PIM activity is known, from the Entra audit log: a direct change to a management group or the tenant root is not.");
        expect(aboveSubscriptionsNote(90, true)).toBe("");
        expect(aboveSubscriptionsNote(180, false)).toBe("");
    });
});
