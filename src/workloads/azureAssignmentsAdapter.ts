import { ArmError, type ArmClient } from "@/utils/armClient";
import { mapArmError } from "@/utils/armErrorMapping";
import type { AccountInfo } from "@azure/msal-browser";
import type { ArmEntity, ArmRoleScheduleInstance, ArmSubscription, AzureAssignment, AzureScope } from "@/types/azureResource.types";
import { listEntities, listResourceGroups, listResources, listSubscriptions } from "@/services/azureScopeService";
import { listAssignmentInstances, listAssignmentInstancesAt, listEligibilitySchedules, listEligibilitySchedulesAt } from "@/services/azureAssignmentService";
import { AZURE_ENABLED_PREFIX, azureEnabledKey } from "@/utils/azureConsent";
import { buildScopeTree, isCurrentSchedule, toAssignment, topReadableScopes } from "@/utils/azureScopes";
import { AZURE_READ_BELOW_BUDGET, countUnread, createRequestBudget, mergeBelowRound, planBelowListing, planBelowReading, unreadTargets, withBelowState, type BelowItem, type BelowSettled, type BelowTarget } from "@/utils/azureReadBelow";
import { getErrorStatusCode } from "@/utils/errorUtils";
import { Logger } from "@/utils/logger";
import { armRateLimiter } from "@/utils/rateLimiter";
import { runWorkerPool } from "@/utils/workerPool";
import { createSessionCache } from "./cache";
import type { WorkloadAdapter, WorkloadContent } from "./types";

/** The scope tree is saved next to the assignments */
export interface AzureExtras {
    scopes: AzureScope[];
}

export type AzureContent = WorkloadContent<AzureAssignment, AzureExtras>;

export const AZURE_INITIAL_EXTRAS: AzureExtras = { scopes: [] };

/** Azure spec 5: 4 workers, 250 ms apart; every item reads two lists together (instances, or groups and resources), so it costs 2 */
const WORKERS = 4;
const DELAY_MS = 250;
const COST_PER_ITEM = 2;

// No minimal cache: one without assignments would show as an empty tenant, so on a quota error nothing is stored and the
// next visit loads again (Azure spec 5)
// v2: the assignments carry `startDateTime` and `isViaGroup` (export like the Entra Report, 2026-10-24)
export const AZURE_DATA_KEY = "pim_azure_assignments_v2";
const TIMESTAMP_KEY = "pim_azure_assignments_timestamp";
const SCOPES_KEY = "pim_azure_scopes_v1";

/** The account the cache belongs to (2026-10 audit run 3): without it, a second account in the same tab saw the first one's data */
export const AZURE_OWNER_KEY = "pim_azure_owner_v1";

/** The short hash of the account (the one in the Azure flag key), never a readable id; null without an account */
export function azureCacheOwner(account: Pick<AccountInfo, "homeAccountId"> | null | undefined): string | null {
    return account ? azureEnabledKey(account).slice(AZURE_ENABLED_PREFIX.length) : null;
}

/**
 * The data format did not change, so the keys keep their version: a cache written before the binding has no owner and
 * is removed on its first read (`createSessionCache`).
 */
function createAzureCache(owner: () => string | null) {
    return createSessionCache<AzureAssignment, AzureExtras>(
        {
            dataKey: AZURE_DATA_KEY,
            timestampKey: TIMESTAMP_KEY,
            extras: {
                key: SCOPES_KEY,
                encode: (extras) => extras.scopes,
                decode: (raw) => ({ scopes: Array.isArray(raw) ? (raw as AzureScope[]) : [] }),
            },
            owner: { key: AZURE_OWNER_KEY, current: owner },
            label: "Azure",
        },
        AZURE_INITIAL_EXTRAS
    );
}

/** 403 or 404: the user cannot read the scope, or it is gone. It is left out without a message; the rest loads. */
function isUnreadable(error: unknown): boolean {
    const status = getErrorStatusCode(error);
    return status === 403 || status === 404;
}

/**
 * 400 `InsufficientPermissions`: ARM gives it at a subscription the user holds a role below but not on, and the
 * subscription is in `GET /subscriptions` all the same (measured 2026-10-19, tenant test T4). Such a subscription is
 * filled from the resource groups and resources the user can read (Azure spec 15.5).
 */
