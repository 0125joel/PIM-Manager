import { describe, it, expect } from "vitest";
import { buildAuditPrivilege, judgeEventPrivilege, judgeGroupPrivilege, unjudgedText } from "@/utils/auditPrivilege";
import { mapAuditEvents } from "@/utils/auditEvents";
import { buildNoActivationRows, filterNoActivationRows } from "@/utils/auditNoActivation";
import { buildAuditSearch, parseAuditUrlState, type AuditUrlState } from "@/utils/auditUrlState";
import { describeAuditFilter } from "@/utils/auditExportPlan";
import { auditFilterChips, auditHolderOf, countByKind, filterAuditEvents, isAuditHolderUntold, untoldHolderText } from "@/utils/auditView";
import { clearAuditFilter, getAuditFilterControls, readAuditFilter, writeAuditFilter } from "@/utils/auditFilterControls";
import { parseAzureFilter } from "@/utils/azureReportFilter";
import { parseDashboardFilter, serializeDashboardFilter } from "@/utils/dashboardFilter";
import { groupFilterControls, parseFilterPairs } from "@/utils/filterControls";
import { HOLDER_LABELS, holderOptions, isGuestUpn } from "@/utils/holderKinds";
import type { PrincipalKind } from "@/utils/principalUtils";
import type { AuditEvent, RawAuditTarget, RawDirectoryAudit } from "@/types/audit.types";
import type { RoleDetailData } from "@/types/directoryRole.types";

// Invented data only: Contoso names and made-up ids.
const NOW = new Date("2026-11-05T12:00:00Z");
const BASE: AuditUrlState = { days: 30, kinds: ["usage", "assignment", "setting", "outside", "system"], env: "both", failed: false, q: "" };

function event(id: string, overrides: Partial<AuditEvent> = {}): AuditEvent {
    return {
        id,
        time: "2026-11-01T08:00:00Z",
        kind: "assignment",
        environment: "role",
        sentence: id,
        actor: { name: "Alex Wilber", id: "u-alex", kind: "person" },
        role: { name: "Global Administrator", id: "role-global" },
        scope: "Directory",
        result: "success",
        source: "graph",
        correlationId: `c-${id}`,
        ...overrides,
    };
}

const person = event("person", { target: { name: "Megan Bowen", id: "u-megan" } });
const group = event("group", { target: { name: "Contoso Admins", id: "g-admins" }, targetIsGroup: true });
const app = event("app", { target: { name: "Deploy Pipeline", id: "sp-deploy" }, targetIsApp: true });
const setting = event("setting", { kind: "setting" });
const ownActivation = event("own", { kind: "usage" });
const ALL = [person, group, app, setting, ownActivation];
const ids = (events: readonly AuditEvent[]) => events.map((e) => e.id);

function role(id: string, displayName: string, isPrivileged: boolean | undefined, eligibleIds: string[] = [], templateId?: string): RoleDetailData {
    return {
        definition: { id, templateId, displayName, description: "", isBuiltIn: true, isPrivileged },
        assignments: {
            permanent: [],
            active: [],
            eligible: eligibleIds.map((principalId, index) => ({ id: `${id}-${index}`, principalId, roleDefinitionId: id, directoryScopeId: "/" })) as RoleDetailData["assignments"]["eligible"],
        },
    };
}

describe("the holder of an event", () => {
    it("reads the target, and the person who activated when an activation has none", () => {
        expect(ALL.map(auditHolderOf)).toEqual(["user", "group", "app", null, "user"]);
    });

    it("gives no holder to a system activation without a target", () => {
        expect(auditHolderOf(event("sys", { kind: "usage", actor: { name: "MS-PIM", id: "", kind: "system" } }))).toBeNull();
    });
});

