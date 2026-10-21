import { describe, expect, it } from "vitest";
import { mapGraphError } from "@/utils/graphErrorMapping";
import { graphError } from "@/__tests__/support/recordingGraphClient";

describe("mapGraphError: the codes of the Configure apply (spec 13.3)", () => {
    it.each([
        ["PendingRoleAssignmentRequest", 400, "policy-rejected", "A scheduled or pending request on this assignment must finish first."],
        ["CannotDeleteLastAdminAssignment", 400, "policy-rejected", "Microsoft does not remove the last administrator of a role or the last owner of a group."],
        ["ActiveDurationTooShort", 400, "stale-state", "Microsoft removes or changes an assignment only after it has been active for five minutes."],
        ["MissingProvider", 400, "policy-rejected", "Microsoft did not accept the rule as PIM Manager sent it."],
        ["RoleAssignmentRequestPolicyValidationFailed", 400, "policy-rejected", "The request breaks a rule of the PIM settings of this role or group: RoleAssignmentRequestPolicyValidationFailed happened"],
        ["MfaAndAcrsConflict", 400, "policy-rejected", "MFA and authentication context cannot both be enabled on the same policy at once."],
        ["InvalidPolicy", 400, "policy-rejected", "Microsoft rejected the policy as invalid."],
        ["RoleAssignmentDoesNotExist", 404, "not-found", "Microsoft Graph couldn't find the referenced object."],
        ["TooManyRequests", 429, "transient", "Microsoft Graph throttled this request."],
    ])("%s", (code, status, classification, text) => {
        expect(mapGraphError(graphError(status, code, `${code} happened`))).toMatchObject({ classification, friendlyMessage: text, rawCode: code });
    });

    it("a policy validation failure about the duration reads as the duration limit", () => {
        expect(mapGraphError(graphError(400, "RoleAssignmentRequestPolicyValidationFailed", "ExpirationRule: maximum duration exceeded")).classification).toBe("duration-limit");
    });

    it("reads the code from the SDK's GraphError: code on the error, body an unwrapped JSON string", () => {
        // What GraphErrorHandler builds from a Graph answer: `code` set, `body` = JSON.stringify of the inner error
        const sdk = Object.assign(new Error("Cannot delete the last admin assignment"), { statusCode: 400, code: "CannotDeleteLastAdminAssignment", body: JSON.stringify({ code: "CannotDeleteLastAdminAssignment", message: "Cannot delete the last admin assignment", innerError: {} }) });
        expect(mapGraphError(sdk)).toMatchObject({ rawCode: "CannotDeleteLastAdminAssignment", classification: "policy-rejected" });
        // A body object, as other callers pass it
        expect(mapGraphError({ statusCode: 400, body: { error: { code: "MissingProvider", message: "x" } } }).rawCode).toBe("MissingProvider");
        // A body that is no JSON does not throw
        expect(mapGraphError(Object.assign(new Error("boom"), { statusCode: 400, body: "<html>" })).friendlyMessage).toBe("boom");
    });
});
