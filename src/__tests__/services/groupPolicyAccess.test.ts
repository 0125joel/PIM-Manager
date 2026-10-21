import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@microsoft/microsoft-graph-client";
import { fetchGroupPolicies, groupPolicyFields } from "@/services/pimGroupService";

/** A Graph client whose every call answers `get`: enough for the one policy read the service makes */
function clientAnswering(get: () => Promise<unknown>) {
    const request: Record<string, unknown> = {};
    const chain = () => request;
    Object.assign(request, { version: chain, header: chain, filter: chain, expand: chain, select: chain, get });
    return { api: () => request } as unknown as Client;
}

const httpError = (statusCode: number) => Object.assign(new Error(`HTTP ${statusCode}`), { statusCode });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("fetchGroupPolicies: a 403 is an answer about the access, not a failure", () => {
    it("returns the group as forbidden, without a retry and without throwing", async () => {
        const get = vi.fn().mockRejectedValue(httpError(403));
        const read = await fetchGroupPolicies(clientAnswering(get), "g1");
        expect(read).toEqual({ policies: [], settings: {}, forbidden: true });
        expect(get).toHaveBeenCalledTimes(1);
    });

    it("reads a policy the admin may read as not forbidden", async () => {
        const get = vi.fn().mockResolvedValue({ value: [] });
        const read = await fetchGroupPolicies(clientAnswering(get), "g1");
        expect(read.forbidden).toBe(false);
    });

    it("treats a 404 as nothing there, not as forbidden", async () => {
        const read = await fetchGroupPolicies(clientAnswering(() => Promise.reject(httpError(404))), "g1");
        expect(read).toEqual({ policies: [], settings: {}, forbidden: false });
    });

    it("still retries a 429 and reads the policy on the second answer", async () => {
        const get = vi.fn().mockRejectedValueOnce(httpError(429)).mockResolvedValue({ value: [] });
        const promise = fetchGroupPolicies(clientAnswering(get), "g1");
        await vi.advanceTimersByTimeAsync(5000);
        const read = await promise;
        expect(get).toHaveBeenCalledTimes(2);
        expect(read.forbidden).toBe(false);
    });

    it("still fails with a 500 after the retries, so the load fails as before", async () => {
        const get = vi.fn().mockRejectedValue(httpError(500));
        const promise = fetchGroupPolicies(clientAnswering(get), "g1");
        const assertion = expect(promise).rejects.toMatchObject({ statusCode: 500 });
        await vi.advanceTimersByTimeAsync(10000);
        await assertion;
        expect(get).toHaveBeenCalledTimes(3);
    });
});

describe("groupPolicyFields", () => {
    const previous = { member: { id: "m", groupId: "g1", policyType: "member" as const, displayName: "", rules: [] } };

    it("marks a forbidden group and drops anything held for it, never a 'no policy'", () => {
        const fields = groupPolicyFields({ policies: [], settings: {}, forbidden: true }, previous);
        expect(fields).toEqual({ policies: undefined, settings: undefined, policiesForbidden: true });
    });

    it("clears the marker once the policy reads again", () => {
        const fields = groupPolicyFields({ policies: [], settings: { memberRequiresMfa: true }, forbidden: false });
        expect(fields.policiesForbidden).toBeUndefined();
        expect(fields.settings).toEqual({ memberRequiresMfa: true });
    });
});
