import { describe, it, expect } from "vitest";
import type { DashboardFilter } from "@/types/dashboardFilter.types";
import {
    applyDashboardFilterToGroups,
    applyDashboardFilterToRoles,
    buildSearchWithFilter,
    filterAppliesToGroups,
    getFilterLabels,
    isEmptyDashboardFilter,
    parseDashboardFilter,
    removeFilterKey,
    serializeDashboardFilter,
    buildFilterNames,
} from "@/utils/dashboardFilter";
import { agent, agentBase, agentUser, app, blueprint, endsLater, group, groupPrincipal, noEnd, policy, role, user } from "../fixtures/dashboardFilterFixtures";

const GA = "62e90394-69f5-4237-9190-012177145e10";

const ALL_KEYS: DashboardFilter = {
    assignment: "activeTimeBound",
    privileged: true,
    approval: "notRequired",
    mfa: "authContext",
    justification: "required",
    maxDuration: "upTo12h",
    principalType: "servicePrincipal",
    noEndDate: true,
    activationNotification: "none",
    hasEligible: false,
    roleTemplateId: GA,
    customRole: false,
    excludeEmergency: true,
};

describe("serialize and parse", () => {
    it("round-trips every key", () => {
        const text = serializeDashboardFilter(ALL_KEYS);
        expect(parseDashboardFilter(text)).toEqual(ALL_KEYS);
    });

    it("round-trips every value of every enumerated key", () => {
        const samples: DashboardFilter[] = [
            ...(["permanent", "eligible", "active", "activeTimeBound"] as const).map((assignment) => ({ assignment })),
            ...(["required", "notRequired"] as const).map((approval) => ({ approval })),
            ...(["entraMfa", "authContext", "neither"] as const).map((mfa) => ({ mfa })),
            ...(["required", "notRequired"] as const).map((justification) => ({ justification })),
            ...(["upTo1h", "upTo4h", "upTo8h", "upTo12h", "over12h"] as const).map((maxDuration) => ({ maxDuration })),
            ...(["user", "guest", "servicePrincipal", "group"] as const).map((principalType) => ({ principalType })),
            { privileged: true },
            { privileged: false },
            { customRole: true },
            { customRole: false },
            { excludeEmergency: true },
            { excludeEmergency: false },
            { noEndDate: true },
            { hasEligible: false as const },
            { activationNotification: "none" as const },
        ];
        for (const filter of samples) {
            expect(parseDashboardFilter(serializeDashboardFilter(filter))).toEqual(filter);
        }
    });

    it("writes keys in a fixed order, several joined by commas", () => {
        expect(serializeDashboardFilter({ principalType: "guest", privileged: true })).toBe("privileged:true,principalType:guest");
        expect(serializeDashboardFilter({})).toBe("");
    });

    it("ignores unknown keys, unknown values and malformed pairs", () => {
        expect(parseDashboardFilter("nope:1,mfa:sometimes,assignment,:x,approval:required")).toEqual({ approval: "required" });
        expect(parseDashboardFilter("noEndDate:false,hasEligible:true,roleTemplateId:not-a-guid")).toEqual({});
    });

    it("lets the last valid pair of a repeated key win and ignores a later invalid one", () => {
        expect(parseDashboardFilter("mfa:neither,mfa:entraMfa")).toEqual({ mfa: "entraMfa" });
        expect(parseDashboardFilter("mfa:neither,mfa:bogus")).toEqual({ mfa: "neither" });
    });

    it("trims, reads the percent-encoded form and tolerates empty input", () => {
        expect(parseDashboardFilter(" privileged:true , principalType:guest ")).toEqual({ privileged: true, principalType: "guest" });
        expect(parseDashboardFilter("privileged%3Atrue%2CprincipalType%3Aguest")).toEqual({ privileged: true, principalType: "guest" });
        expect(parseDashboardFilter("%E0%A4%A")).toEqual({});
        expect(parseDashboardFilter("")).toEqual({});
        expect(parseDashboardFilter(null)).toEqual({});
        expect(parseDashboardFilter(undefined)).toEqual({});
    });

    it("lower-cases the role template id", () => {
        expect(parseDashboardFilter(`roleTemplateId:${GA.toUpperCase()}`)).toEqual({ roleTemplateId: GA });
    });

    it("round-trips the agent value and gives it a readable chip label", () => {
        expect(parseDashboardFilter(serializeDashboardFilter({ principalType: "agent" }))).toEqual({ principalType: "agent" });
        expect(getFilterLabels({ principalType: "agent" })).toEqual([{ key: "principalType", label: "Held by: agent" }]);
    });
});

