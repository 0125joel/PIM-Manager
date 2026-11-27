import { getErrorCode, getErrorStatusCode } from "@/utils/errorUtils";

/**
 * Measured 2026-11-24 (dev tenant, Graph v1.0, not on Learn): `/users`, `/groups` and `/servicePrincipals` with
 * `$filter=id in ('<one id>')` answer 404 `Request_ResourceNotFound` when the collection has no object with that id.
 * With two or more values and no match they answer 200 with an empty list. So a 404 on a chunk of exactly one id
 * means "no match", not a failed read.
 */
export function isEmptySingleIdAnswer(error: unknown, valueCount: number): boolean {
    return valueCount === 1 && getErrorStatusCode(error) === 404 && getErrorCode(error) === "Request_ResourceNotFound";
}
