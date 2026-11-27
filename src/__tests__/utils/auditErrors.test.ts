import { describe, expect, it } from "vitest";
import { AUDIT_ROW_LIMIT, AuditTooManyEventsError, classifyAuditError } from "@/utils/auditErrors";

describe("classifyAuditError", () => {
    it("tells the limit apart: too many events, with the limit named on the error", () => {
        const error = new AuditTooManyEventsError();
        expect(classifyAuditError(error)).toBe("too-many");
        expect(error.limit).toBe(AUDIT_ROW_LIMIT);
        expect(error.name).toBe("AuditTooManyEventsError");
        expect(error.message).toContain("50000");
    });

    it("maps the measured role-missing code, on the error object", () => {
        expect(classifyAuditError({ code: "Authentication_RequestFromUnsupportedUserRole", statusCode: 403 })).toBe("role-missing");
    });

    it("maps the role-missing code when only the JSON body carries it", () => {
        const body = JSON.stringify({ error: { code: "Authentication_RequestFromUnsupportedUserRole", message: "Demo" } });
        expect(classifyAuditError({ statusCode: 403, body })).toBe("role-missing");
    });

    it("maps Authorization_RequestDenied to permission (not measured: see auditErrors.ts)", () => {
        expect(classifyAuditError({ code: "Authorization_RequestDenied", statusCode: 403 })).toBe("permission");
        expect(classifyAuditError({ statusCode: 403, body: JSON.stringify({ error: { code: "Authorization_RequestDenied" } }) })).toBe("permission");
    });

    it("keeps a 403 with any other code as a failure, never an empty result", () => {
        expect(classifyAuditError({ code: "Forbidden", statusCode: 403 })).toBe("failed");
        expect(classifyAuditError({ statusCode: 403 })).toBe("failed");
    });

    it("treats everything else as a failure", () => {
        expect(classifyAuditError({ code: "ServiceNotAvailable", statusCode: 503 })).toBe("failed");
        expect(classifyAuditError(new Error("network down"))).toBe("failed");
        expect(classifyAuditError("a string")).toBe("failed");
        expect(classifyAuditError(null)).toBe("failed");
        expect(classifyAuditError(undefined)).toBe("failed");
    });

    it("does not throw on a body that is not JSON, or JSON without an error code", () => {
        expect(classifyAuditError({ statusCode: 403, body: "not json {" })).toBe("failed");
        expect(classifyAuditError({ statusCode: 403, body: JSON.stringify({ error: {} }) })).toBe("failed");
        expect(classifyAuditError({ statusCode: 403, body: "null" })).toBe("failed");
        expect(classifyAuditError({ statusCode: 403, body: 42 })).toBe("failed");
    });
});
