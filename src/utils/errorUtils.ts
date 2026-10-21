/**
 * Small helpers for working with caught values in `catch (error: unknown)` blocks.
 * They avoid `any` casts and keep the message extraction in one place.
 */

export function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    if (error && typeof error === "object" && "message" in error) {
        const message = (error as { message?: unknown }).message;
        if (typeof message === "string") return message;
    }
    return String(error);
}

export function getErrorName(error: unknown): string | undefined {
    if (error instanceof Error) return error.name;
    if (error && typeof error === "object" && "name" in error) {
        const name = (error as { name?: unknown }).name;
        if (typeof name === "string") return name;
    }
    return undefined;
}

export function getErrorStatusCode(error: unknown): number | undefined {
    if (error && typeof error === "object") {
        const candidate = (error as { statusCode?: unknown; status?: unknown });
        if (typeof candidate.statusCode === "number") return candidate.statusCode;
        if (typeof candidate.status === "number") return candidate.status;
    }
    return undefined;
}

export function isAbortError(error: unknown): boolean {
    return getErrorName(error) === "AbortError";
}

export function getErrorCode(error: unknown): string | undefined {
    if (error && typeof error === "object" && "code" in error) {
        const code = (error as { code?: unknown }).code;
        if (typeof code === "string") return code;
    }
    return undefined;
}

/**
 * One sentence for a failed block (spec 4.7): the status code, and "after 3 tries" only where `withRetry` really retried
 * (429 and 5xx). Without a status code a short plain message is used; MSAL documentation links and long dumps are not.
 */
export function describeLoadFailure(error: unknown): string {
    const status = getErrorStatusCode(error);
    if (status !== undefined) {
        return status === 429 || status >= 500 ? `Microsoft Graph answered ${status} after 3 tries.` : `Microsoft Graph answered ${status}.`;
    }
    const message = getErrorMessage(error).trim();
    if (message.length > 0 && message.length <= 140 && !/https?:\/\//.test(message) && !message.includes("{")) {
        return message.endsWith(".") ? message : `${message}.`;
    }
    return "Microsoft Graph did not answer.";
}
