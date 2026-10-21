/**
 * The role write service around the one mapper (NG-54): version, reads, failures. The groups write through the apply engine of Configure (`configureApplyService.test.ts`). The bodies themselves are pinned by
 * policyWriteGolden.test.ts and the mapper by utils/policyRules.test.ts.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { updatePimPolicy } from "@/services/pimConfigurationService";
import { parseGraphPolicy } from "@/utils/policyParser";
import { createRecordingClient, graphError } from "../support/recordingGraphClient";
import { ROLE_ID, roleRules } from "../fixtures/policyRules";

async function settle<T>(promise: Promise<T>): Promise<T> {
    let done = false;
    promise.then(() => { done = true; }, () => { done = true; });
    while (!done) await vi.advanceTimersByTimeAsync(500);
    return promise;
}

beforeAll(async () => { await import("@/services/pimConfigurationService"); });
beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); });
afterEach(() => { vi.useRealTimers(); });

function roleClient() {
    const rules = roleRules();
    return {
        rules,
        recording: createRecordingClient([{
            method: "GET",
            match: (r) => r.path === "/policies/roleManagementPolicyAssignments",
            respond: () => ({ value: [{ policyId: "role-policy", policy: { id: "role-policy", rules } }] }),
        }]),
    };
}

describe("policy write services", () => {
    it("roles: read on v1.0 with the tenant-wide filter, PATCH on v1.0", async () => {
        const { rules, recording } = roleClient();
        const edited = { ...parseGraphPolicy({ rules }), maxActivationDuration: "PT2H" };
        await settle(updatePimPolicy(recording.client, ROLE_ID, edited));
        const read = recording.requests.find((r) => r.method === "GET");
        expect(read).toMatchObject({ version: "v1.0", query: { expand: "policy($expand=rules)" } });
        expect(read?.query.filter).toBe(`scopeId eq '/' and scopeType eq 'Directory' and roleDefinitionId eq '${ROLE_ID}'`);
        expect(recording.writes().map((w) => [w.method, w.version, w.path])).toEqual([["PATCH", "v1.0", "/policies/roleManagementPolicies/role-policy/rules/Expiration_EndUser_Assignment"]]);
    });

    it("roles: a rejected PATCH is thrown, the other rules are still written", async () => {
        const { rules, recording } = roleClient();
        recording.on({ method: "PATCH", match: /Enablement_EndUser_Assignment$/, respond: () => { throw graphError(400, "InvalidPolicyRule"); } });
        const edited = { ...parseGraphPolicy({ rules }), maxActivationDuration: "PT2H", requireTicketInfo: true };
        await expect(settle(updatePimPolicy(recording.client, ROLE_ID, edited))).rejects.toThrow();
        // The other rule is still written; the failure is reported, never swallowed
        expect(recording.writes().map((w) => w.path.split("/").pop())).toEqual(["Enablement_EndUser_Assignment", "Expiration_EndUser_Assignment"]);
    });
});
