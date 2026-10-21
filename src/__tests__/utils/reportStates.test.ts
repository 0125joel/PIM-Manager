import { describe, expect, it } from "vitest";
import { areSettingsPending, describeNoMatch, isPrivilegedStatusMissing, summarizeFailedRoles, summarizeFailureCause } from "@/utils/reportStates";
import { role } from "../fixtures/dashboardFilterFixtures";

describe("summarizeFailureCause", () => {
    it("adds after 3 tries only for 429 and 5xx", () => {
        expect(summarizeFailureCause(["429", "429"])).toBe("Microsoft Graph answered 429 after 3 tries.");
        expect(summarizeFailureCause(["Request failed with status 503"])).toBe("Microsoft Graph answered 503 after 3 tries.");
        expect(summarizeFailureCause(["403 Forbidden", "429"])).toBe("Microsoft Graph answered 403, 429 after 3 tries.");
    });
    it("falls back to a plain sentence without a status", () => {
        expect(summarizeFailureCause([undefined, "boom"])).toBe("Microsoft Graph did not return them.");
    });
});

describe("summarizeFailedRoles", () => {
    const a = { ...role({ id: "a" }), configError: "429" };
    const b = { ...role({ id: "b" }), configError: "429" };
    it("counts the failed roles and says why", () => {
        expect(summarizeFailedRoles([a, b, role({ id: "c" })], ["a", "b"])).toEqual({ ids: ["a", "b"], title: "Settings of 2 roles could not be loaded", cause: "Microsoft Graph answered 429 after 3 tries." });
        expect(summarizeFailedRoles([a], ["a"])?.title).toBe("Settings of 1 role could not be loaded");
    });
    it("is null when nothing failed", () => {
        expect(summarizeFailedRoles([a], [])).toBeNull();
    });
});

describe("describeNoMatch", () => {
    it("names the search and the filters", () => {
        expect(describeNoMatch("roles", " zzz ", ["Privileged only", "Has assignments"])).toEqual({ title: "No roles match", detail: 'Search: "zzz". Filters: Privileged only, Has assignments.' });
        expect(describeNoMatch("groups", "", [])).toEqual({ title: "No groups match", detail: "" });
    });
});

describe("isPrivilegedStatusMissing", () => {
    it("is true when any role has no isPrivileged, never for an empty list", () => {
        expect(isPrivilegedStatusMissing([role({ id: "a", isPrivileged: true }), role({ id: "b" })])).toBe(true);
        expect(isPrivilegedStatusMissing([role({ id: "a", isPrivileged: false })])).toBe(false);
        expect(isPrivilegedStatusMissing([])).toBe(false);
    });
});

describe("areSettingsPending", () => {
    const loaded = { ...role({ id: "a" }), policy: { id: "p" } } as unknown as ReturnType<typeof role>;
    const missing = role({ id: "b" });
    const failed = { ...role({ id: "c" }), configError: "429" };
    const base = { view: "roles" as const, rolePoliciesLoading: true, groupsLoading: false, groups: [] };
    it("keeps the filters on during a refresh when every role has its policy", () => {
        expect(areSettingsPending({ ...base, roles: [loaded, failed] })).toBe(false);
    });
    it("waits while a role has no policy yet, and never when nothing loads", () => {
        expect(areSettingsPending({ ...base, roles: [loaded, missing] })).toBe(true);
        expect(areSettingsPending({ ...base, rolePoliciesLoading: false, roles: [missing] })).toBe(false);
    });
    it("waits for groups under PIM only, and while no group is known", () => {
        const groupsBase = { ...base, view: "groups" as const, groupsLoading: true, roles: [] };
        expect(areSettingsPending({ ...groupsBase, groups: [] })).toBe(true);
        expect(areSettingsPending({ ...groupsBase, groups: [{ isManaged: true, policies: { member: undefined } }, { isManaged: false }] })).toBe(false);
        expect(areSettingsPending({ ...groupsBase, groups: [{ isManaged: true }] })).toBe(true);
        expect(areSettingsPending({ ...groupsBase, groupsLoading: false, groups: [{ isManaged: true }] })).toBe(false);
    });
});
