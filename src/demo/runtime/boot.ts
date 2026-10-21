import { DEMO_ACCOUNT } from "@/demo/contoso/account";
import { demoHistorySeed } from "@/demo/contoso/history";
import { demoGuid } from "@/demo/contoso/ids";
import { emergencyStorageKey } from "@/utils/emergencyAccounts";
import { createDemoFetch } from "./fetch";
import { isDemoSession } from "./session";
import { installDemoStorage } from "./storage";

/**
 * Runs when the app's provider tree is first imported, before anything renders or reads storage. In a demo tab it gives
 * the page its own storage (seeded with what a configured Contoso session has: PIM for Groups switched on, write consent,
 * the two marked emergency access accounts) and its own `fetch` (Graph answered in the tab, the fake Graph and the
 * Contoso data are loaded on the first request). In any other tab it does nothing.
 */

/** True for the lifetime of this page: a tab enters or leaves the demo only with a full page load */
export const IS_DEMO = isDemoSession();

if (IS_DEMO) {
    installDemoStorage({
        pim_workload_enabled_pimGroups: "true",
        pim_write_consent_directoryRoles: "true",
        pim_write_consent_pimGroups: "true",
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
    window.fetch = createDemoFetch({
        realFetch,
        graph: () => (graph ??= loadGraph()),
        catalog: () => import("@/config/accessModel/eam-catalog.json").then((m) => m.default),
        // A Graph answer takes 60 to 220 ms, so the loading states of the real app show as they do with a tenant
        latency: () => 60 + Math.round(Math.random() * 160),
    });
}