describe("the Audit filter controls as data", () => {
    const base = parseAuditUrlState("");

    it("sets and clears each key by its neutral value", () => {
        for (const control of getAuditFilterControls(false, 3)) {
            const other = control.options.find((option) => option.value !== control.neutral)!.value;
            const set = writeAuditFilter(base, control.key, other);
            expect(readAuditFilter(control.key, set)).toBe(other);
            expect(buildAuditSearch(set)).not.toBe(buildAuditSearch(base));
            expect(buildAuditSearch(clearAuditFilter(set, control.key))).toBe(buildAuditSearch(base));
            expect(readAuditFilter(control.key, base)).toBe(control.neutral);
        }
    });

    it("keeps the URL words", () => {
        expect(buildAuditSearch(writeAuditFilter(writeAuditFilter(base, "failed", "failed"), "privileged", "privileged"))).toBe("priv=1&failed=1");
    });

    it("ignores a value that is not a choice", () => {
        expect(writeAuditFilter(base, "who", "people")).toBe(base);
        expect(writeAuditFilter(base, "env", "azure")).toBe(base);
    });

    it("leaves Result out of No activation and counts in its option", () => {
        expect(getAuditFilterControls(true, 3).map((control) => control.key)).toEqual(["who", "env", "privileged"]);
        expect(getAuditFilterControls(false, 3).at(-1)?.options.at(-1)?.label).toBe("Failed or denied (3)");
    });
});

describe("the shared filter pieces", () => {
    it("reads the pairs of an f parameter, encoded or not, and skips what is no pair", () => {
        expect(parseFilterPairs("a:1,b:2")).toEqual([{ key: "a", value: "1" }, { key: "b", value: "2" }]);
        expect(parseFilterPairs("a%3A1")).toEqual([{ key: "a", value: "1" }]);
        expect(parseFilterPairs("nothing,:x, c : 3 ")).toEqual([{ key: "c", value: "3" }]);
        expect(parseFilterPairs("%E0%A4%A")).toEqual([]);
        expect(parseFilterPairs(null)).toEqual([]);
    });

    it("groups controls in order of first appearance", () => {
        expect(groupFilterControls([{ group: "A", n: 1 }, { group: "B", n: 2 }, { group: "A", n: 3 }]).map((g) => [g.group, g.controls.length])).toEqual([["A", 2], ["B", 1]]);
    });

    it("keeps old links of the Report and Azure Report, in any order, and writes them in the current words", () => {
        expect(parseDashboardFilter("mfa:neither,principalType:servicePrincipal")).toEqual({ mfa: "neither", principalType: "app" });
        expect(serializeDashboardFilter(parseDashboardFilter("mfa:neither,principalType:servicePrincipal"))).toBe("mfa:neither,principalType:app");
        expect(parseDashboardFilter("mfa%3Aneither").mfa).toBe("neither");
        expect(parseAzureFilter("principalType:managedIdentity,status:eligible").principalType).toBe("managedIdentity");
        expect(parseAzureFilter("principalType:managedIdentity,status:eligible").status).toBe("eligible");
    });
});

describe("Users and Guests", () => {
    const guest = event("guest", { target: { name: "Kim Akers", id: "g-kim" }, targetIsGuest: true });
    const ownGuest = event("own-guest", { kind: "usage", actor: { name: "Kim Akers", id: "g-kim", kind: "person", isGuest: true } });
    const events = [person, guest, ownGuest, app];
    const shown = (who: AuditUrlState["who"]) => ids(filterAuditEvents(events, { ...BASE, who }, NOW));

    it("tells a guest from a user, as the target and as the one who activated, without the role data", () => {
        expect(shown("user")).toEqual(["person"]);
        expect(shown("guest")).toEqual(["guest", "own-guest"]);
    });

    it("reads a guest from the user principal name and does not keep the name", () => {
        const target = { type: "User", id: "g-kim", displayName: "Kim Akers", userPrincipalName: "kim_fabrikam.com#EXT#@contoso.onmicrosoft.com", modifiedProperties: [] };
        const base = { category: "RoleManagement", correlationId: "c", result: "success", resultReason: "", activityDisplayName: "Add eligible member to role requested (PIM assignment)", activityDateTime: "2026-11-01T10:00:00Z", loggedByService: "PIM", initiatedBy: { user: { id: "u-a", displayName: "Alex" } }, additionalDetails: [{ key: "AuditType", value: "CreateRequestEligibleRole" }] };
        const [mapped] = mapAuditEvents([{ ...base, id: "x", targetResources: [{ type: "Role", id: "r", displayName: "Reader" }, target] }] as unknown as RawDirectoryAudit[]);
        expect(mapped.target?.name).toBe("Kim Akers");
        expect(mapped.targetIsGuest).toBe(true);
        expect(JSON.stringify(mapped)).not.toContain("#EXT#");
    });

    it("puts the words of the kinds in one place", () => {
        expect(holderOptions(["user", "guest", "app", "agent", "group"]).map((option) => option.label)).toEqual(["Users", "Guests", "Apps", "Agents", "Groups"]);
        expect(holderOptions(["app"], { app: "servicePrincipal" })).toEqual([{ value: "servicePrincipal", label: "Apps" }]);
        expect(HOLDER_LABELS.managedIdentity.many).toBe("Managed identities");
        expect(isGuestUpn("KIM_fabrikam.com#ext#@contoso.onmicrosoft.com")).toBe(true);
        expect(isGuestUpn("megan@contoso.com")).toBe(false);
        expect(isGuestUpn(null)).toBe(false);
    });

    it("ignores a word that is not a choice in the URL", () => {
        expect(parseAuditUrlState("?who=people").who).toBeUndefined();
    });
});

