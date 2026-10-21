import { describe, expect, it } from "vitest";
import type { BasketAdd, Target } from "@/types/configure.types";
import { dryRunAssignments } from "@/services/assignmentDryRunService";
import { createRecordingClient, graphError } from "@/__tests__/support/recordingGraphClient";

const ROLE: Target = { kind: "role", id: "role-1" };
const add = (id: string, end: string | null): BasketAdd => ({ kind: "add", target: ROLE, principal: { id, kind: "user", displayName: id }, type: "eligible", scope: "/", start: null, end, justification: "test", source: { from: "edit" } });

describe("dryRunAssignments (spec 12.4, T3)", () => {
    it("sends each new assignment once with isValidationOnly and maps a refusal to the user's words", async () => {
        const rec = createRecordingClient([
            { method: "POST", match: (r) => (r.body as { principalId?: string })?.principalId === "too-long", respond: () => { throw graphError(400, "RoleAssignmentRequestPolicyValidationFailed", "The following policy rules failed: [\"ExpirationRule\"] maximum duration exceeded"); } },
            { method: "POST", match: (r) => (r.body as { principalId?: string })?.principalId === "there", respond: () => { throw graphError(400, "RoleAssignmentExists", "The Role assignment already exists."); } },
        ]);
        const results = await dryRunAssignments(rec.client, [{ id: "a", change: add("ok", "2026-11-01T00:00:00Z") }, { id: "b", change: add("too-long", "2030-01-01T00:00:00Z") }, { id: "c", change: add("there", null) }]);
        expect(rec.writes()).toHaveLength(3);
        expect(rec.writes().every((w) => w.version === "v1.0" && (w.body as { isValidationOnly?: boolean }).isValidationOnly === true && w.path === "/roleManagement/directory/roleEligibilityScheduleRequests")).toBe(true);
        expect(results.a).toEqual({ ok: true });
        expect(results.b).toMatchObject({ ok: false, code: "RoleAssignmentRequestPolicyValidationFailed", transient: false, message: "The requested duration exceeds what this role's PIM policy allows." });
        // Already there is no refusal: the apply skips a duplicate
        expect(results.c).toEqual({ ok: true });
    });

    it("a network failure is not checked; an answer that does not confirm a check-only request blocks", async () => {
        const rec = createRecordingClient([
            { method: "POST", match: (r) => (r.body as { principalId?: string })?.principalId === "offline", respond: () => { throw Object.assign(new TypeError("Failed to fetch"), { statusCode: -1, code: "TypeError" }); } },
            { method: "POST", match: (r) => (r.body as { principalId?: string })?.principalId === "written", respond: (r) => ({ ...(r.body as object), isValidationOnly: false, status: "Provisioned" }) },
        ]);
        const results = await dryRunAssignments(rec.client, [{ id: "a", change: add("offline", null) }, { id: "b", change: add("written", null) }]);
        expect(results.a).toMatchObject({ ok: false, transient: true });
        expect(results.b).toMatchObject({ ok: false, transient: false, message: expect.stringContaining("may have been written") });
    });
});
