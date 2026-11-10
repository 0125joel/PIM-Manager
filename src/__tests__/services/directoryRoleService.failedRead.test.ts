import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchRoleDefinitionsAndAssignments } from "@/services/directoryRoleService";
import { createRecordingClient, graphError, type Responder } from "@/__tests__/support/recordingGraphClient";

// A failed read must fail the load, never shrink it (services/AGENTS.md, lessons/entra.md); the PIM for Groups reader already does
const ROLE = { id: "role-1", templateId: "role-1", displayName: "Dummy Role", isBuiltIn: true, isEnabled: true, rolePermissions: [] };

function client(...failing: Responder[]) {
    // The last responder that matches wins
    return createRecordingClient([
        { method: "GET", match: () => true, respond: () => ({ value: [] }) },
        { method: "GET", match: /roleDefinitions/, respond: () => ({ value: [ROLE] }) },
        ...failing,
    ]).client;
}

const failsAlways: Responder["respond"] = () => { throw graphError(503, "ServiceUnavailable"); };

/** Drives the fake timers until the promise settles (withRetry waits with setTimeout) */
async function settle<T>(promise: Promise<T>): Promise<T> {
    let done = false;
    // Handle both outcomes on the promise itself: a rejection that waits for the loop would count as unhandled
    promise.then(() => { done = true; }, () => { done = true; });
    while (!done) await vi.advanceTimersByTimeAsync(500);
    return promise;
}

beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }); });
afterEach(() => { vi.useRealTimers(); });

describe("fetchRoleDefinitionsAndAssignments: a failed role read", () => {
    it.each(["roleAssignments", "roleEligibilitySchedules", "roleAssignmentSchedules"])("rejects when the first page of %s fails", async (list) => {
        const c = client({ method: "GET", match: (r) => r.path.endsWith(`/${list}`), respond: failsAlways });
        await expect(settle(fetchRoleDefinitionsAndAssignments(c))).rejects.toMatchObject({ statusCode: 503 });
    });

    it("rejects when a nextLink page fails, instead of returning the first page as everything", async () => {
        const c = client(
            { method: "GET", match: (r) => r.path.endsWith("/roleEligibilitySchedules"), respond: () => ({ value: [{ id: "e1", roleDefinitionId: ROLE.id, principalId: "p1", directoryScopeId: "/" }], "@odata.nextLink": "https://graph.microsoft.com/v1.0/next-page" }) },
            { method: "GET", match: /next-page/, respond: failsAlways },
        );
        await expect(settle(fetchRoleDefinitionsAndAssignments(c))).rejects.toMatchObject({ statusCode: 503 });
    });

    it("still loads when only the schedule instances fail: activations through a group stay unmarked", async () => {
        const c = client({ method: "GET", match: (r) => r.path.endsWith("/roleAssignmentScheduleInstances"), respond: failsAlways });
        const roles = await settle(fetchRoleDefinitionsAndAssignments(c));
        expect(roles.map((r) => r.definition.id)).toEqual([ROLE.id]);
    });
});