describe("Apps and Agents on events", () => {
    const agent = event("agent", { target: { name: "Contoso Ops Agent", id: "SP-Agent" }, targetIsApp: true });
    const blueprint = event("blueprint", { target: { name: "Ops Blueprint", id: "sp-blueprint" }, targetIsApp: true });
    const retired = event("retired", { target: { name: "Retired Bot", id: "sp-retired" }, targetIsApp: true });
    const agentUser = event("agent-user", { target: { name: "Ops Agent (account)", id: "u-agent" } });
    const events = [person, app, agent, blueprint, retired, agentUser, setting];
    const holderKinds = new Map<string, PrincipalKind>([["u-megan", "user"], ["sp-deploy", "servicePrincipal"], ["sp-agent", "agentIdentity"], ["sp-blueprint", "agentIdentityBlueprintPrincipal"], ["u-agent", "agentUser"]]);
    const shown = (who: AuditUrlState["who"]) => ids(filterAuditEvents(events, { ...BASE, who }, NOW, undefined, undefined, undefined, holderKinds));

    it("tells an app from an agent by who holds a role, in any case of the id", () => {
        expect(shown("app")).toEqual(["app", "retired"]);
        expect(shown("agent")).toEqual(["agent", "blueprint", "retired", "agent-user"]);
    });

    it("keeps one it cannot tell under both, and names only that one as untold", () => {
        expect(events.filter((e) => isAuditHolderUntold(e, holderKinds)).map((e) => e.id)).toEqual(["retired"]);
    });

    it("leaves an agent's user account under People too, because the log calls it a user", () => {
        expect(shown("user")).toEqual(["person", "agent-user"]);
    });

    it("says how many it kept, on the page and in the export", () => {
        expect(untoldHolderText(0)).toBeNull();
        expect(untoldHolderText(1)).toBe("1 event kept because the log does not say whether it is an app or an agent.");
        expect(untoldHolderText(3)).toBe("3 events kept because the log does not say whether they are apps or agents.");
        expect(describeAuditFilter({ kinds: BASE.kinds, env: "both", failed: false, who: "agent" }, undefined, 0, 2)).toContain("Agents only (2 kept: app or agent could not be told)");
        expect(describeAuditFilter({ kinds: BASE.kinds, env: "both", failed: false, who: "agent" })).toContain("Agents only");
    });

    it("holds the kinds of the role holders from the role data", () => {
        const roles = [{
            definition: { id: "r", displayName: "Reader", description: "", isBuiltIn: true },
            assignments: { permanent: [], eligible: [], active: [
                { principalId: "SP-Agent", principal: { "@odata.type": "#microsoft.graph.agentIdentity" } },
                { principalId: "sp-old", principal: { "@odata.type": "#microsoft.graph.servicePrincipal", servicePrincipalType: "ServiceIdentity" } },
                { principalId: "sp-none" },
            ] },
        }] as unknown as RoleDetailData[];
        const kinds = buildAuditPrivilege(roles).holderKinds;
        expect(kinds.get("sp-agent")).toBe("agentIdentity");
        expect(kinds.get("sp-old")).toBe("agentIdentity");
        expect(kinds.has("sp-none")).toBe(false);
    });

    it("reads agents from the URL", () => {
        const state = parseAuditUrlState("?who=agent");
        expect(state.who).toBe("agent");
        expect(buildAuditSearch(state)).toBe("who=agent");
    });
});

