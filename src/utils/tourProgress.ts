import type { TourDefinition, TourId, TourProduct, TourStep } from "@/config/onboarding";

/**
 * Which tours a reader has seen, and whether tours start by themselves (tour spec 4.2 to 4.8). Only tour ids, "on", "off",
 * "yes" and "no" are stored, in this browser; the demo keeps them in its own storage, which ends with the tab.
 */
export const TOURS_SEEN_KEY = "tours-seen";
export const TOURS_SETTING_KEY = "tours-setting";
export const TOURS_DEMO_KEY_PREFIX = "tours-demo-";
/** The keys of the 3.0 tour, removed by `initTourProgress` */
export const LEGACY_TOUR_KEYS = ["pim_onboarding_completed", "pim_highlights_seen_version"] as const;

export type TourSetting = "on" | "off";
export type DemoTourAnswer = "yes" | "no";
/** "complete" is Get started at the end; "stop" is Skip tour, Close, Escape or Turn off tours */
export type TourEnd = "complete" | "stop";

/** One step of a run: a step of a tour with the route and view it runs on */
export interface RunStep extends TourStep {
    /** Unique within a run: the tour id and the step id */
    key: string;
    tour: TourId;
    page: string;
    view?: "basic" | "advanced";
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const defaultStorage = (): StorageLike | null => (typeof localStorage === "undefined" ? null : localStorage);

const TOUR_ID = /^[a-z][a-z-]*$/;

export function parseSeenTours(value: string | null | undefined): string[] {
    if (!value) return [];
    try {
        const parsed: unknown = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string" && TOUR_ID.test(id)) : [];
    } catch {
        return [];
    }
}

export function readSeenTours(storage: StorageLike | null = defaultStorage()): Set<string> {
    try {
        return new Set(parseSeenTours(storage?.getItem(TOURS_SEEN_KEY)));
    } catch {
        return new Set();
    }
}

export function markToursSeen(ids: readonly string[], storage: StorageLike | null = defaultStorage()): boolean {
    try {
        const seen = readSeenTours(storage);
        for (const id of ids) seen.add(id);
        storage?.setItem(TOURS_SEEN_KEY, JSON.stringify([...seen]));
        return storage !== null;
    } catch {
        return false;
    }
}

export function readTourSetting(storage: StorageLike | null = defaultStorage()): TourSetting {
    try {
        return storage?.getItem(TOURS_SETTING_KEY) === "off" ? "off" : "on";
    } catch {
        return "on";
    }
}

export function writeTourSetting(value: TourSetting, storage: StorageLike | null = defaultStorage()): boolean {
    try {
        storage?.setItem(TOURS_SETTING_KEY, value);
        return storage !== null;
    } catch {
        return false;
    }
}

export function readDemoTourAnswer(product: TourProduct, storage: StorageLike | null = defaultStorage()): DemoTourAnswer | null {
    try {
        const value = storage?.getItem(`${TOURS_DEMO_KEY_PREFIX}${product}`);
        return value === "yes" || value === "no" ? value : null;
    } catch {
        return null;
    }
}

export function writeDemoTourAnswer(product: TourProduct, answer: DemoTourAnswer, storage: StorageLike | null = defaultStorage()): boolean {
    try {
        storage?.setItem(`${TOURS_DEMO_KEY_PREFIX}${product}`, answer);
        return storage !== null;
    } catch {
        return false;
    }
}

/**
 * Once per browser, the first time the tours load (no `tours-seen` yet): every reader starts with no tour seen, also one
 * who used the app before, so everyone gets the tours a new reader gets (zero point, Joël 2026-11-01). The 3.0 keys are
 * removed; the Tours setting is a choice of the reader and stays.
 */
export function initTourProgress(storage: StorageLike | null = defaultStorage()): void {
    try {
        if (!storage || storage.getItem(TOURS_SEEN_KEY) !== null) return;
        storage.setItem(TOURS_SEEN_KEY, JSON.stringify([]));
        for (const key of LEGACY_TOUR_KEYS) storage.removeItem(key);
    } catch {
        // without storage every tour counts as not seen
    }
}

function hasSteps(tours: readonly TourDefinition[], id: TourId): boolean {
    return (tours.find((t) => t.id === id)?.steps.length ?? 0) > 0;
}

/**
 * The tours that start by themselves on a page (tour spec 4.2): the app tour first, then on Azure the scope tour, then the
 * page's own tour; each only when it has steps and is not seen. Nothing with the setting Off.
 */
export function planAutoRun(input: { pageTour: TourId; tours: readonly TourDefinition[]; seen: ReadonlySet<string>; setting: TourSetting }): TourId[] {
    if (input.setting === "off") return [];
    const page = input.tours.find((t) => t.id === input.pageTour);
    if (!page || page.product === "app") return [];
    const chain: TourId[] = ["app"];
    if (page.product === "azure") chain.push("azure-scope");
    chain.push(page.id);
    return chain.filter((id) => !input.seen.has(id) && hasSteps(input.tours, id));
}

/** "All" of a product (tour spec 4.4): every tour of the product that has steps, in config order; the app tour is a choice of its own, and tours that start only in place are left out */
export function planAllRun(product: TourProduct, tours: readonly TourDefinition[]): TourId[] {
    return tours.filter((t) => t.product === product && !t.onlyInPlace && t.steps.length > 0).map((t) => t.id);
}

/** The tours of a product that have steps, grouped per page in config order, for the choice of Start the tour (tour spec 4.4); tours that start only in place are left out */
export function tourSections(product: TourProduct, tours: readonly TourDefinition[]): { section: string; tours: TourDefinition[] }[] {
    const sections: { section: string; tours: TourDefinition[] }[] = [];
    for (const tour of tours) {
        if (tour.product !== product || tour.onlyInPlace || tour.steps.length === 0) continue;
        const last = sections[sections.length - 1];
        if (last && last.section === tour.section) last.tours.push(tour);
        else sections.push({ section: tour.section, tours: [tour] });
    }
    return sections;
}

/** The steps of a run; a tour without a route runs on the route of the next tour that has one, or on `currentPath` */
export function buildRun(ids: readonly TourId[], tours: readonly TourDefinition[], currentPath: string): RunStep[] {
    const chosen = ids.map((id) => tours.find((t) => t.id === id)).filter((t): t is TourDefinition => t !== undefined);
    return chosen.flatMap((tour, i) => {
        const page = tour.page ?? chosen.slice(i + 1).find((t) => t.page !== null)?.page ?? currentPath;
        return tour.steps.map((step) => ({ ...step, key: `${tour.id}:${step.id}`, tour: tour.id, page, view: tour.view }));
    });
}

/** The next step to show from `from` in `direction`, past the steps whose target was not found; null past either end */
export function nextShownStep(from: number, direction: 1 | -1, missing: ReadonlySet<number>, length: number): number | null {
    for (let i = from + direction; i >= 0 && i < length; i += direction) {
        if (!missing.has(i)) return i;
    }
    return null;
}

/** "tour 2 of 5": the place of `index` and the number of steps, without the steps whose target was not found */
export function shownPosition(index: number, missing: ReadonlySet<number>, length: number): { position: number; total: number } {
    let position = 0;
    let total = 0;
    for (let i = 0; i < length; i++) {
        if (missing.has(i)) continue;
        total++;
        if (i <= index) position++;
    }
    return { position, total };
}

/** What counts as seen when a run ends (tour spec 4.3): all its tours on a stop, the tours that showed a step on complete */
export function toursToMarkSeen(run: readonly RunStep[], shownKeys: ReadonlySet<string>, endedBy: TourEnd): TourId[] {
    const ids = [...new Set(run.map((s) => s.tour))];
    if (endedBy === "stop") return ids;
    return ids.filter((id) => run.some((s) => s.tour === id && shownKeys.has(s.key)));
}
