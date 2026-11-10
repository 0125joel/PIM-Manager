import { DEMO_ACCOUNT, DEMO_HOME_ACCOUNT_ID } from "@/demo/contoso/account";
import { demoHistorySeed } from "@/demo/contoso/history";
import { demoGuid } from "@/demo/contoso/ids";
import { azureEnabledKey } from "@/utils/azureConsent";
import { emergencyStorageKey } from "@/utils/emergencyAccounts";
import { Logger } from "@/utils/logger";
import { createDemoFetch } from "./fetch";
import { isDemoSession } from "./session";
import { installDemoStorage } from "./storage";

/**
 * Runs when the app's provider tree is first imported, before anything renders or reads storage. In a demo tab it gives
 * the page its own storage (seeded with what a configured Contoso session has: PIM for Groups and Azure switched on,
 * write consent, the two marked emergency access accounts) and its own `fetch` (Graph and ARM answered in the tab, each
 * fake and its Contoso data loaded on its first request). In any other tab it does nothing.
 */

/** True for the lifetime of this page: a tab enters or leaves the demo only with a full page load */
export const IS_DEMO = isDemoSession();

if (IS_DEMO) {
    installDemoStorage({
        pim_workload_enabled_pimGroups: "true",
        pim_write_consent_directoryRoles: "true",
        pim_write_consent_pimGroups: "true",
        // Azure is switched on, so the Azure pages load the Contoso tree from the fake ARM
        [azureEnabledKey({ homeAccountId: DEMO_HOME_ACCOUNT_ID })]: "true",
        // Last applies on the start page of Configure: one apply of yesterday, Undo can be tried
        ...demoHistorySeed(new Date()),
        [emergencyStorageKey(DEMO_ACCOUNT.tenantId)]: JSON.stringify({
            version: 1,
            accounts: [
                { id: demoGuid("user:bg01"), displayName: "Break Glass 01", userPrincipalName: "bg01@contoso.onmicrosoft.com" },
                { id: demoGuid("user:bg02"), displayName: "Break Glass 02", userPrincipalName: "bg02@contoso.onmicrosoft.com" },
            ],
        }),
    });

    const realFetch = window.fetch.bind(window);
    let graph: ReturnType<typeof loadGraph> | null = null;
    function loadGraph() {
        return import("./graphRuntime").then((m) => m.createDemoGraph());
    }
    let arm: ReturnType<typeof loadArm> | null = null;
    function loadArm() {
        return Promise.all([import("@/demo/arm/server"), import("@/demo/contoso/azure")]).then(([server, contoso]) =>
            server.createFakeArm(contoso.buildContosoAzure(new Date()), {
                onUnhandled: (request) => Logger.warn("Demo", `The demo has no answer for ${request.method} ${request.url}; add it to src/demo/arm/server.ts`),
            }),
        );
    }
    window.fetch = createDemoFetch({
        realFetch,
        graph: () => (graph ??= loadGraph()),
        arm: () => (arm ??= loadArm()),
        catalog: () => import("@/config/accessModel/eam-catalog.json").then((m) => m.default),
        // A Graph or ARM answer takes 60 to 220 ms, so the loading states of the real app show as they do with a tenant
        latency: () => 60 + Math.round(Math.random() * 160),
    });
}