describe("helpers", () => {
    it("detects an empty filter and removes one key", () => {
        expect(isEmptyDashboardFilter({})).toBe(true);
        expect(isEmptyDashboardFilter({ privileged: false })).toBe(false);
        expect(removeFilterKey({ privileged: true, mfa: "neither" }, "mfa")).toEqual({ privileged: true });
    });

    it("builds a query string that keeps other parameters and writes f raw", () => {
        expect(buildSearchWithFilter("workload=roles&f=old%3Avalue", { mfa: "neither" })).toBe("workload=roles&f=mfa:neither");
        expect(buildSearchWithFilter("", { privileged: true, principalType: "guest" })).toBe("f=privileged:true,principalType:guest");
        expect(buildSearchWithFilter("workload=roles&f=mfa%3Aneither", {})).toBe("workload=roles");
        expect(buildSearchWithFilter("f=mfa%3Aneither", {})).toBe("");
    });

    it("gives every active key a readable label", () => {
        const labels = getFilterLabels(ALL_KEYS).map((l) => l.label);
        expect(labels).toHaveLength(13);
        expect(getFilterLabels({ mfa: "neither" })).toEqual([{ key: "mfa", label: "MFA on activation: neither" }]);
        expect(getFilterLabels({ principalType: "servicePrincipal" })[0].label).toBe("Held by: app");
        expect(getFilterLabels({ maxDuration: "over12h" })[0].label).toBe("Maximum activation: over 12 h");
        expect(labels.every((l) => l.length > 0 && !l.includes(String.fromCharCode(0x2014)))).toBe(true);
    });
});

// Roles used by the apply tests
const ga = role({
    id: "ga",
    templateId: GA,
    isPrivileged: true,
    policy: policy({ mfa: true, justification: true, maxDuration: "PT1H", notification: { defaults: true, recipients: [] } }),
    permanent: [{ principalId: "u1", principal: user("u1") }],
    eligible: [{ principalId: "u3", principal: user("u3"), ...noEnd }],
    active: [
        { principalId: "u1", assignmentType: "Assigned", ...noEnd },
        { principalId: "u2", assignmentType: "Assigned", principalUserType: "Member", ...noEnd },
    ],
});
const sec = role({
    id: "sec",
    isPrivileged: true,
    policy: policy({ authContext: "c1", approval: true, maxDuration: "PT1H30M" }),
    eligible: [{ principalId: "g1", principal: groupPrincipal("g1"), ...endsLater }],
});
const appRole = role({
    id: "app",
    isPrivileged: true,
    policy: policy({ maxDuration: "PT10H", notification: { defaults: false, recipients: [] } }),
    eligible: [{ principalId: "a1", principal: app("a1"), ...endsLater }],
});
const custom = role({
    id: "custom",
    isPrivileged: false,
    isBuiltIn: false,
    policy: null,
    active: [
        { principalId: "u9", assignmentType: "Assigned", principalUserType: "Guest", ...endsLater },
        { principalId: "u1", assignmentType: "Activated", scheduleInfo: { expiration: { type: "afterDuration", duration: "PT8H" } } },
    ],
});
const empty = role({ id: "empty" });
const ROLES = [ga, sec, appRole, custom, empty];

const ids = (roles: { definition: { id: string } }[]) => roles.map((r) => r.definition.id);
const apply = (filter: DashboardFilter, emergency: string[] = []) => ids(applyDashboardFilterToRoles(ROLES, filter, { emergencyAccountIds: new Set(emergency) }));

