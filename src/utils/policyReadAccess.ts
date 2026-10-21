import { getErrorStatusCode } from "@/utils/errorUtils";

/**
 * The one sentence every screen shows where a PIM policy (a directory role's or a group's) could not be read because
 * Graph answered 403 (FIX-11, FIX-12). Same wording everywhere, so the Report, the Dashboard and the exports agree.
 */
export const POLICY_NOT_READABLE = "Settings not readable with your current access. Activate a role that may read PIM settings, then Refresh.";

/**
 * A 403 on a policy read is a fact about the signed-in user's access (tenant run 2026-10-10): retrying never helps,
 * it does not fail the load, and it is never stored as "this policy does not exist".
 */
export function isForbiddenRead(error: unknown): boolean {
    return getErrorStatusCode(error) === 403;
}
