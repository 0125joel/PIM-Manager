import { describe, expect, it } from "vitest";
import { isEmptySingleIdAnswer } from "@/utils/graphIdFilter";
import { graphError } from "../support/recordingGraphClient";

describe("isEmptySingleIdAnswer", () => {
    it("is true for a 404 Request_ResourceNotFound on one id", () => {
        expect(isEmptySingleIdAnswer(graphError(404, "Request_ResourceNotFound"), 1)).toBe(true);
    });

    it("is false for two values", () => {
        expect(isEmptySingleIdAnswer(graphError(404, "Request_ResourceNotFound"), 2)).toBe(false);
    });

    it("is false for a 404 with another code", () => {
        expect(isEmptySingleIdAnswer(graphError(404, "NotFound"), 1)).toBe(false);
    });

    it("is false for a 403", () => {
        expect(isEmptySingleIdAnswer(graphError(403, "Request_ResourceNotFound"), 1)).toBe(false);
    });

    it("is false for an error that is not an HTTP error", () => {
        expect(isEmptySingleIdAnswer(new Error("network"), 1)).toBe(false);
        expect(isEmptySingleIdAnswer(null, 1)).toBe(false);
    });
});
