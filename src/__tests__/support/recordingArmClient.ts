import { createArmClient, type ArmClient } from "@/utils/armClient";
import { RateLimiter } from "@/utils/rateLimiter";

/**
 * A fake `fetch` behind the real ARM client, for service tests. It records every request (method, path, api-version,
 * query, headers) and answers from a list of responders. Nothing ever reaches ARM: an unanswered request gets a 404 in
 * the ARM error envelope, so a missing fixture shows up as a failing test. Each client gets its own limiter, so tests
 * never share the `armRateLimiter` state.
 */

export interface RecordedArmRequest {
    method: string;
    /** The full URL as sent, for golden URL tests */
    url: string;
    /** The path without the query string */
    path: string;
    apiVersion: string | null;
    /** Decoded query parameters other than api-version, keys as sent (`$filter`) */
    query: Record<string, string>;
    headers: Record<string, string>;
}

export interface ArmFixture {
    status?: number;
    body?: unknown;
    headers?: Record<string, string>;
}

export interface ArmResponder {
    /** A regular expression on the path, or a predicate over the whole request */
    match: RegExp | ((request: RecordedArmRequest) => boolean);
    respond: (request: RecordedArmRequest) => ArmFixture;
}

export interface RecordingArmClient {
    client: ArmClient;
    fetch: typeof fetch;
    limiter: RateLimiter;
    requests: RecordedArmRequest[];
    /** Responders added later win over earlier ones */
    on(responder: ArmResponder): void;
}

/** An ARM error answer in the `{ error: { code, message } }` envelope */
export function armError(status: number, code: string, message = code, headers?: Record<string, string>): ArmFixture {
    return { status, body: { error: { code, message } }, headers };
}

function record(input: RequestInfo | URL, init?: RequestInit): RecordedArmRequest {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const parsed = new URL(url);
    const query: Record<string, string> = {};
    parsed.searchParams.forEach((value, key) => {
        if (key !== "api-version") query[key] = value;
    });
    return {
        method: init?.method ?? "GET",
        url,
        path: parsed.pathname,
        apiVersion: parsed.searchParams.get("api-version"),
        query,
        headers: { ...((init?.headers as Record<string, string> | undefined) ?? {}) },
    };
}

export function createRecordingArmClient(
    responders: ArmResponder[] = [],
    options: { limiter?: RateLimiter; token?: string } = {}
): RecordingArmClient {
    const requests: RecordedArmRequest[] = [];
    const list = [...responders];
    const limiter = options.limiter ?? new RateLimiter(200, 10_000);

    function answer(request: RecordedArmRequest): ArmFixture {
        for (let i = list.length - 1; i >= 0; i--) {
            const responder = list[i];
            const hit = responder.match instanceof RegExp ? responder.match.test(request.path) : responder.match(request);
            if (hit) return responder.respond(request);
        }
        return armError(404, "NotFound", `No fixture for ${request.method} ${request.path}`);
    }

    const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = record(input, init);
        requests.push(request);
        const fixture = answer(request);
        return new Response(fixture.body === undefined ? null : JSON.stringify(fixture.body), {
            status: fixture.status ?? 200,
            headers: { "Content-Type": "application/json", ...(fixture.headers ?? {}) },
        });
    }) as typeof fetch;

    return {
        client: createArmClient(async () => options.token ?? "test-token", { fetchImpl: fakeFetch, limiter }),
        fetch: fakeFetch,
        limiter,
        requests,
        on: (responder) => { list.push(responder); },
    };
}
