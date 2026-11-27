import { demoGuid } from "./ids";

/**
 * The Log Analytics workspaces of the demo (AU-9): three, in subscriptions of the demo's Azure tree, plus one
 * subscription whose workspaces cannot be listed. Names and ids are invented. What each answers to a query:
 * `entra` holds the demo's audit log, `empty` has the table with no event yet, `denied` refuses the query (403), and
 * `activity` holds the Azure activity log and has no AuditLogs table at all.
 */
export type DemoWorkspaceBehavior = "entra" | "empty" | "denied" | "activity";

export interface DemoWorkspace {
    name: string;
    customerId: string;
    /** The subscription key of `azure.ts` (`azure:sub:{key}`) */
    subscription: "production" | "test" | "labs";
    location: string;
    retentionInDays: number;
    behavior: DemoWorkspaceBehavior;
    /** The Entra diagnostic settings send the audit log here */
    receivesEntra: boolean;
}

export const DEMO_WORKSPACES: readonly DemoWorkspace[] = [
    { name: "law-contoso-entra", customerId: demoGuid("law:entra"), subscription: "production", location: "westeurope", retentionInDays: 180, behavior: "entra", receivesEntra: true },
    { name: "law-contoso-sec", customerId: demoGuid("law:sec"), subscription: "production", location: "westeurope", retentionInDays: 90, behavior: "empty", receivesEntra: false },
    { name: "law-contoso-apps", customerId: demoGuid("law:apps"), subscription: "test", location: "northeurope", retentionInDays: 30, behavior: "denied", receivesEntra: false },
    { name: "law-contoso-activity", customerId: demoGuid("law:activity"), subscription: "production", location: "westeurope", retentionInDays: 365, behavior: "activity", receivesEntra: false },
];

/** The subscriptions that send their activity log to the `activity` workspace: the others do not, so the demo shows "2 of the 4" */
export const DEMO_ACTIVITY_SUBSCRIPTIONS = ["production", "test"] as const;

/** How many days back the `activity` workspace reaches */
export const DEMO_ACTIVITY_REACH_DAYS = 300;

/** The subscription whose workspace list answers 403 in the demo, so the Settings list names it */
export const DEMO_WORKSPACE_FAILING_SUBSCRIPTION = "corpapps" as const;
