import { describe, expect, it } from "vitest";
import type { AuditEvent } from "@/types/audit.types";
import type { PimGroupData } from "@/types/pimGroup.types";
import type { AzureAssignment, AzureScope } from "@/types/azureResource.types";
import { describeNoActivationFilter, planNoActivationExport } from "@/utils/auditExportPlan";
import { azureEligibleGroupIds, buildAzureNoActivationRows } from "@/utils/azureNoActivation";

const NOW = new Date("2026-11-01T12:00:00Z");
const SUB = "/subscriptions/aaaa";
const RG = `${SUB}/resourceGroups/rg-web`;
const OWNER = "8e3af657-a8ff-443c-a75c-2fe8c4bcb635";

const scopes: AzureScope[] = [
    { id: SUB, name: "Contoso Production", level: "subscription", parentId: null },
    { id: RG, name: "rg-web", level: "resourceGroup", parentId: SUB },
];

function assignment(over: Partial<AzureAssignment> = {}): AzureAssignment {
    return {
        id: "a1",
        scopeId: SUB,
        principalId: "p1",
        principalName: "Alex Wilber",
        principalType: "User",
        roleDefinitionId: OWNER,
        roleName: "Owner",
        state: "eligible",
        memberType: "direct",
        startDateTime: "2026-01-01T00:00:00Z",
        endDateTime: null,
        ...over,
    };
}

function activation(over: Partial<AuditEvent> = {}): AuditEvent {
    return {
        id: "e1",
        time: "2026-10-20T09:00:00Z",
        kind: "usage",
        environment: "role",
        sentence: "Alex Wilber activated Owner",
        actor: { name: "Alex Wilber", id: "p1", kind: "person" },
        target: { name: "Alex Wilber", id: "p1" },
        role: { name: "Owner", id: OWNER },
        scope: "rg-web",
        result: "success",
        source: "arm",
        correlationId: "c1",
        azure: { scopeId: RG, scopeName: "rg-web", scopeLevel: "resourceGroup", subscriptionId: "aaaa" },
        ...over,
    };
}

const build = (assignments: AzureAssignment[], events: AuditEvent[] = [], days = 30) => buildAzureNoActivationRows({ assignments, events, scopes, days, now: NOW });