describe("applyDashboardFilterToRoles", () => {
    it("returns the same array for an empty filter", () => {
        expect(applyDashboardFilterToRoles(ROLES, {})).toBe(ROLES);
    });

    it("assignment", () => {
        expect(apply({ assignment: "permanent" })).toEqual(["ga"]);
        expect(apply({ assignment: "eligible" })).toEqual(["ga", "sec", "app"]);
        expect(apply({ assignment: "active" })).toEqual(["custom"]);
        expect(apply({ assignment: "activeTimeBound" })).toEqual(["custom"]);
    });

    it("privileged and customRole match neither value when the definition does not say", () => {
        expect(apply({ privileged: true })).toEqual(["ga", "sec", "app"]);
        expect(apply({ privileged: false })).toEqual(["custom"]);
        expect(apply({ customRole: true })).toEqual(["custom"]);
        expect(apply({ customRole: false })).toEqual(["ga", "sec", "app", "empty"]);
    });

    it("approval and justification need a loaded policy", () => {
        expect(apply({ approval: "required" })).toEqual(["sec"]);
        expect(apply({ approval: "notRequired" })).toEqual(["ga", "app"]);
        expect(apply({ justification: "required" })).toEqual(["ga"]);
        expect(apply({ justification: "notRequired" })).toEqual(["sec", "app"]);
    });

    it("mfa splits loaded roles into three groups", () => {
        expect(apply({ mfa: "entraMfa" })).toEqual(["ga"]);
        expect(apply({ mfa: "authContext" })).toEqual(["sec"]);
        expect(apply({ mfa: "neither" })).toEqual(["app"]);
    });

    it("maxDuration uses the gap-free buckets, half hours included", () => {
        expect(apply({ maxDuration: "upTo1h" })).toEqual(["ga"]);
        expect(apply({ maxDuration: "upTo4h" })).toEqual(["sec"]);
        expect(apply({ maxDuration: "upTo12h" })).toEqual(["app"]);
        expect(apply({ maxDuration: "over12h" })).toEqual([]);
    });

    it("principalType resolves active schedules through the other lists and principalUserType", () => {
        expect(apply({ principalType: "servicePrincipal" })).toEqual(["app"]);
        expect(apply({ principalType: "group" })).toEqual(["sec"]);
        expect(apply({ principalType: "guest" })).toEqual(["custom"]);
        expect(apply({ principalType: "user" })).toEqual(["ga", "custom"]);
    });

    it("noEndDate means an eligibility without an end date", () => {
        expect(apply({ noEndDate: true })).toEqual(["ga"]);
    });

    it("activationNotification none needs the rule present with defaults off and no recipients", () => {
        expect(apply({ activationNotification: "none" })).toEqual(["app"]);
    });

    it("hasEligible false keeps roles without any eligible assignment", () => {
        expect(apply({ hasEligible: false })).toEqual(["custom", "empty"]);
    });

    it("roleTemplateId", () => {
        expect(apply({ roleTemplateId: GA })).toEqual(["ga"]);
        expect(apply({ roleTemplateId: "00000000-0000-0000-0000-000000000000" })).toEqual([]);
    });

    it("keys are ANDed", () => {
        expect(apply({ privileged: true, mfa: "neither" })).toEqual(["app"]);
        expect(apply({ privileged: true, assignment: "permanent", hasEligible: false })).toEqual([]);
    });

    it("assignment, principal type and end date must hold on the same assignment", () => {
        // the app only has an eligible assignment, the permanent ones belong to users
        expect(apply({ assignment: "permanent", principalType: "servicePrincipal" })).toEqual([]);
        expect(apply({ assignment: "eligible", principalType: "servicePrincipal" })).toEqual(["app"]);
        // ga has a user with a permanent assignment and a different user with an eligibility without an end
        expect(apply({ assignment: "permanent", noEndDate: true })).toEqual([]);
    });

    it("excludeEmergency leaves marked accounts out of the assignment test only", () => {
        const filter: DashboardFilter = { assignment: "permanent", roleTemplateId: GA, excludeEmergency: true };
        expect(apply(filter, ["u2"])).toEqual(["ga"]);
        expect(apply(filter, ["u1", "u2"])).toEqual([]);
        expect(apply({ ...filter, excludeEmergency: false }, ["u1", "u2"])).toEqual(["ga"]);
        // alone it does nothing
        expect(apply({ excludeEmergency: true }, ["u1", "u2"])).toEqual(ids(ROLES));
    });

    it("does not mutate the input", () => {
        const copy = [...ROLES];
        apply({ privileged: true });
        expect(ROLES).toEqual(copy);
    });

    it("matches each Agent ID kind but not ordinary apps or users", () => {
        const agentRoles = [
            role({ id: "agent-identity", eligible: [{ principalId: "agent-identity", principal: agent("agent-identity") }] }),
            role({ id: "agent-user", eligible: [{ principalId: "agent-user", principal: agentUser("agent-user") }] }),
            role({ id: "blueprint", eligible: [{ principalId: "blueprint", principal: blueprint("blueprint") }] }),
            role({ id: "ordinary-app", eligible: [{ principalId: "ordinary-app", principal: app("ordinary-app") }] }),
            role({ id: "ordinary-user", eligible: [{ principalId: "ordinary-user", principal: user("ordinary-user") }] }),
        ];
        expect(ids(applyDashboardFilterToRoles(agentRoles, { principalType: "agent" }))).toEqual(["agent-identity", "agent-user", "blueprint"]);
    });

    it("does not count an agent user as a user or an agent identity as an app", () => {
        const agentUserRole = role({ id: "agent-user", eligible: [{ principalId: "agent-user", principal: agentUser("agent-user") }] });
        const identityRoles = [
            role({ id: "derived-agent", eligible: [{ principalId: "derived-agent", principal: agent("derived-agent") }] }),
            role({ id: "base-agent", eligible: [{ principalId: "base-agent", principal: agentBase("base-agent") }] }),
        ];
        expect(applyDashboardFilterToRoles([agentUserRole], { principalType: "user" })).toEqual([]);
        expect(applyDashboardFilterToRoles(identityRoles, { principalType: "servicePrincipal" })).toEqual([]);
    });
});