describe("the Who filter on events", () => {
    const shown = (who: AuditUrlState["who"]) => ids(filterAuditEvents(ALL, { ...BASE, who }, NOW));

    it("keeps an event without a holder only while Who is on all", () => {
        expect(shown(undefined)).toEqual(["person", "group", "app", "setting", "own"]);
        expect(shown("user")).toEqual(["person", "own"]);
        expect(shown("group")).toEqual(["group"]);
        expect(shown("app")).toEqual(["app"]);
    });

    it("counts the kinds under it", () => {
        const counts = countByKind(ALL, { ...BASE, who: "user" }, NOW);
        expect(counts.assignment).toBe(1);
        expect(counts.usage).toBe(1);
        expect(counts.setting).toBe(0);
    });
});

describe("Privileged only on events", () => {
    const privilege = buildAuditPrivilege([
        role("object-global", "Global Administrator", true, ["g-admins"], "role-global"),
        role("role-reader", "Reports Reader", false, ["g-readers"]),
        role("role-custom", "Custom Role", undefined),
    ]);
    const on = (events: AuditEvent[]) => ids(filterAuditEvents(events, { ...BASE, privileged: true }, NOW, undefined, undefined, privilege));

    it("judges a role by id, by template id and by name, in any case", () => {
        expect(judgeEventPrivilege(event("a", { role: { name: "", id: "OBJECT-GLOBAL" } }), privilege)).toBe(true);
        expect(judgeEventPrivilege(event("b", { role: { name: "", id: "role-global" } }), privilege)).toBe(true);
        expect(judgeEventPrivilege(event("c", { role: { name: "reports reader", id: "not-a-known-id" } }), privilege)).toBe(false);
    });

    it("never reads an unknown role or a missing flag as not privileged", () => {
        expect(judgeEventPrivilege(event("d", { role: { name: "Deleted Role", id: "role-gone" } }), privilege)).toBeNull();
        expect(judgeEventPrivilege(event("e", { role: { name: "", id: "" } }), privilege)).toBeNull();
        expect(judgeEventPrivilege(event("f", { role: { name: "Custom Role", id: "role-custom" } }), privilege)).toBeNull();
    });

    it("leaves out only what is known not to be privileged", () => {
        const events = [
            event("global"),
            event("reader", { role: { name: "Reports Reader", id: "role-reader" } }),
            event("gone", { role: { name: "Deleted Role", id: "role-gone" } }),
        ];
        expect(on(events)).toEqual(["global", "gone"]);
    });

    it("counts a group that holds a privileged role, and no other group", () => {
        const onGroup = (id: string) => event(id, { environment: "group", role: { name: `member of ${id}`, id } });
        expect(on([onGroup("g-admins"), onGroup("g-readers"), onGroup("g-none")])).toEqual(["g-admins"]);
        expect(judgeGroupPrivilege("", privilege)).toBeNull();
    });

    it("applies nothing without a lookup", () => {
        const events = [event("reader", { role: { name: "Reports Reader", id: "role-reader" } })];
        expect(ids(filterAuditEvents(events, { ...BASE, privileged: true }, NOW))).toEqual(["reader"]);
    });

    it("knows when Graph gave no flag at all", () => {
        expect(privilege.isReported).toBe(true);
        expect(buildAuditPrivilege([role("r", "Reader", undefined)]).isReported).toBe(false);
    });

    it("words what it kept", () => {
        expect(unjudgedText(0, "event")).toBeNull();
        expect(unjudgedText(1, "event")).toBe("1 event kept because its role could not be judged.");
        expect(unjudgedText(3, "assignment")).toBe("3 assignments kept because their role could not be judged.");
    });
});

