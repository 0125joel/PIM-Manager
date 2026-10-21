import { DEMO_ACCOUNT } from "@/demo/contoso/account";
import { demoGuid } from "@/demo/contoso/ids";
import type { Change } from "@/types/configure.types";
import { HISTORY_STORAGE_PREFIX, type HistoryEntry } from "@/utils/configureHistory";
import { changeId } from "@/utils/configureBasket";

// Ids spelled out here, not imported from tenant.ts: this file is read by the boot of every page and must not pull the
// 136 built-in roles into the main bundle (a test checks they equal the tenant's)
export const HISTORY_ROLE = { exchangeAdmin: "29232cdf-9323-42fd-ade2-1d097af3e4de", reportsReader: "4a5d8f65-41da-4de4-8968-e035b65339cf" } as const;
const PEOPLE = {
    allan: { id: demoGuid("user:AllanD"), displayName: "Allan Deyoung", userPrincipalName: "AllanD@contoso.com" },
    grady: { id: demoGuid("user:GradyA"), displayName: "Grady Archie", userPrincipalName: "GradyA@contoso.com" },
};
const ROLE = HISTORY_ROLE;

/**
 * The Last applies of the demo (spec 19): one apply of yesterday, so the start page shows its line and Undo this apply
 * can be tried (the review it opens runs on the Contoso data; nothing can be written, every write is locked). A setting of
 * Exchange Administrator (the tenant is in the state after the apply: 8 hours, Allan eligible, Grady no longer on Reports Reader),
 * one new eligible assignment and one removal, all done, with a snapshot of schema version 1.
 */
export function buildDemoHistoryEntry(now: Date): HistoryEntry {
    const at = new Date(now.getTime() - 20 * 3_600_000);
    const allan = PEOPLE.allan;
    const person = (u: typeof allan) => ({ id: u.id, kind: "user" as const, displayName: u.displayName, userPrincipalName: u.userPrincipalName });
    const source = { from: "edit" as const };
    const changes: Change[] = [
        { kind: "setting", target: { kind: "role", id: ROLE.exchangeAdmin }, field: "maxActivationDuration", from: "PT4H", to: "PT8H", source },
        { kind: "add", target: { kind: "role", id: ROLE.exchangeAdmin }, principal: person(allan), type: "eligible", scope: "/", start: null, end: new Date(now.getTime() + 45 * 86_400_000).toISOString(), justification: "", source },
        { kind: "remove", target: { kind: "role", id: ROLE.reportsReader }, schedule: { principal: person(PEOPLE.grady), type: "eligible", scope: "/", end: null }, source },
    ];
    return {
        runId: "demo-apply-1",
        at: at.toISOString(),
        by: DEMO_ACCOUNT.displayName,
        changes,
        results: Object.fromEntries(changes.map((c) => [changeId(c), { status: "done" as const }])),
        targetCount: 3,
        snapshot: {
            schemaVersion: 1,
            app: { name: "PIM Manager", version: "demo" },
            tenant: { id: DEMO_ACCOUNT.tenantId, displayName: "Contoso" },
            readAt: {},
            exportedAt: at.toISOString(),
            workloads: ["directoryRoles"],
            lists: { authenticationContexts: [], customExtensions: [] },
        },
    };
}

/** The localStorage seed of the demo tab: the history of the tenant */
export function demoHistorySeed(now: Date): Record<string, string> {
    return { [HISTORY_STORAGE_PREFIX + DEMO_ACCOUNT.tenantId]: JSON.stringify({ version: 1, entries: [buildDemoHistoryEntry(now)] }) };
}