const g1 = group("g1", [{ assignmentType: "eligible", principalId: "u1", principal: user("u1") }]);
const g2 = group("g2", [{ assignmentType: "permanent", principalId: "a1", principal: app("a1") }]);
const g3 = group("g3", [], false);
const g4 = group("g4", [{ assignmentType: "active", assignmentOrigin: "activated", principalId: "u1", principal: user("u1"), endDateTime: "2026-12-01T00:00:00Z" }]);
const GROUPS = [g1, g2, g3, g4];
const gids = (filter: DashboardFilter, emergency: string[] = []) => applyDashboardFilterToGroups(GROUPS, filter, { emergencyAccountIds: new Set(emergency) }).map((g) => g.group.id);

describe("applyDashboardFilterToGroups", () => {
    it("returns the same array for an empty filter", () => {
        expect(applyDashboardFilterToGroups(GROUPS, {})).toBe(GROUPS);
    });

    it("answers the keys groups can answer", () => {
        expect(gids({ assignment: "eligible" })).toEqual(["g1"]);
        expect(gids({ assignment: "permanent" })).toEqual(["g2"]);
        expect(gids({ assignment: "active" })).toEqual(["g4"]);
        expect(gids({ assignment: "activeTimeBound" })).toEqual(["g4"]);
        expect(gids({ principalType: "servicePrincipal" })).toEqual(["g2"]);
        expect(gids({ noEndDate: true })).toEqual(["g1"]);
    });

    it("matches a PIM group assignment held by an agent user", () => {
        const agentUserGroup = group("agent-user-group", [{ assignmentType: "eligible", principalId: "agent-user", principal: agentUser("agent-user") }]);
        expect(applyDashboardFilterToGroups([agentUserGroup], { principalType: "agent" }).map((g) => g.group.id)).toEqual(["agent-user-group"]);
    });

    it("hasEligible false needs a managed group", () => {
        expect(gids({ hasEligible: false })).toEqual(["g2", "g4"]);
    });

    it("excludeEmergency leaves marked principals out", () => {
        expect(gids({ assignment: "permanent", excludeEmergency: true }, ["a1"])).toEqual([]);
    });

    it("shows no group for a filter that groups cannot answer", () => {
        expect(gids({ privileged: true })).toEqual([]);
        expect(gids({ mfa: "neither", assignment: "eligible" })).toEqual([]);
        expect(filterAppliesToGroups({ assignment: "eligible", principalType: "user" })).toBe(true);
        expect(filterAppliesToGroups({ approval: "required" })).toBe(false);
        expect(filterAppliesToGroups({})).toBe(true);
    });
});

describe("edge cases", () => {
    it("a guest filter shows no group because group assignments carry no userType", () => {
        expect(filterAppliesToGroups({ principalType: "guest" })).toBe(false);
        expect(gids({ principalType: "guest" })).toEqual([]);
    });

    it("principalType on groups", () => {
        expect(gids({ principalType: "user" })).toEqual(["g1", "g4"]);
    });

    it("roles without a loaded policy match none of the policy keys", () => {
        expect(apply({ mfa: "neither" })).not.toContain("custom");
        expect(apply({ maxDuration: "upTo1h" })).not.toContain("custom");
        expect(apply({ activationNotification: "none" })).not.toContain("custom");
        expect(apply({ activationNotification: "none" })).not.toContain("sec");
    });

    it("an unparseable maximum duration matches no bucket", () => {
        const odd = role({ id: "odd", isPrivileged: true, policy: policy({ maxDuration: "not-a-duration" }) });
        expect(applyDashboardFilterToRoles([odd], { maxDuration: "upTo1h" })).toEqual([]);
    });

    it("Entra MFA wins when a policy somehow has both MFA and an authentication context", () => {
        const both = role({ id: "both", policy: policy({ mfa: true, authContext: "c1" }) });
        expect(applyDashboardFilterToRoles([both], { mfa: "entraMfa" })).toHaveLength(1);
        expect(applyDashboardFilterToRoles([both], { mfa: "authContext" })).toHaveLength(0);
        expect(applyDashboardFilterToRoles([both], { mfa: "neither" })).toHaveLength(0);
    });

    it("an assigned schedule with an end date is time-bound, and the assignment type is read in any letter case", () => {
        const r = role({ id: "r", active: [{ principalId: "u1", assignmentType: "assigned", ...endsLater }, { principalId: "u2", assignmentType: "ACTIVATED", ...noEnd }] });
        expect(applyDashboardFilterToRoles([r], { assignment: "activeTimeBound" })).toHaveLength(1);
        expect(applyDashboardFilterToRoles([r], { assignment: "active" })).toHaveLength(1);
        expect(applyDashboardFilterToRoles([r], { assignment: "permanent" })).toHaveLength(0);
    });

    it("the report list equals the dashboard list for the same filter because both call the same function", () => {
        const filter = parseDashboardFilter("mfa:neither");
        expect(ids(applyDashboardFilterToRoles(ROLES, filter))).toEqual(["app"]);
    });
});