describe("buildAzureNoActivationRows", () => {
    it("warns for an old eligibility without an activation, with the scope and its level", () => {
        const [row] = build([assignment()]);
        expect(row).toMatchObject({ state: "none", isWarning: true, scopeName: "Contoso Production", scopeLevel: "subscription", holderKind: "user" });
    });

    it("counts an activation on a narrower scope and names that scope", () => {
        const [row] = build([assignment()], [activation()]);
        expect(row.state).toBe("activated");
        expect(row.activationText).toContain("on rg-web");
    });

    it("does not count a failed activation, a request, or one on another scope or person", () => {
        const other = `${SUB}x/resourceGroups/rg`;
        const events = [
            activation({ result: "failure" }),
            activation({ id: "e2", requestOnly: true }),
            activation({ id: "e3", azure: { scopeId: other, scopeName: "rg", scopeLevel: "resourceGroup", subscriptionId: "x" } }),
            activation({ id: "e4", target: { name: "Sam", id: "p2" } }),
        ];
        expect(build([assignment()], events)[0].state).toBe("none");
    });

    describe("a direct role and the same role through a group", () => {
        const direct = assignment({ id: `${SUB}/providers/Microsoft.Authorization/roleEligibilitySchedules/DIRECT` });
        const viaGroup = assignment({ id: `${SUB}/providers/Microsoft.Authorization/roleEligibilitySchedules/GROUP`, principalId: "g1", principalName: "Admins", principalType: "Group" });
        const membership = new Map([["g1", { status: "ready" as const, members: [{ id: "p1", displayName: "Alex Wilber", kind: "user" as const }] }]]);
        const stateOf = (eligibilityId: string | undefined) => {
            const rows = buildAzureNoActivationRows({ assignments: [direct, viaGroup], events: [activation({ eligibilityId })], scopes, days: 30, now: NOW, membership });
            return { direct: rows.find((row) => row.viaGroup === undefined)?.state, group: rows.find((row) => row.viaGroup === "Admins")?.state };
        };

        it("counts an activation for the eligibility it used, not for the other way in", () => {
            expect(stateOf("group")).toEqual({ direct: "none", group: "activated" });
            expect(stateOf("direct")).toEqual({ direct: "activated", group: "none" });
        });

        it("falls back on role, person and scope when the eligibility it names is gone or not named", () => {
            expect(stateOf("renewed")).toEqual({ direct: "activated", group: "activated" });
            expect(stateOf(undefined)).toEqual({ direct: "activated", group: "activated" });
        });
    });

    it("treats an agent as an agent, under Agents and without activating", () => {
        const [active] = build([assignment({ state: "active", principalType: "AgentIdentity", principalName: "Ops Agent" })]);
        expect(active).toMatchObject({ state: "app", holderKind: "agent", activationText: "Not applicable: an agent does not activate" });
        const [eligible] = build([assignment({ principalType: "AgentIdentity" })]);
        expect(eligible).toMatchObject({ state: "not-read", holderKind: "agent" });
    });

    it("names the root scope", () => {
        const rows = buildAzureNoActivationRows({ assignments: [assignment({ scopeId: "/" })], events: [], scopes: [{ id: "/", name: "Root", level: "root", parentId: null }, ...scopes], days: 30, now: NOW });
        expect(rows[0].scopeName).toBe("Root");
    });

    it("does not warn about an assignment younger than the period", () => {
        expect(build([assignment({ startDateTime: "2026-10-25T00:00:00Z" })])[0].state).toBe("new");
    });

    it("leaves out the instance an activation made and lists an assignment once by id", () => {
        const rows = build([assignment(), assignment(), assignment({ id: "a2", state: "active", isActivated: true })]);
        expect(rows).toHaveLength(1);
    });

    const groupHolds = assignment({ id: "a4", principalId: "g1", principalName: "Platform", principalType: "Group", state: "active" });
    const pimGroup = (members: { id: string; name: string }[]) => ({
        group: { id: "g1", displayName: "Platform" },
        assignments: members.map((m) => ({ id: `m-${m.id}`, groupId: "g1", principalId: m.id, principal: { displayName: m.name, "@odata.type": "#microsoft.graph.user" }, accessType: "member", assignmentType: "eligible" })),
    }) as unknown as PimGroupData;
    const groupActivation = (over: Partial<AuditEvent> = {}) => activation({ id: "g-e1", environment: "group", viaGroup: "Platform", ...over });
    const buildGroup = (events: AuditEvent[], days = 30, over: Partial<Parameters<typeof buildAzureNoActivationRows>[0]> = {}) =>
        buildAzureNoActivationRows({ assignments: [groupHolds], events, scopes, days, now: NOW, entraLog: "read", pimGroups: [pimGroup([{ id: "p1", name: "Alex Wilber" }, { id: "p2", name: "Sam" }])], ...over });

    it("gives a group that holds the role one row per eligible member, judged by the group activations", () => {
        const rows = buildGroup([groupActivation()]);
        expect(rows.map((row) => [row.who, row.state, row.viaGroup])).toEqual([
            ["Sam", "none", "Platform"],
            ["Alex Wilber", "activated", "Platform"],
        ]);
        expect(rows[1].activationText).toContain("on rg-web");
    });

    it("does not judge a member without an activation when the period is longer than the Entra audit log", () => {
        const rows = buildGroup([groupActivation()], 90);
        expect(rows.find((row) => row.who === "Sam")?.state).toBe("not-read");
        expect(rows.find((row) => row.who === "Alex Wilber")?.state).toBe("activated");
    });

    it("says why a group that holds the role is one row", () => {
        expect(buildGroup([], 30, { entraLog: "no permission" })[0]).toMatchObject({ state: "not-read", activationText: expect.stringContaining("Entra audit log") });
        expect(buildGroup([], 30, { pimGroups: null })[0]).toMatchObject({ state: "not-read", activationText: expect.stringContaining("PIM for Groups is not included") });
        expect(buildGroup([], 30, { pimGroups: [] })[0]).toMatchObject({ state: "held-by-group", activationText: expect.stringContaining("not in PIM for Groups") });
    });

    it("gives an active assignment, an app and a group their own wording, never a warning", () => {
        const rows = build([
            assignment({ id: "a2", state: "active", endDateTime: "2026-12-01T00:00:00Z" }),
            assignment({ id: "a3", principalId: "sp", principalName: "Pipeline", principalType: "ServicePrincipal", state: "active" }),
            assignment({ id: "a4", principalId: "g1", principalName: "Platform", principalType: "Group", state: "active" }),
        ]);
        expect(rows.some((row) => row.isWarning)).toBe(false);
        expect(rows.map((row) => row.state).sort()).toEqual(["app", "never-activates", "not-read"]);
    });

    it("does not judge an eligible group whose members were not read", () => {
        const [row] = build([assignment({ principalId: "g1", principalType: "Group", principalName: "Platform" })]);
        expect(row).toMatchObject({ state: "not-read", membersUnread: true });
        expect(azureEligibleGroupIds([assignment({ principalId: "G1", principalType: "Group" })])).toEqual(["g1"]);
    });
});

