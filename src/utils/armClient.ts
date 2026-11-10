/**
 * Client for Azure Resource Manager (PIM for Azure resources). ARM is not Graph: its own token audience, its own
 * throttling and its own limiter (`armRateLimiter`), so nothing here goes through the Graph client.
 */

import { Logger } from './logger';
import { armRateLimiter, type RateLimiter } from './rateLimiter';
import { parseRetryAfterMs } from './graphClient';

export const ARM_BASE_URL = 'https://management.azure.com';
/** `getAll` stops with an error after this many pages: never a partial list */
export const ARM_MAX_PAGES = 50;
/** Pause after a 429 whose Retry-After the browser cannot read */
const DEFAULT_PAUSE_MS = 10_000;

/** Query parameters besides `api-version`; keys are sent as written (`$filter`), values are encoded */
export type ArmQuery = Record<string, string>;

export interface ArmRequestOptions {
    signal?: AbortSignal;
}

export interface ArmClient {
    /** One GET of a path below the ARM base, such as `/subscriptions` */
    get<T>(path: string, apiVersion: string, query?: ArmQuery, options?: ArmRequestOptions): Promise<T>;
    /** Every item of a list, following `nextLink` until it is absent */
    getAll<T>(path: string, apiVersion: string, query?: ArmQuery, options?: ArmRequestOptions): Promise<T[]>;
    /**
     * Like `getAll`, for a list that ARM serves with POST and no body (`getEntities`): the first page and every
     * `nextLink` page are fetched with POST. Only for a read that is a POST by design; the app has no write path.
     */
    postAll<T>(path: string, apiVersion: string, query?: ArmQuery, options?: ArmRequestOptions): Promise<T[]>;
}

export interface ArmClientOptions {
    fetchImpl?: typeof fetch;
    limiter?: RateLimiter;
}

/** A non-2xx answer from ARM, with the code and message of its `{ error: { code, message } }` envelope */
export class ArmError extends Error {
    readonly statusCode: number;
    readonly code: string;
    readonly headers: Headers;

    constructor(statusCode: number, code: string, message: string, headers: Headers) {
        super(message);
        this.name = 'ArmError';
        this.statusCode = statusCode;
        this.code = code;
        this.headers = headers;
    }
}

interface ArmPage<T> {
    value?: T[];
    nextLink?: string | null;
}

function buildUrl(path: string, apiVersion: string, query: ArmQuery = {}): string {
    if (!path.startsWith('/')) throw new Error(`ARM path must start with "/": ${path}`);
    const params = [`api-version=${encodeURIComponent(apiVersion)}`];
    for (const [key, value] of Object.entries(query)) params.push(`${key}=${encodeURIComponent(value)}`);
    return `${ARM_BASE_URL}${path}?${params.join('&')}`;
}

/** The token is only ever sent to the ARM host, also when a `nextLink` points somewhere else */
function assertArmUrl(url: string): void {
    let origin: string;
    try {
        origin = new URL(url).origin;
    } catch {
        throw new Error('ARM nextLink is not a valid URL');
    }
    if (origin !== ARM_BASE_URL) throw new Error(`ARM nextLink leaves ${ARM_BASE_URL}`);
}

async function toArmError(response: Response): Promise<ArmError> {
    let code = 'Unknown';
    let message = `ARM request failed with HTTP ${response.status}`;
    try {
        const body = (await response.json()) as { error?: { code?: unknown; message?: unknown } };
        if (typeof body?.error?.code === 'string') code = body.error.code;
        if (typeof body?.error?.message === 'string') message = body.error.message;
    } catch {
        // No JSON envelope: keep the status-based message
    }
    return new ArmError(response.status, code, message, response.headers);
}

/** The remaining-budget headers are exposed by CORS; they are logged, not used to steer the limiter */
function logRemaining(headers: Headers): void {
    const subscription = headers.get('x-ms-ratelimit-remaining-subscription-reads');
    const tenant = headers.get('x-ms-ratelimit-remaining-tenant-reads');
    if (subscription !== null || tenant !== null) {
        Logger.debug('ArmClient', `Remaining reads: subscription=${subscription ?? '-'}, tenant=${tenant ?? '-'}`);
    }
}

/**
 * `getToken` returns an access token for `https://management.azure.com/user_impersonation`. Callers wrap single calls
 * in `withRetry(..., armRateLimiter)`; this client does not retry by itself.
 */
export function createArmClient(getToken: () => Promise<string>, options: ArmClientOptions = {}): ArmClient {
    // Looked up per call, so a fetch routed later (the demo) is the one used
    const fetchImpl = options.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
    const limiter = options.limiter ?? armRateLimiter;

    async function request<T>(url: string, signal?: AbortSignal, method: 'GET' | 'POST' = 'GET'): Promise<T> {
        await limiter.acquire(1, signal);
        const token = await getToken();
        const response = await fetchImpl(url, {
            method,
            headers: { Authorization: `Bearer ${token}` },
            signal,
        });
        logRemaining(response.headers);
        if (response.status === 429) {
            // Every worker pauses, not only this caller
            limiter.backOff(parseRetryAfterMs(response.headers.get('Retry-After')) ?? DEFAULT_PAUSE_MS);
        }
        if (!response.ok) throw await toArmError(response);
        return (await response.json()) as T;
    }

    async function requestAll<T>(path: string, apiVersion: string, method: 'GET' | 'POST', query?: ArmQuery, requestOptions?: ArmRequestOptions): Promise<T[]> {
        const items: T[] = [];
        let url: string | null = buildUrl(path, apiVersion, query);
        for (let page = 0; url; page++) {
            if (page === ARM_MAX_PAGES) throw new Error(`ARM list ${path} has more than ${ARM_MAX_PAGES} pages`);
            const body: ArmPage<T> = await request<ArmPage<T>>(url, requestOptions?.signal, method);
            items.push(...(body.value ?? []));
            url = body.nextLink || null;
            if (url) assertArmUrl(url);
        }
        return items;
    }

    return {
        async get<T>(path: string, apiVersion: string, query?: ArmQuery, requestOptions?: ArmRequestOptions): Promise<T> {
            return request<T>(buildUrl(path, apiVersion, query), requestOptions?.signal);
        },

        async getAll<T>(path: string, apiVersion: string, query?: ArmQuery, requestOptions?: ArmRequestOptions): Promise<T[]> {
            return requestAll<T>(path, apiVersion, 'GET', query, requestOptions);
        },

        async postAll<T>(path: string, apiVersion: string, query?: ArmQuery, requestOptions?: ArmRequestOptions): Promise<T[]> {
            return requestAll<T>(path, apiVersion, 'POST', query, requestOptions);
        },
    };
}
