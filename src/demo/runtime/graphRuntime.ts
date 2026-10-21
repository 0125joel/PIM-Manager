import { buildContosoTenant } from "@/demo/contoso/tenant";
import { createFakeGraph, type FakeGraph } from "@/demo/graph/server";
import { Logger } from "@/utils/logger";

/** Loaded on the first Graph request of a demo tab: the Contoso tenant, dated from now, behind the fake Graph */
export function createDemoGraph(): FakeGraph {
    return createFakeGraph(buildContosoTenant(new Date()), {
        onUnhandled: (request) => Logger.warn("Demo", `The demo has no answer for ${request.method} ${request.url}; add it to src/demo/graph/server.ts`),
    });
}