describe("the Azure No activation export", () => {
    const rows = build([assignment()]);
    const input = {
        rows,
        honesty: "1 assignment: 1 with no activation.",
        period: { from: new Date("2026-10-02T12:00:00Z"), to: new Date("2026-11-01T12:00:00Z") },
        filterSentence: describeNoActivationFilter({ env: "both", level: "subscription" }, 0, "Scope: Contoso Production (Subscription)"),
        searchTerm: "",
        readAt: "2026-11-01T11:58:00Z",
        oldestAvailable: new Date("2026-10-02T11:58:00Z"),
        source: "graph" as const,
        tenant: { id: "t", name: "Contoso" },
        exportedAt: new Date("2026-11-01T12:05:00Z"),
    };

    it("adds the scope level and the scope id, says which filters applied, and drops the id when names are replaced", () => {
        const csv = planNoActivationExport(input, { format: "csv", replaceNames: false });
        if (csv.format !== "csv") throw new Error("csv expected");
        expect(csv.content).toContain("Role or group,Role id,Scope,Scope level,Scope id,Who,");
        expect(csv.content).toContain("Scope level: Subscription only");
        const replaced = planNoActivationExport(input, { format: "csv", replaceNames: true });
        if (replaced.format !== "csv") throw new Error("csv expected");
        expect(replaced.content).toContain("Role or group,Role id,Scope,Scope level,Who,");
        expect(replaced.content).not.toContain(SUB);
    });

    it("says in the PDF that these are Azure roles", () => {
        const file = planNoActivationExport(input, { format: "pdf", replaceNames: false });
        if (file.format !== "pdf") throw new Error("pdf expected");
        expect(file.pdf.subtitle).toBe("Assignments in Azure roles, and whether they were activated, for tenant Contoso.");
    });
});

describe("an eligibility on a scope that could not be read (AU-17, P12)", () => {
    const unread = (assignments: AzureAssignment[], events: AuditEvent[], unreadScopeIds: string[]) =>
        buildAzureNoActivationRows({ assignments, events, scopes, days: 30, now: NOW, unreadScopeIds });

    it("is not judged when nothing was found, at the scope or below it", () => {
        const [row] = unread([assignment({ scopeId: RG })], [], [SUB]);
        expect(row).toMatchObject({ state: "not-read", isWarning: false, activationText: "Not judged: the activity of this scope could not be read" });
    });

    it("still counts an activation that was found", () => {
        const [row] = unread([assignment()], [activation()], [SUB]);
        expect(row.state).toBe("activated");
    });

    it("leaves an eligibility on another scope to the usual judgement", () => {
        const [row] = unread([assignment()], [], ["/subscriptions/bbbb"]);
        expect(row.state).toBe("none");
    });
});

describe("the root has a name (AU-17, P9)", () => {
    it("reads Root for an assignment at / that no scope names", () => {
        const [row] = buildAzureNoActivationRows({ assignments: [assignment({ scopeId: "/" })], events: [], scopes, days: 30, now: NOW });
        expect(row.scopeName).toBe("Root");
    });

    it("reads the name of the scope / when the list holds one", () => {
        const named: AzureScope[] = [...scopes, { id: "/", name: "Tenant root", level: "root", parentId: null }];
        const [row] = buildAzureNoActivationRows({ assignments: [assignment({ scopeId: "/" })], events: [], scopes: named, days: 30, now: NOW });
        expect(row.scopeName).toBe("Tenant root");
    });
});

describe("an eligibility made anew by an extension (AU-17, F17)", () => {
    const adminRequest = (requestType: string, time: string, over: Partial<AuditEvent> = {}): AuditEvent => activation({
        id: `${requestType}-${time}`, kind: "assignment", time, requestType,
        actor: { name: "Joel Admin", id: "admin", kind: "person" },
        azure: { scopeId: SUB, scopeName: "Contoso Production", scopeLevel: "subscription", subscriptionId: "aaaa" },
        ...over,
    });
    const extended = assignment({ startDateTime: "2026-10-30T10:01:00Z" });

    it("is judged as assigned before the period, not as new", () => {
        const [row] = build([extended], [adminRequest("AdminExtend", "2026-10-30T10:00:00Z")]);
        expect(row.state).toBe("none");
    });

    it("is new when it was first assigned inside the period", () => {
        const [row] = build([extended], [adminRequest("AdminAssign", "2026-10-25T09:00:00Z"), adminRequest("AdminExtend", "2026-10-30T10:00:00Z")]);
        expect(row.state).toBe("new");
    });

    it("keeps its own start without an extension near it", () => {
        const [row] = build([extended], [adminRequest("AdminExtend", "2026-10-20T10:00:00Z")]);
        expect(row.state).toBe("new");
    });
});