describe("filters added after the intuitiveness test", () => {
    const extRule = (slot: "Pre" | "Post", id: string, name: string) => ({
        id: `CustomExtension_${slot}Approval_EndUser_Assignment`,
        "@odata.type": "#microsoft.graph.unifiedRoleManagementPolicyCustomExtensionRule",
        isEnabled: true,
        customExtensionId: id,
        displayName: name,
    });
    const withRules = (base: ReturnType<typeof policy>, extra: object[]) => ({ ...base, details: { ...base!.details, rules: [...(base!.details!.rules ?? []), ...extra] } }) as ReturnType<typeof policy>;
    const short = role({ id: "short", isPrivileged: true, policy: policy({ maxDuration: "PT8H" }) });
    const long = role({ id: "long", isPrivileged: true, policy: withRules(policy({ maxDuration: "PT9H" }), [extRule("Pre", "ext-1", "ServiceNow check")]) });
    const day = role({ id: "day", isPrivileged: true, policy: policy({ maxDuration: "P1D" }) });
    const viaGroup = role({ id: "via-group", eligible: [{ principalId: "g1", principal: groupPrincipal("g1"), ...endsLater }] });
    const direct = role({ id: "direct", eligible: [{ principalId: "u1", principal: user("u1"), ...endsLater }] });

    it("round-trips the new values", () => {
        for (const f of [{ maxDuration: "over8h" }, { via: "direct" }, { via: "group" }, { customExtension: "ext-1" }] as DashboardFilter[]) {
            expect(parseDashboardFilter(serializeDashboardFilter(f))).toEqual(f);
        }
        expect(parseDashboardFilter("customExtension:bad value")).toEqual({});
        expect(parseDashboardFilter("via:sideways")).toEqual({});
    });

    it("over8h is every maximum above 8 hours, the over 8 h figure of Terms", () => {
        expect(applyDashboardFilterToRoles([short, long, day], { maxDuration: "over8h" }).map((r) => r.definition.id)).toEqual(["long", "day"]);
    });

    it("via splits like Direct or through a group", () => {
        expect(applyDashboardFilterToRoles([viaGroup, direct], { via: "group" }).map((r) => r.definition.id)).toEqual(["via-group"]);
        expect(applyDashboardFilterToRoles([viaGroup, direct], { via: "direct" }).map((r) => r.definition.id)).toEqual(["direct"]);
    });

    it("customExtension keeps the roles whose policy links it", () => {
        expect(applyDashboardFilterToRoles([short, long, day], { customExtension: "ext-1" }).map((r) => r.definition.id)).toEqual(["long"]);
    });

    it("names roles and extensions in the chip instead of ids", () => {
        const names = buildFilterNames([long, role({ id: "ga", name: "Global Administrator", templateId: "62e90394-69f5-4237-9190-012177145e10" })]);
        expect(getFilterLabels({ customExtension: "ext-1" }, names)[0].label).toBe("Custom extension: ServiceNow check");
        expect(getFilterLabels({ roleTemplateId: "62e90394-69f5-4237-9190-012177145e10" })[0].label).toBe("Role: Global Administrator");
        expect(getFilterLabels({ via: "group" })[0].label).toBe("Held through a group");
        expect(getFilterLabels({ maxDuration: "over8h" })[0].label).toBe("Maximum activation: over 8 h");
    });
});