function isRefused(error: unknown): boolean {
    return getErrorStatusCode(error) === 400 && error instanceof ArmError && error.code === "InsufficientPermissions";
}

/** The eligibility schedules that hold now: the schedule list also returns future-dated and ended items */
const currentOnly = (schedules: ArmRoleScheduleInstance[]) => schedules.filter((s) => isCurrentSchedule(s, Date.now()));

const plural = (n: number, word: string) => `${n} ${n === 1 ? word : `${word}s`}`;

/** What a round left to read in a subscription, kept on its scope until the next round */
type UnreadState = Pick<BelowSettled, "unreadScopeIds" | "isUnlisted">;

/** The content shown: every subscription read as a whole, and the refused ones still in `access`, with their state on the scope */
function contentOf(subscriptions: ArmSubscription[], instancesBySubscription: Record<string, ArmRoleScheduleInstance[]>, access: ReadonlyMap<string, NonNullable<AzureScope["access"]>>, unread: ReadonlyMap<string, UnreadState>, entities?: ArmEntity[]): AzureContent {
    const shown = subscriptions.filter((s) => instancesBySubscription[s.subscriptionId] !== undefined || access.has(s.subscriptionId));
    const byPath = new Map(shown.flatMap((s) => {
        const state = access.get(s.subscriptionId);
        return state ? [[s.id.toLowerCase(), { state, unread: unread.get(s.subscriptionId) ?? { unreadScopeIds: [], isUnlisted: false } }] as const] : [];
    }));
    const scopes = buildScopeTree(shown, instancesBySubscription, entities).map((scope) => {
        const below = scope.level === "subscription" ? byPath.get(scope.id.toLowerCase()) : undefined;
        return below ? withBelowState(scope, below.state, below.unread) : scope;
    });
    return { data: toAssignments(instancesBySubscription), extras: { scopes } };
}

interface BelowReport {
    progress: (current: number, total: number) => void;
    /** A subscription is done: what was read below it and what is left for a later round */
    settled: (outcome: BelowSettled) => void;
}

/**
 * One round below the refused subscriptions (Azure spec 15.5), within `budget` ARM requests: per subscription that is
 * not listed yet its readable resource groups and resources, then per top readable scope its active instances and
 * eligibility schedules, in order, until the budget is spent (`utils/azureReadBelow.ts`). It stops without an error;
 * what it did not reach is in the settled outcome (`unreadScopeIds`, `isUnlisted`). A 403, 404 or 400
 * `InsufficientPermissions` on the way is "not readable" and counts as read. A subscription is reported once, when all
 * its reads of the round are done; an abort throws and reports nothing more, so a subscription that was cut short
 * keeps what it had.
 */
