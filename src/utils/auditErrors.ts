/**
 * The audit read's limit and error classes, and the pure mapping of a failed read to the state the Audit page shows
 * (implementation spec section 3). Pure: no Graph, no state. The error classes live here, not in the service, because
 * utils may not import services; `auditService.ts` re-exports `AuditTooManyEventsError`.
 */
import { getErrorCode } from "@/utils/errorUtils";

/** The most events one audit read may hold before it stops (implementation spec section 3) */
export const AUDIT_ROW_LIMIT = 50_000;

/** The read stopped because the period holds more events than AUDIT_ROW_LIMIT; `limit` names that limit */
export class AuditTooManyEventsError extends Error {
    readonly limit: number;

    constructor(limit: number = AUDIT_ROW_LIMIT) {
        super(`The audit log holds more than ${limit} events in this period, so the read stopped.`);
        this.name = "AuditTooManyEventsError";
        this.limit = limit;
    }
}

export type AuditErrorKind = "role-missing" | "permission" | "too-many" | "failed";

/** Measured: a 403 with this code for a user without a reader role (audit research, 2026-11) */
const ROLE_MISSING_CODE = "Authentication_RequestFromUnsupportedUserRole";
/**
 * Not measured. Mapped to "permission" by design: Graph answers 403 with this code when the token lacks the audit scope
 * or the user may not read the log. Confirm on a tenant before relying on the wording of the permission state.
 */
const PERMISSION_CODE = "Authorization_RequestDenied";

/** The Graph code inside a JSON `body` string, when the error has no `code` on the object (services/AGENTS.md) */
function bodyCode(error: unknown): string | undefined {
    if (typeof error !== "object" || error === null || !("body" in error)) return undefined;
    const body = (error as { body?: unknown }).body;
    if (typeof body !== "string") return undefined;
    try {
        const parsed = JSON.parse(body) as { error?: { code?: unknown } } | null;
        const code = parsed?.error?.code;
        return typeof code === "string" ? code : undefined;
    } catch {
        return undefined;
    }
}

/** What a failed audit read means for the page. Only the two measured or documented codes are told apart; the rest is a failure. */
export function classifyAuditError(error: unknown): AuditErrorKind {
    if (error instanceof AuditTooManyEventsError) return "too-many";
    const code = getErrorCode(error) ?? bodyCode(error);
    if (code === ROLE_MISSING_CODE) return "role-missing";
    if (code === PERMISSION_CODE) return "permission";
    return "failed";
}
