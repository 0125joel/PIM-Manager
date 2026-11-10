import type { FakeArm } from "@/demo/arm/server";
import type { FakeGraph } from "@/demo/graph/server";
import { CATALOG_URL } from "@/utils/accessModelCatalog";

/**
 * The demo's `fetch`: requests to Microsoft Graph are answered by the fake Graph in this tab, requests to Azure Resource
 * Manager by the fake ARM, sign-in hosts are refused, the PIM Monitor catalog is answered with the copy that ships with
 * the app, everything else (the app's own files) goes to the network as usual. Nothing reaches a tenant.
 */

const GRAPH_HOST = "graph.microsoft.com";
const ARM_HOST = "management.azure.com";
const IDENTITY_HOSTS = new Set(["login.microsoftonline.com", "login.microsoft.com", "login.live.com"]);

export interface DemoFetchOptions {
    /** Resolves the fake Graph on the first Graph request (loaded on demand) */
    graph: () => Promise<FakeGraph>;
    /** Resolves the fake ARM on the first ARM request (loaded on demand). Without it, ARM requests are refused */
    arm?: () => Promise<FakeArm>;
    realFetch: typeof fetch;
    /** Delay per Graph or ARM request in milliseconds, so loading looks and behaves like the real thing */
    latency?: () => number;
    /** The bundled access model catalog (loaded on demand) */
    catalog?: () => Promise<unknown>;
}

export function isGraphUrl(url: string): boolean {
    try {
        return new URL(url).hostname === GRAPH_HOST;
    } catch {
        return false;
    }
}

type Fake = Pick<FakeGraph, "handle"> | Pick<FakeArm, "handle">;

export function createDemoFetch({ graph, arm, realFetch, latency, catalog }: DemoFetchOptions): typeof fetch {
    /** Answers a request from a fake backend, after the same delay and abort check for Graph and ARM */
    async function answer(request: Request, fake: () => Promise<Fake>, idHeaders: (request: Request) => Record<string, string>): Promise<Response> {
        const text = request.method === "GET" || request.method === "HEAD" ? "" : await request.text();
        let body: unknown = undefined;
        if (text) {
            try {
                body = JSON.parse(text);
            } catch {
                body = text;
            }
        }
        const backend = await fake();
        const delay = latency?.() ?? 0;
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
        if (request.signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");

        const response = backend.handle({ method: request.method, url: request.url, body });
        const isText = typeof response.body === "string";
        return new Response(isText ? (response.body as string) : JSON.stringify(response.body), {
            status: response.status,
            headers: { ...response.headers, ...idHeaders(request) },
        });
    }

    return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const request = new Request(input, init);
        const url = new URL(request.url);
        if (IDENTITY_HOSTS.has(url.hostname)) {
            throw new TypeError("Sign-in is not available in the demo environment.");
        }
        if (catalog && url.href === CATALOG_URL) {
            return new Response(JSON.stringify(await catalog()), { status: 200, headers: { "content-type": "application/json" } });
        }
        if (url.hostname === ARM_HOST) {
            // Never to the network, also when this tab has no fake ARM
            if (!arm) throw new TypeError("Azure Resource Manager is not available in the demo environment.");
            return answer(request, arm, () => ({ "x-ms-request-id": "demo" }));
        }
        if (url.hostname !== GRAPH_HOST) return realFetch(input, init);
        return answer(request, graph, (r) => ({ "request-id": "demo", "client-request-id": r.headers.get("client-request-id") ?? "demo" }));
    };
}