async function readBelowRound(client: ArmClient, signal: AbortSignal, targets: BelowTarget[], budgetTotal: number, report: BelowReport): Promise<void> {
    const budget = createRequestBudget(budgetTotal);
    const listing = planBelowListing(targets, budget);
    const listed = new Map<string, string[]>();
    const failed = new Set<string>();
    if (listing.toList.length > 0) {
        const pool = await runWorkerPool<string, string[]>({
            items: listing.toList,
            workerCount: WORKERS,
            delayMs: DELAY_MS,
            signal,
            rateLimiter: armRateLimiter,
            costPerItem: COST_PER_ITEM,
            // An ARM message can hold the UPN, object id and scope: log status and code only
            errorLog: "statusAndCode",
            processor: async (subscriptionId) => {
                try {
                    const [groups, resources] = await Promise.all([
                        listResourceGroups(client, subscriptionId, signal),
                        listResources(client, subscriptionId, signal),
                    ]);
                    return topReadableScopes(groups, resources);
                } catch (error: unknown) {
                    if (isUnreadable(error) || isRefused(error)) return [];
                    throw error;
                }
            },
            onItemComplete: (subscriptionId, scopes) => listed.set(subscriptionId, scopes),
            onItemError: (subscriptionId) => failed.add(subscriptionId),
        });
        if (pool.aborted || signal.aborted) throw new Error("Aborted");
    }

    const unlisted = new Set(listing.unlisted);
    const toRead = targets
        .filter((t) => !failed.has(t.subscriptionId) && !unlisted.has(t.subscriptionId))
        .map((t) => ({ subscriptionId: t.subscriptionId, scopeIds: t.scopeIds ?? listed.get(t.subscriptionId) ?? [] }));
    const plan = planBelowReading(toRead, budget);
    if (plan.unread.size > 0 || unlisted.size > 0) Logger.info("Azure", `The read budget of ${budgetTotal} requests is spent; ${plan.unread.size + unlisted.size} subscriptions keep scopes for Read the rest`);

    const remaining = new Map<string, number>();
    for (const item of plan.items) remaining.set(item.subscriptionId, (remaining.get(item.subscriptionId) ?? 0) + 1);
    const found = new Map<string, ArmRoleScheduleInstance[]>();
    const settle = (subscriptionId: string) => report.settled({
        subscriptionId,
        instances: found.get(subscriptionId) ?? [],
        failed: failed.has(subscriptionId),
        unreadScopeIds: plan.unread.get(subscriptionId) ?? [],
        isUnlisted: unlisted.has(subscriptionId),
    });
    // Nothing to read in this round (failed, unlisted, nothing readable, or the budget reached none of it): done now
    for (const target of targets) {
        if (!remaining.has(target.subscriptionId)) settle(target.subscriptionId);
    }

    const done = (subscriptionId: string) => {
        const left = (remaining.get(subscriptionId) ?? 1) - 1;
        remaining.set(subscriptionId, left);
        if (left <= 0) settle(subscriptionId);
    };
    if (plan.items.length === 0) return;
    const reading = await runWorkerPool<BelowItem, ArmRoleScheduleInstance[]>({
        items: plan.items,
        workerCount: WORKERS,
        delayMs: DELAY_MS,
        signal,
        rateLimiter: armRateLimiter,
        costPerItem: COST_PER_ITEM,
        // An ARM message can hold the UPN, object id and scope: log status and code only
        errorLog: "statusAndCode",
        processor: async ({ scopeId }) => {
            try {
                const [active, eligible] = await Promise.all([
                    listAssignmentInstancesAt(client, scopeId, signal),
                    listEligibilitySchedulesAt(client, scopeId, signal),
                ]);
                return [...active, ...currentOnly(eligible)];
            } catch (error: unknown) {
                if (isUnreadable(error) || isRefused(error)) return [];
                throw error;
            }
        },
        onItemComplete: (item, instances) => {
            if (signal.aborted) return;
            const list = found.get(item.subscriptionId);
            if (list) list.push(...instances);
            else found.set(item.subscriptionId, [...instances]);
            done(item.subscriptionId);
        },
        onItemError: (item) => {
            if (signal.aborted) return;
            Logger.warn("Azure", "A scope below a subscription could not be read");
            failed.add(item.subscriptionId);
            done(item.subscriptionId);
        },
        onProgress: report.progress,
    });
    if (reading.aborted || signal.aborted) throw new Error("Aborted");
}

/** One row per instance: an item inherited from above comes back from every subscription below it, with the same id */
export function toAssignments(instancesBySubscription: Record<string, ArmRoleScheduleInstance[]>): AzureAssignment[] {
    const seen = new Map<string, AzureAssignment>();
    for (const items of Object.values(instancesBySubscription)) {
        for (const item of items) {
            const key = item.id.toLowerCase();
            if (!seen.has(key)) seen.set(key, toAssignment(item));
        }
    }
    return [...seen.values()];
}

/**
 * PIM for Azure resources (Azure spec 5). ARM has no delta for these lists, so every run reads all of it: the
 * subscriptions the user can read, then per subscription the active instances and the eligibility schedules (the
 * instance list leaves out a custom role not assignable at the subscription, see azureAssignmentService), unfiltered (the items at
 * it, below it and inherited from above). A subscription refused at its own level is read from its readable resource
 * groups and resources in the background phase (Azure spec 15.5), within a budget of ARM requests; what the budget did
 * not reach is kept on the subscription and read by `resume` (Read the rest). The tree is built from what came back; it
 * shows what is visible, never totals.
 */
