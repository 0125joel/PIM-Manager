import { Client, CustomAuthenticationProvider, MiddlewareFactory, type Context, type Middleware } from "@microsoft/microsoft-graph-client";
import { graphRateLimiter, type RateLimiter } from "./rateLimiter";

const DEFAULT_PAUSE_MS = 10_000;
const MAX_PAUSE_MS = 60_000;

/** Seconds or an HTTP date from a Retry-After header, as milliseconds; null when absent or invalid. */
export function parseRetryAfterMs(value: string | null | undefined, now: number = Date.now()): number | null {
    if (!value) return null;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_PAUSE_MS);
    const date = Date.parse(value);
    return Number.isNaN(date) ? null : Math.min(Math.max(0, date - now), MAX_PAUSE_MS);
}

/**
 * Sits in front of the network call, behind the SDK's own retry handler, so it sees every raw response, including the
 * 429 the SDK retries by itself. Each one pauses the shared limiter, so every worker waits for the Retry-After
 * instead of the pool sending more requests while the tenant is throttling.
 */
export class ThrottleWatcher implements Middleware {
    private nextMiddleware?: Middleware;

    constructor(private readonly limiter: RateLimiter = graphRateLimiter) {}

    async execute(context: Context): Promise<void> {
        await this.nextMiddleware?.execute(context);
        if (context.response?.status === 429) {
            this.limiter.backOff(parseRetryAfterMs(context.response.headers.get("Retry-After")) ?? DEFAULT_PAUSE_MS);
        }
    }

    setNext(middleware: Middleware): void {
        this.nextMiddleware = middleware;
    }
}

/** The default Graph SDK chain plus a `ThrottleWatcher` in front of the network call. */
export function createGraphClient(accessToken: string): Client {
    const authProvider = new CustomAuthenticationProvider((done) => done(null, accessToken));
    const chain = MiddlewareFactory.getDefaultMiddlewareChain(authProvider);
    // The last handler is the one that calls fetch
    chain.splice(chain.length - 1, 0, new ThrottleWatcher());
    return Client.initWithMiddleware({ middleware: chain });
}
