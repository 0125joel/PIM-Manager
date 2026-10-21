import { describe, expect, it, vi } from "vitest";
import type { Client } from "@microsoft/microsoft-graph-client";
import { concurrentFetchPolicies } from "@/services/directoryRoleService";
import { applyPolicyResult, type RolesContent } from "@/workloads/directoryRolesAdapter";
import type { RoleDetailData } from "@/types/directoryRole.types";

const httpError = (statusCode: number) => Object.assign(new Error(`HTTP ${statusCode}`), { statusCode });

/**
 * A Graph client for the role policy reads: a call with a `roleDefinitionId` filter is a per-role read, any other
 * policy read is the one-call read of every role. `answer` decides per call.
 */
function policyClient(answer: (filter: string) => Promise<unknown>) {
    const calls: string[] = [];
    const client = {
        api() {
            let filter = "";
            const chain = {
                version: () => chain,
                header: () => chain,
                expand: () => chain,
                filter: (f: string) => { filter = f; return chain; },
                get: () => { calls.push(filter); return answer(filter); },
            };
            return chain;
        },
    } as unknown as Client;
    return { client, calls };
}

const roleIds = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => `${prefix}-${i}`);

describe("the role policies of a user who may not read them (FIX-12)", () => {
    it("a 403 on the one-call read makes no per-role call, marks every role and caches nothing", async () => {
        const ids = roleIds("bulk403", 12);
        const { client, calls } = policyClient(async () => { throw httpError(403); });
        const marked: Array<{ id: string; forbidden?: boolean; error?: string }> = [];
        await concurrentFetchPolicies(client, ids, 2, 0, undefined, (id, _policy, error, forbidden) => marked.push({ id, forbidden, error }));

        expect(calls).toHaveLength(1);
        expect(calls[0]).not.toContain("roleDefinitionId");
        expect(marked.map((m) => m.id).sort()).toEqual([...ids].sort());
        expect(marked.every((m) => m.forbidden === true && m.error === undefined)).toBe(true);

        // Nothing was stored as "no policy": the next load asks Graph again
        await concurrentFetchPolicies(client, ids, 2, 0);
        expect(calls.length).toBeGreaterThan(1);
    });

    it("a 500 on the one-call read still falls back to one read per role", async () => {
        const ids = roleIds("bulk500", 10);
        const { client, calls } = policyClient(async (filter) => {
            if (!filter.includes("roleDefinitionId")) throw httpError(500);
            return { value: [] };
        });
        await concurrentFetchPolicies(client, ids, 2, 0);
        expect(calls.filter((f) => f.includes("roleDefinitionId"))).toHaveLength(10);
    });

    it("a 403 on a per-role read is not retried and marks the role, it does not count as failed", async () => {
        const ids = roleIds("single403", 3);
        const { client, calls } = policyClient(async (filter) => {
            if (filter.includes("single403-1")) throw httpError(403);
            return { value: [] };
        });
        const outcomes = new Map<string, { error?: string; forbidden?: boolean }>();
        await concurrentFetchPolicies(client, ids, 2, 0, undefined, (id, _p, error, forbidden) => outcomes.set(id, { error, forbidden }));

        expect(calls.filter((f) => f.includes("single403-1"))).toHaveLength(1);
        expect(outcomes.get("single403-1")).toEqual({ error: undefined, forbidden: true });
        expect(outcomes.get("single403-0")?.forbidden).toBeUndefined();
    });

    it("still retries a per-role 500 and reports it as a failure", async () => {
        vi.useFakeTimers();
        try {
            const ids = roleIds("single500", 2);
            const { client, calls } = policyClient(async (filter) => {
                if (filter.includes("single500-1")) throw httpError(500);
                return { value: [] };
            });
            const outcomes = new Map<string, string | undefined>();
            const promise = concurrentFetchPolicies(client, ids, 2, 0, undefined, (id, _p, error) => { if (error) outcomes.set(id, error); });
            await vi.advanceTimersByTimeAsync(60000);
            await promise;
            expect(calls.filter((f) => f.includes("single500-1")).length).toBeGreaterThan(1);
            expect(outcomes.has("single500-1")).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("applyPolicyResult with the marker", () => {
    const role = (id: string, extra: Partial<RoleDetailData> = {}): RoleDetailData => ({ definition: { id, displayName: id } as RoleDetailData["definition"], assignments: { permanent: [], eligible: [], active: [] }, policy: null, ...extra } as RoleDetailData);
    const content = (roles: RoleDetailData[], failedRoleIds: string[] = []): RolesContent => ({ data: roles, extras: { authenticationContexts: [], failedRoleIds } });

    it("marks the role not readable, not failed and without a policy", () => {
        const next = applyPolicyResult(content([role("r1")]), "r1", null, undefined, true);
        expect(next.data[0]).toMatchObject({ policy: null, policiesForbidden: true, configError: undefined });
        expect(next.extras.failedRoleIds).toEqual([]);
    });

    it("drops the marker when the policy reads again", () => {
        const marked = content([role("r1", { policiesForbidden: true })]);
        const next = applyPolicyResult(marked, "r1", { id: "p", policy: { id: "p", rules: [] } } as never);
        expect(next.data[0].policiesForbidden).toBeUndefined();
    });

    it("a 403 clears an earlier failure of the same role", () => {
        const failed = content([role("r1", { configError: "429" })], ["r1"]);
        const next = applyPolicyResult(failed, "r1", null, undefined, true);
        expect(next.extras.failedRoleIds).toEqual([]);
        expect(next.data[0].policiesForbidden).toBe(true);
    });
});
