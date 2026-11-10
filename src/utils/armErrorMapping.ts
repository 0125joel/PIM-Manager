/**
 * ARM error mapper for the Azure pages.
 *
 * Turns an error from the ARM client into a short English title and detail for the screen. It never returns the raw
 * ARM message: ARM messages hold object ids and scope paths, which do not belong on screen.
 */
import { ARM_MAX_PAGES } from "./armClient";
import { getErrorCode, getErrorMessage, getErrorStatusCode, isAbortError } from "./errorUtils";

export interface ArmErrorText {
    title: string;
    detail: string;
}

const PAGE_CAP = new RegExp(`has more than ${ARM_MAX_PAGES} pages`);

/** Rules 3 to 8: matched on the code, whatever the status is */
const BY_CODE = new Map<string, ArmErrorText>([
    ["AuthorizationFailed", {
        title: "No access to this scope",
        detail: "Your Azure role at this scope does not allow this. If you were given a role just now, sign out and sign in again.",
    }],
    ["InsufficientPermissions", {
        title: "No access to this scope",
        detail: "Your Azure role at this scope does not allow this request.",
    }],
    ["ResourceGroupNotFound", {
        title: "Resource group not found",
        detail: "The resource group no longer exists or was moved. Refresh to load the current scopes.",
    }],
    ["ResourceNotFound", {
        title: "No role settings",
        detail: "No role settings for this role at this scope.",
    }],
    ["InvalidFilter", {
        title: "Request not supported",
        detail: "Azure Resource Manager rejected the filter of this request. This is a fault in PIM Manager; please report it.",
    }],
    ["InvalidResourceType", {
        title: "Request not supported",
        detail: "Azure Resource Manager does not support this request. This is a fault in PIM Manager; please report it.",
    }],
]);

const THROTTLED: ArmErrorText = {
    title: "Azure is limiting requests",
    detail: "Loading continues shortly.",
};

const GENERIC_TITLE = "Azure Resource Manager returned an error";

/** Turns an error from the ARM client into the title and detail to show; the raw message is never returned */
export function mapArmError(error: unknown): ArmErrorText {
    // 1. Cancelled by the user or by a page change
    if (isAbortError(error) || getErrorMessage(error) === "Aborted") {
        return { title: "Loading stopped", detail: "The request was cancelled." };
    }

    const status = getErrorStatusCode(error);
    const code = getErrorCode(error);

    // 2. The list was longer than the client loads (it throws without a status code)
    if (status === undefined && PAGE_CAP.test(getErrorMessage(error))) {
        return {
            title: "Too many results",
            detail: "This list is longer than PIM Manager can load at once (50 pages).",
        };
    }

    // 3 to 8. Matched on the code, whatever the status is
    const byCode = code !== undefined ? BY_CODE.get(code) : undefined;
    if (byCode) return byCode;

    // 9. Throttled, with any code
    if (status === 429) return THROTTLED;

    // 10. Azure itself is failing
    if (status !== undefined && status >= 500) {
        return {
            title: "Azure Resource Manager is not available",
            detail: `Azure answered ${status}. Try again in a few minutes.`,
        };
    }

    // 11. Another status with a known code
    if (status !== undefined && code !== undefined && code !== "Unknown") {
        return {
            title: GENERIC_TITLE,
            detail: `Azure answered ${status} (${code}).`,
        };
    }

    // 12. Another status without a usable code
    if (status !== undefined) {
        return { title: GENERIC_TITLE, detail: `Azure answered ${status}.` };
    }

    // 13. No status: what fetch throws when the network fails
    if (error instanceof TypeError) {
        return {
            title: "Azure Resource Manager could not be reached",
            detail: "Check the network connection and try again.",
        };
    }

    // 14. Anything else
    return { title: GENERIC_TITLE, detail: "Something went wrong while loading from Azure." };
}