describe("the URL state of the filters", () => {
    it("reads and writes who and priv, and writes no default", () => {
        const state = parseAuditUrlState("?who=app&priv=1");
        expect(state.who).toBe("app");
        expect(state.privileged).toBe(true);
        expect(buildAuditSearch(state)).toBe("who=app&priv=1");
        expect(buildAuditSearch(parseAuditUrlState(""))).toBe("");
    });

    it("falls back on rubbish", () => {
        const state = parseAuditUrlState("?who=everyone&priv=yes");
        expect(state.who).toBeUndefined();
        expect(state.privileged).toBeUndefined();
    });

    it("removes them again and keeps a parameter that is not its own", () => {
        expect(buildAuditSearch({ ...BASE, kinds: ["usage", "assignment", "setting", "outside"] }, "?who=app&priv=1&other=x")).toBe("other=x");
    });
});

describe("the chips of the active filters", () => {
    it("names each with the words of the panel", () => {
        const labels = (state: Partial<AuditUrlState>) => auditFilterChips({ ...BASE, ...state }).map((chip) => chip.label);
        expect(labels({})).toEqual([]);
        expect(labels({ who: "group", env: "group", privileged: true, failed: true })).toEqual(["Groups only", "PIM for Groups only", "Privileged only", "Failed or denied"]);
        expect(labels({ env: "role" })).toEqual(["Entra roles only"]);
    });

    it("does not name or count Failed in No activation, which does not use it", () => {
        expect(auditFilterChips({ ...BASE, failed: true, view: "idle" })).toEqual([]);
    });
});

describe("the mapper for the holder and the role id", () => {
    const row = (id: string, service: string, activity: string, targets: RawAuditTarget[], auditType?: string): RawDirectoryAudit => ({
        id,
        category: "RoleManagement",
        correlationId: `c-${id}`,
        result: "success",
        activityDisplayName: activity,
        activityDateTime: "2026-11-01T08:00:00Z",
        loggedByService: service,
        initiatedBy: { user: { id: "u-alex", displayName: "Alex Wilber" } },
        targetResources: targets,
        additionalDetails: auditType ? [{ key: "AuditType", value: auditType }] : [],
    });
    const quoted = (value: string) => `"${value}"`;
    const coreTarget = (type: string, id: string, name: string | null): RawAuditTarget => ({
        type,
        id,
        displayName: name,
        modifiedProperties: [
            { displayName: "Role.ObjectID", newValue: quoted("object-1") },
            { displayName: "Role.DisplayName", newValue: quoted("Security Reader") },
            { displayName: "Role.TemplateId", newValue: quoted("template-1") },
        ],
    });
    const roleWithoutName: RawAuditTarget = { type: "Role", id: "object-1", displayName: null };

    it("marks a service principal as an app, on a PIM row and on a Core Directory row (measured)", () => {
        const [pim] = mapAuditEvents([row("a", "PIM", "Add member to role outside of PIM (permanent)", [{ type: "Role", id: "template-1", displayName: "Security Reader" }, { type: "ServicePrincipal", id: "sp-1", displayName: "Test Agent" }], "RoleElevatedOutsidePimAlert")]);
        expect(pim.targetIsApp).toBe(true);
        expect(auditHolderOf(pim)).toBe("app");
        const [core] = mapAuditEvents([row("b", "Core Directory", "Add member to role", [coreTarget("ServicePrincipal", "sp-1", "Test Agent"), roleWithoutName])]);
        expect(core.targetIsApp).toBe(true);
        expect(core.sentence).toBe("Test Agent added to Security Reader outside PIM");
    });

    it("reads a group as the holder of a direct change (the group has no user next to it)", () => {
        const [core] = mapAuditEvents([row("c", "Core Directory", "Add member to role", [coreTarget("Group", "g-1", "Contoso Admins"), roleWithoutName])]);
        expect(core.targetIsGroup).toBe(true);
        expect(auditHolderOf(core)).toBe("group");
        expect(core.sentence).toBe("Contoso Admins added to Security Reader outside PIM");
    });

    it("keeps the person on an activation through a group", () => {
        const [activation] = mapAuditEvents([row("d", "PIM", "Add member to role completed (PIM activation)", [
            { type: "Role", id: "template-1", displayName: "Security Reader" },
            { type: "User", id: "u-megan", displayName: "Megan Bowen" },
            { type: "Group", id: "g-1", displayName: "Contoso Admins" },
        ], "ActivateRole")]);
        expect(auditHolderOf(activation)).toBe("user");
    });

    it("takes the template id of a Core Directory row, whose Role target holds an object id (measured)", () => {
        const [core] = mapAuditEvents([row("e", "Core Directory", "Add member to role", [coreTarget("User", "u-1", null), roleWithoutName])]);
        expect(core.role).toEqual({ name: "Security Reader", id: "template-1" });
    });

    it("keeps the Role target id on a row without a template id", () => {
        const [core] = mapAuditEvents([row("f", "Core Directory", "Add member to role", [{ type: "User", id: "u-1", modifiedProperties: [{ displayName: "Role.DisplayName", newValue: quoted("Security Reader") }] }, roleWithoutName])]);
        expect(core.role.id).toBe("object-1");
    });
});