export function createAzureAssignmentsAdapter(owner: () => string | null, options: AzureAdapterOptions = {}): WorkloadAdapter<AzureAssignment, AzureExtras, ArmClient> {
    return buildAzureAdapter(createAzureCache(owner), options);
}

export interface AzureAdapterOptions {
    /**
     * ARM requests one round below the refused subscriptions may use; default `AZURE_READ_BELOW_BUDGET`. Passed, never
     * global, so a test or a fixture can show a budget that runs out.
     */
    belowBudget?: number;
}

const RESUME_MESSAGE = "Reading the rest of the resource groups and resources you can read...";

function buildAzureAdapter(cache: WorkloadAdapter<AzureAssignment, AzureExtras, ArmClient>["cache"], options: AzureAdapterOptions): WorkloadAdapter<AzureAssignment, AzureExtras, ArmClient> {
    const budget = options.belowBudget ?? AZURE_READ_BELOW_BUDGET;
    return {
        id: "azureResources",
        initialExtras: AZURE_INITIAL_EXTRAS,
        cache,

        // ARM words, not Graph's (Azure spec 7): "No access to this scope. Your Azure role at this scope does not allow this."
        describeFailure(error) {
            const text = mapArmError(error);
            return `${text.title}. ${text.detail}`;
        },

        begin(current, force) {
            const again = !force && current.data.length > 0;
            return { blocking: true, message: again ? "Refreshing Azure role assignments..." : "Loading Azure role assignments..." };
        },

        async run(ctx) {
            const { client, signal } = ctx;
            ctx.message("Loading Azure subscriptions...");
            const subscriptions = await listSubscriptions(client, signal);
            // The management group hierarchy: when it cannot be read (403, 400, 404, network) or is empty, the tree stays flat
            let entities: ArmEntity[] | undefined;
            try {
                entities = await listEntities(client, signal);
            } catch (error: unknown) {
                if (signal.aborted) throw error;
                Logger.warn("Azure", "The management group hierarchy could not be read; the tree stays flat");
            }

            const instancesBySubscription: Record<string, ArmRoleScheduleInstance[]> = {};
            const refused = new Set<string>();
            // The last error per subscription: the pool retries a 429 itself, so only an error without a later success counts
            const lastError = new Map<string, unknown>();
            const pool = await runWorkerPool<ArmSubscription, ArmRoleScheduleInstance[]>({
                items: subscriptions,
                workerCount: WORKERS,
                delayMs: DELAY_MS,
                signal,
                rateLimiter: armRateLimiter,
                costPerItem: COST_PER_ITEM,
                // An ARM message can hold the UPN, object id and scope: log status and code only
                errorLog: "statusAndCode",
                processor: async (subscription) => {
                    try {
                        // Two fixed calls, read together (T5: about 2 s each one after the other)
                        const [active, eligible] = await Promise.all([
                            listAssignmentInstances(client, subscription.subscriptionId, signal),
                            listEligibilitySchedules(client, subscription.subscriptionId, signal),
                        ]);
                        lastError.delete(subscription.subscriptionId);
                        return [...active, ...currentOnly(eligible)];
                    } catch (error: unknown) {
                        if (isRefused(error)) {
                            Logger.info("Azure", "A subscription is readable only below its own level; its resource groups and resources are read");
                            lastError.delete(subscription.subscriptionId);
                            refused.add(subscription.subscriptionId);
                            return null;
                        }
                        if (isUnreadable(error)) {
                            Logger.info("Azure", `A subscription is not readable (${getErrorStatusCode(error)}); it is left out`);
                            lastError.delete(subscription.subscriptionId);
                            return null;
                        }
                        lastError.set(subscription.subscriptionId, error);
                        throw error;
                    }
                },
                onItemComplete: (subscription, items) => {
                    instancesBySubscription[subscription.subscriptionId] = items;
                },
                onProgress: (current, total) => ctx.progress(current, total, `Loading Azure role assignments: ${current} of ${total} subscriptions`),
            });
            if (pool.aborted || signal.aborted) throw new Error("Aborted");
            // A failed read fails the load, so the loaded data stays (src/services/AGENTS.md)
            if (lastError.size > 0) throw [...lastError.values()][0];

            const readable = subscriptions.filter((s) => instancesBySubscription[s.subscriptionId] !== undefined);
            const below = subscriptions.filter((s) => refused.has(s.subscriptionId));
            const access = new Map<string, NonNullable<AzureScope["access"]>>(below.map((s) => [s.subscriptionId, "loading"]));
            const unread = new Map<string, UnreadState>();
            const content = () => contentOf(subscriptions, instancesBySubscription, access, unread, entities);
            const loaded = (c: AzureContent) => {
                const count = c.extras.scopes.filter((s) => s.level === "subscription").length;
                return `Loaded ${c.data.length} Azure role assignments from ${plural(count, "subscription")}`;
            };
            if (below.length === 0) {
                const c = content();
                return { ...c, message: loaded(c) };
            }

            // A subscription done below: partial, failed, or dropped when nothing is readable below it and nothing is left
            const apply = (o: BelowSettled) => {
                const id = o.subscriptionId;
                const hasLeft = o.unreadScopeIds.length > 0 || o.isUnlisted;
                if (o.failed) {
                    access.set(id, "failed");
                    instancesBySubscription[id] = o.instances;
                } else if (o.instances.length === 0 && !hasLeft) {
                    access.delete(id);
                } else {
                    access.set(id, "partial");
                    instancesBySubscription[id] = o.instances;
                }
                if (hasLeft) unread.set(id, { unreadScopeIds: o.unreadScopeIds, isUnlisted: o.isUnlisted });
                else unread.delete(id);
            };
            const targets: BelowTarget[] = below.map((s) => ({ subscriptionId: s.subscriptionId, scopeIds: null }));
            const belowMessage = `Reading the resource groups and resources you can read in ${plural(below.length, "subscription")}...`;
            // Nothing readable as a whole: read below in the blocking phase, so the page does not show the empty state first
            if (readable.length === 0) {
                ctx.message(belowMessage);
                await readBelowRound(client, signal, targets, budget, {
                    progress: (current, total) => ctx.progress(current, total, `Loading Azure role assignments: ${current} of ${total} scopes`),
                    settled: apply,
                });
                const c = content();
                return { ...c, message: loaded(c) };
            }

            const c = content();
            return {
                ...c,
                message: loaded(c),
                background: readBelowRound(client, signal, targets, budget, {
                    progress: (current, total) => ctx.backgroundProgress(current, total),
                    settled: (o) => {
                        apply(o);
                        ctx.patch(() => content());
                    },
                }),
                backgroundMessage: belowMessage,
                backgroundTotal: below.length,
            };
        },

        /**
         * Read the rest: one more round with the same budget over what the last round left (`unreadScopeIds`, `isUnlisted`),
         * merged into what is loaded without duplicates (`mergeBelowRound`). The data stays on screen; nothing else is read again.
         */
        resume: {
            message: RESUME_MESSAGE,
            async run(ctx) {
                const current = ctx.current();
                const targets = unreadTargets(current.extras.scopes);
                const loadedMessage = `Loaded ${current.data.length} Azure role assignments`;
                if (targets.length === 0) return { ...current, message: loadedMessage };
                const { scopes: total } = countUnread(current.extras.scopes);
                return {
                    ...current,
                    message: loadedMessage,
                    background: readBelowRound(ctx.client, ctx.signal, targets, budget, {
                        progress: (done, all) => ctx.backgroundProgress(done, all),
                        settled: (o) => ctx.patch((c) => {
                            const merged = mergeBelowRound({ data: c.data, scopes: c.extras.scopes }, o);
                            return { data: merged.data, extras: { ...c.extras, scopes: merged.scopes } };
                        }),
                    }),
                    backgroundMessage: RESUME_MESSAGE,
                    backgroundTotal: total,
                };
            },
        },
    };
}

/**
 * The adapter without an account: its cache neither reads nor writes. The provider uses `createAzureAssignmentsAdapter`
 * with the signed-in account; this one is for the reads alone (`run`).
 */
export const azureAssignmentsAdapter: WorkloadAdapter<AzureAssignment, AzureExtras, ArmClient> = buildAzureAdapter(createAzureCache(() => null), {});
