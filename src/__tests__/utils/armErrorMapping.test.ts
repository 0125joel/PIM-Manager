import { describe, expect, it } from "vitest";
import { ArmError } from "@/utils/armClient";
import { mapArmError } from "@/utils/armErrorMapping";

const RAW = "raw message with /subscriptions/0000 and an id";

function armError(status: number, code: string): ArmError {
    return new ArmError(status, code, RAW, new Headers());
}

describe("mapArmError: the rules of the table", () => {
    it.each([
        [403, "AuthorizationFailed", "No access to this scope", "Your Azure role at this scope does not allow this. If you were given a role just now, sign out and sign in again."],
        [400, "InsufficientPermissions", "No access to this scope", "Your Azure role at this scope does not allow this request."],
        [404, "ResourceGroupNotFound", "Resource group not found", "The resource group no longer exists or was moved. Refresh to load the current scopes."],
        [400, "ResourceNotFound", "No role settings", "No role settings for this role at this scope."],
        [400, "InvalidFilter", "Request not supported", "Azure Resource Manager rejected the filter of this request. This is a fault in PIM Manager; please report it."],
        [404, "InvalidResourceType", "Request not supported", "Azure Resource Manager does not support this request. This is a fault in PIM Manager; please report it."],
        [429, "SubscriptionRequestsThrottled", "Azure is limiting requests", "Loading continues shortly."],
    ])("%i %s", (status, code, title, detail) => {
        expect(mapArmError(armError(status, code))).toEqual({ title, detail });
    });

    it("a 429 with code Unknown gives the throttle texts", () => {
        expect(mapArmError(armError(429, "Unknown"))).toEqual({
            title: "Azure is limiting requests",
            detail: "Loading continues shortly.",
        });
    });

    it("a 503 gives the not available texts", () => {
        expect(mapArmError(armError(503, "ServiceUnavailable"))).toEqual({
            title: "Azure Resource Manager is not available",
            detail: "Azure answered 503. Try again in a few minutes.",
        });
    });

    it("a 409 with a known code gives the status and code", () => {
        expect(mapArmError(armError(409, "Conflict"))).toEqual({
            title: "Azure Resource Manager returned an error",
            detail: "Azure answered 409 (Conflict).",
        });
    });

    it("a 5xx with code Unknown gives the not available texts; another status with code Unknown gives the status only", () => {
        expect(mapArmError(armError(502, "Unknown"))).toEqual({
            title: "Azure Resource Manager is not available",
            detail: "Azure answered 502. Try again in a few minutes.",
        });
        expect(mapArmError(armError(418, "Unknown"))).toEqual({
            title: "Azure Resource Manager returned an error",
            detail: "Azure answered 418.",
        });
    });

    it("a network error (TypeError without a status) gives the could-not-be-reached texts", () => {
        expect(mapArmError(new TypeError("Failed to fetch"))).toEqual({
            title: "Azure Resource Manager could not be reached",
            detail: "Check the network connection and try again.",
        });
    });

    it("an aborted request gives the loading stopped texts", () => {
        const expected = { title: "Loading stopped", detail: "The request was cancelled." };
        expect(mapArmError(new Error("Aborted"))).toEqual(expected);
        expect(mapArmError(Object.assign(new Error("x"), { name: "AbortError" }))).toEqual(expected);
    });

    it("the page cap without a status gives the too-many-results texts", () => {
        expect(mapArmError(new Error("ARM list /subscriptions has more than 50 pages"))).toEqual({
            title: "Too many results",
            detail: "This list is longer than PIM Manager can load at once (50 pages).",
        });
    });

    it.each([
        ["an unrelated error", new Error("something odd")],
        ["a string", "boom"],
        ["undefined", undefined],
    ])("%s gives the generic texts", (_label, error) => {
        expect(mapArmError(error)).toEqual({
            title: "Azure Resource Manager returned an error",
            detail: "Something went wrong while loading from Azure.",
        });
    });

    it("an error with a rule-3 code and an unexpected status still gives the rule-3 texts", () => {
        expect(mapArmError(armError(400, "AuthorizationFailed"))).toEqual({
            title: "No access to this scope",
            detail: "Your Azure role at this scope does not allow this. If you were given a role just now, sign out and sign in again.",
        });
    });

    it("the raw ARM message never reaches the title or the detail", () => {
        const errors = [
            armError(403, "AuthorizationFailed"),
            armError(400, "InsufficientPermissions"),
            armError(404, "ResourceGroupNotFound"),
            armError(400, "ResourceNotFound"),
            armError(400, "InvalidFilter"),
            armError(404, "InvalidResourceType"),
            armError(429, "SubscriptionRequestsThrottled"),
            armError(503, "ServiceUnavailable"),
            armError(409, "Conflict"),
            armError(418, "Unknown"),
        ];
        for (const error of errors) {
            const text = mapArmError(error);
            expect(text.title).not.toContain("raw message");
            expect(text.detail).not.toContain("raw message");
            expect(text.detail).not.toContain("/subscriptions/0000");
        }
    });
});
