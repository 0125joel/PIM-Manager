import type { Client } from "@microsoft/microsoft-graph-client";

/**
 * A fake Graph `Client` for write-path tests. It records every request the services send (method, version, path, query,
 * body) and answers reads from a list of responders. Writes answer `{}` unless a responder says otherwise. Nothing ever
 * reaches a tenant: an unanswered read throws a 404 so a missing fixture shows up as a failing test.
 */

export type RecordedMethod = "GET" | "PATCH" | "POST" | "PUT" | "DELETE";

export interface RecordedQuery {
    filter?: string;
    select?: string;
    expand?: string;
    top?: number;
    [key: string]: string | number | undefined;
}

export interface RecordedRequest {
    method: RecordedMethod;
    /** The version the call chose with `.version()`, or the client's default ("v1.0") */
    version: string;
    /** The path without the query string */
    path: string;
    query: RecordedQuery;
    headers: Record<string, string>;
    body?: unknown;
}

export interface Responder {
    method?: RecordedMethod;
    /** A regular expression on the path, or a predicate over the whole request */
    match: RegExp | ((request: RecordedRequest) => boolean);
    /** The answer; throw to answer with an error (see `graphError`) */
    respond: (request: RecordedRequest) => unknown;
}

export interface RecordingClient {
    client: Client;
    requests: RecordedRequest[];
    /** Only the writes (PATCH, POST, PUT, DELETE), in order */
    writes(): RecordedRequest[];
    /** Responders added later win over earlier ones */
    on(responder: Responder): void;
}

/** An error shaped like the one the Graph SDK throws (`statusCode`, `code`, `body`) */
export function graphError(statusCode: number, code: string, message = code, headers?: Record<string, string>): Error {
    return Object.assign(new Error(message), {
        statusCode,
        code,
        body: JSON.stringify({ error: { code, message } }),
        ...(headers ? { responseHeaders: headers } : {}),
    });
}

function splitUrl(url: string): { path: string; query: RecordedQuery } {
    const query: RecordedQuery = {};
    const at = url.indexOf("?");
    if (at < 0) return { path: url, query };
    const path = url.slice(0, at);
    for (const part of url.slice(at + 1).split("&")) {
        if (!part) continue;
        const eq = part.indexOf("=");
        const rawKey = eq < 0 ? part : part.slice(0, eq);
        const rawValue = eq < 0 ? "" : part.slice(eq + 1);
        const key = decodeURIComponent(rawKey).replace(/^\$/, "");
        query[key] = decodeURIComponent(rawValue.replace(/\+/g, " "));
    }
    return { path, query };
}

export function createRecordingClient(responders: Responder[] = []): RecordingClient {
    const requests: RecordedRequest[] = [];
    const list = [...responders];

    function answer(request: RecordedRequest): unknown {
        for (let i = list.length - 1; i >= 0; i--) {
            const responder = list[i];
            if (responder.method && responder.method !== request.method) continue;
            const hit = responder.match instanceof RegExp ? responder.match.test(request.path) : responder.match(request);
            if (hit) return responder.respond(request);
        }
        if (request.method === "GET") throw graphError(404, "NotFound", `No fixture for GET ${request.path}`);
        return {};
    }

    const client = {
        api(url: string) {
            const { path, query } = splitUrl(url);
            const state = { version: "v1.0", query: { ...query } as RecordedQuery, headers: {} as Record<string, string> };
            const send = async (method: RecordedMethod, body?: unknown) => {
                const request: RecordedRequest = {
                    method,
                    version: state.version,
                    path,
                    query: { ...state.query },
                    headers: { ...state.headers },
                    ...(body === undefined ? {} : { body: JSON.parse(JSON.stringify(body)) }),
                };
                requests.push(request);
                return answer(request);
            };
            const chain = {
                version(v: string) { state.version = v; return chain; },
                header(name: string, value: string) { state.headers[name] = value; return chain; },
                headers(all: Record<string, string>) { Object.assign(state.headers, all); return chain; },
                filter(f: string) { state.query.filter = f; return chain; },
                select(s: string | string[]) { state.query.select = Array.isArray(s) ? s.join(",") : s; return chain; },
                expand(e: string | string[]) { state.query.expand = Array.isArray(e) ? e.join(",") : e; return chain; },
                top(n: number) { state.query.top = n; return chain; },
                orderby(o: string) { state.query.orderby = o; return chain; },
                count(c: boolean) { state.query.count = String(c); return chain; },
                search(s: string) { state.query.search = s; return chain; },
                query(q: Record<string, string>) { Object.assign(state.query, q); return chain; },
                get: () => send("GET"),
                patch: (body: unknown) => send("PATCH", body),
                post: (body: unknown) => send("POST", body),
                put: (body: unknown) => send("PUT", body),
                delete: () => send("DELETE"),
            };
            return chain;
        },
    } as unknown as Client;

    return {
        client,
        requests,
        writes: () => requests.filter((r) => r.method !== "GET"),
        on: (responder) => { list.push(responder); },
    };
}