describe("the filters in No activation", () => {
    const principal = (id: string, displayName: string, type: string) => ({ id, displayName, "@odata.type": `#microsoft.graph.${type}` });
    const eligible = (id: string, who: ReturnType<typeof principal>) => ({ id, principalId: who.id, principal: who, roleDefinitionId: "r", directoryScopeId: "/", scheduleInfo: { startDateTime: "2026-01-01T00:00:00Z" } });
    const megan = principal("u-megan", "Megan Bowen", "user");
    const helpdesk = principal("g-helpdesk", "Contoso Helpdesk", "group");
    const unread = principal("g-unread", "Contoso Mail Ops", "group");
    const pipeline = principal("sp-deploy", "Deploy Pipeline", "servicePrincipal");
    const opsAgent = principal("sp-agent", "Contoso Ops Agent", "agentIdentity");
    const opsAccount = principal("u-agent", "Ops Agent (account)", "agentUser");
    const kim = { ...principal("g-kim", "Kim Akers", "user"), userPrincipalName: "kim_fabrikam.com#EXT#@contoso.onmicrosoft.com" };
    const roles = [
        { definition: { id: "r-global", displayName: "Global Administrator", description: "", isBuiltIn: true, isPrivileged: true }, assignments: { permanent: [], active: [{ id: "a", principalId: pipeline.id, principal: pipeline, directoryScopeId: "/", assignmentType: "Assigned", scheduleInfo: { startDateTime: "2026-01-01T00:00:00Z" } }], eligible: [eligible("e1", megan), eligible("e2", helpdesk), eligible("e3", unread)] } },
        { definition: { id: "r-reader", displayName: "Reports Reader", description: "", isBuiltIn: true, isPrivileged: false }, assignments: { permanent: [], active: [], eligible: [eligible("e4", megan)] } },
        { definition: { id: "r-custom", displayName: "Custom Role", description: "", isBuiltIn: false }, assignments: { permanent: [], active: [], eligible: [eligible("e5", megan)] } },
        { definition: { id: "r-agents", displayName: "Agent Role", description: "", isBuiltIn: false }, assignments: { permanent: [], active: [{ id: "aa", principalId: "sp-agent", principal: opsAgent, roleDefinitionId: "r-agents", directoryScopeId: "/", assignmentType: "Assigned", memberType: "Direct" }], eligible: [eligible("e6", opsAccount), eligible("e7", kim)] } },
    ] as unknown as RoleDetailData[];
    const groups = [{
        group: { id: "g-helpdesk", displayName: "Contoso Helpdesk", groupType: "security", isAssignableToRole: true },
        assignments: [{ id: "ga", groupId: "g-helpdesk", principalId: "u-anna", principal: principal("u-anna", "Anna Lee", "user"), accessType: "member", assignmentType: "eligible", memberType: "Direct", startDateTime: "2026-01-01T00:00:00Z" }],
    }, {
        group: { id: "g-other", displayName: "Contoso Other", groupType: "security", isAssignableToRole: true },
        assignments: [{ id: "gb", groupId: "g-other", principalId: "u-anna", principal: principal("u-anna", "Anna Lee", "user"), accessType: "member", assignmentType: "eligible", memberType: "Direct", startDateTime: "2026-01-01T00:00:00Z" }],
    }] as unknown as Parameters<typeof buildNoActivationRows>[0]["groups"];
    const membership = new Map([
        ["g-helpdesk", { status: "ready" as const, members: [
            { id: "u-grady", displayName: "Grady Archie", kind: "user" as const, userType: "Member" },
            { id: "g-ben", displayName: "Ben Walters", kind: "user" as const, userType: "Guest" },
            { id: "g-sam", displayName: "Sam Upn", kind: "user" as const, userPrincipalName: "sam_fabrikam.com#EXT#@contoso.onmicrosoft.com" },
        ] }],
        ["g-unread", { status: "error" as const }],
    ]);
    const rows = buildNoActivationRows({ roles, groups, events: [], days: 30, now: NOW, membership });
    const whoOf = (filters: Parameters<typeof filterNoActivationRows>[3]) => filterNoActivationRows(rows, "role", "", filters).map((row) => row.who);

    it("gives each row what it holds", () => {
        const of = (who: string) => rows.find((row) => row.who === who);
        expect(of("Megan Bowen")?.holderKind).toBe("user");
        expect(of("Deploy Pipeline")?.holderKind).toBe("app");
        expect(of("Contoso Mail Ops")?.holderKind).toBe("group");
        expect(of("Grady Archie")?.holderKind).toBe("user");
    });

    it("shows a member through a group under People and under Groups, and an app under Apps", () => {
        expect(whoOf({ who: "user" })).toContain("Grady Archie");
        expect(whoOf({ who: "user" })).toContain("Megan Bowen");
        expect(whoOf({ who: "group" })).toEqual(expect.arrayContaining(["Grady Archie", "Contoso Mail Ops"]));
        expect(whoOf({ who: "group" })).not.toContain("Megan Bowen");
        expect(whoOf({ who: "app" })).toEqual(["Deploy Pipeline"]);
    });

    it("shows a guest through a group under Guests and under Groups, by userType or else the principal name", () => {
        expect(whoOf({ who: "guest" })).toEqual(expect.arrayContaining(["Ben Walters", "Sam Upn"]));
        expect(whoOf({ who: "user" })).not.toContain("Ben Walters");
        expect(whoOf({ who: "group" })).toEqual(expect.arrayContaining(["Ben Walters", "Sam Upn"]));
    });

    it("shows a guest under Guests, not under Users", () => {
        expect(whoOf({ who: "guest" })).toContain("Kim Akers");
        expect(whoOf({ who: "user" })).not.toContain("Kim Akers");
    });

    it("shows an agent and an agent's account under Agents only, judged as the app or person they are", () => {
        expect(whoOf({ who: "agent" }).sort()).toEqual(["Contoso Ops Agent", "Ops Agent (account)"]);
        expect(whoOf({ who: "user" })).not.toContain("Ops Agent (account)");
        const agentRow = rows.find((row) => row.who === "Contoso Ops Agent");
        expect(agentRow?.state).toBe("app");
        expect(agentRow?.activationText).toBe("Not applicable: an agent does not activate");
        expect(rows.find((row) => row.who === "Deploy Pipeline")?.activationText).toBe("Not applicable: an app does not activate");
    });

    it("leaves out what is known not to be privileged and keeps what cannot be judged", () => {
        const names = filterNoActivationRows(rows, "role", "", { isPrivilegedOnly: true }).map((row) => row.resourceName);
        expect(names).toContain("Global Administrator");
        expect(names).toContain("Custom Role");
        expect(names).not.toContain("Reports Reader");
        expect(rows.find((row) => row.resourceName === "Custom Role")?.isPrivileged).toBeNull();
    });

    it("counts a group that holds a privileged role, in PIM for Groups", () => {
        const names = filterNoActivationRows(rows, "group", "", { isPrivilegedOnly: true }).map((row) => row.resourceName);
        expect(names).toEqual(["Member of Contoso Helpdesk"]);
    });
});
