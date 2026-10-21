/**
 * Guided as data (spec 6, NG-70): the choices of the route, what a choice in Start clears, which step comes next, why
 * Next waits, the targets per side, the blocks of the Settings step with their Set to values from a copy source or the
 * PIM Monitor catalog, and the plan of those values. Pure; `app/configure/components/guided` draws it and keeps the
 * state above the views, so the review (a step of the mode) and "Back to changes" keep it.
 *
 * The admin's own choices on the Settings step are kept apart from the prefill (`overrides`), so a prefill that changes
 * (a new tick of another level, a part added) never overwrites what the admin chose, and a choice in Start that the
 * values depend on clears only the admin's choices.
 */
import type { ChangeSourceKind, GroupAccess, SettingField, SettingValue, Target } from "@/types/configure.types";
import type { BasketSetting } from "@/types/configure.types";
import {
    comparePlacement,
    configToSetToValues,
    findCatalogRole,
    findGroupTemplate,
    findLevel,
    type AccessModelCatalog,
    type ExpectedConfig,
    type Plane,
    type SecurityLevel,
} from "@/utils/accessModelCatalog";
import type { GroupPlacement } from "@/utils/authContextSlug";
import { changeId, leaveOut, type Basket } from "@/utils/configureBasket";
import { fieldLabel } from "@/utils/configureReview";
import { copyDraft, fieldsOf, planSeveral, type CopyCategory, type SeveralDraft, type SeveralEntry } from "@/utils/settingValues";

export type GuidedWorkload = "roles" | "groups";
export type GuidedSide = GroupAccess | "both";
export type GuidedFrom = "current" | "copy" | "model";
export type GuidedPart = "activation" | "assignment" | "notification" | "people";
export type GuidedStep = 1 | 2 | 3 | 4 | 5;

/** What the admin chose on the Settings step for one block: values set, and prefilled fields switched back to Keep */
export interface BlockOverrides {
    set: SeveralDraft;
    kept: SettingField[];
}

export interface GuidedState {
    workload: GuidedWorkload;
    side: GuidedSide;
    from: GuidedFrom;
    /** The copy source (a role id, or a group id), only with `from` copy */
    copySourceId: string | null;
    parts: GuidedPart[];
    /** Role or group ids in the order they were ticked */
    ticks: string[];
    /** Per block key what the admin changed against the prefill */
    overrides: Record<string, BlockOverrides>;
    /** Said once after a choice in Start cleared something; gone with the next step */
    notice: string | null;
    /** The setting changes the route put in the basket (their ids): replaced on the next plan, cleared with the values */
    routeChanges: string[];
    /** Lines the review shows for this route (a catalog label without a context, spec 9.3) */
    reviewNotes: string[];
    /** Adds with source `guided` that were in the basket when the route began: an earlier visit's, never taken by this one */
    inheritedAdds: string[];
}

export const INITIAL_GUIDED_STATE: GuidedState = {
    workload: "roles",
    side: "member",
    from: "current",
    copySourceId: null,
    parts: ["activation"],
    ticks: [],
    overrides: {},
    notice: null,
    routeChanges: [],
    reviewNotes: [],
    inheritedAdds: [],
};

/** The parts the access model can fill (spec 6.1.4: the catalog has no notification values) */
export const MODEL_PARTS: readonly GuidedPart[] = ["activation", "assignment"];
export const PARTS: readonly GuidedPart[] = ["activation", "assignment", "notification", "people"];

export type GuidedAction =
    /** Entering Guided: a fresh route, or the access model's "Use as a template" with its choices */
    | { type: "reset"; state?: Partial<GuidedState> }
    | { type: "workload"; workload: GuidedWorkload; copySourceId: string | null }
    | { type: "side"; side: GuidedSide }
    | { type: "from"; from: GuidedFrom; copySourceId: string | null }
    | { type: "copySource"; id: string }
    | { type: "part"; part: GuidedPart }
    | { type: "tick"; id: string }
    /** "Select all {m} shown": adds the ids not ticked yet, in their order */
    | { type: "tickAll"; ids: readonly string[] }
    | { type: "overrides"; key: string; overrides: BlockOverrides }
    /** Next from Settings put these setting changes in the basket */
    | { type: "planned"; ids: string[]; reviewNotes: string[] }
    | { type: "clearNotice" };

const hasOverrides = (overrides: Record<string, BlockOverrides>) => Object.values(overrides).some((o) => Object.keys(o.set).length > 0 || o.kept.length > 0);
/** The admin's values: choices on the Settings step, or changes the route put in the basket */
const hasValues = (state: GuidedState) => hasOverrides(state.overrides) || state.routeChanges.length > 0;
/** The field of a setting change id (`setting|{target}|{field}`) */
const fieldOfId = (id: string) => id.slice(id.lastIndexOf("|") + 1);

/** The fields of a settings part (People has none) */
export function fieldsOfPart(part: GuidedPart): SettingField[] {
    return part === "people" ? [] : fieldsOf(part as CopyCategory);
}

function withoutFields(overrides: Record<string, BlockOverrides>, fields: readonly SettingField[]): { next: Record<string, BlockOverrides>; isCleared: boolean } {
    const drop = new Set(fields);
    let isCleared = false;
    const next: Record<string, BlockOverrides> = {};
    for (const [key, o] of Object.entries(overrides)) {
        const set: SeveralDraft = {};
        for (const [field, value] of Object.entries(o.set) as [SettingField, SettingValue][]) {
            if (drop.has(field)) isCleared = true;
            else set[field] = value;
        }
        const kept = o.kept.filter((f) => !drop.has(f));
        if (kept.length !== o.kept.length) isCleared = true;
        next[key] = { set, kept };
    }
    return { next, isCleared };
}

function cleared(what: { targets: boolean; values: boolean }, because: string): string | null {
    if (!what.targets && !what.values) return null;
    const subject = what.targets && what.values ? "Targets and values were" : what.targets ? "Targets were" : "Values were";
    return `${subject} cleared because you changed ${because}.`;
}

/**
 * The route's reducer. A choice in Start clears what depends on it (plan NG-70, "What clears what"): roles or groups
 * clears the ticks, the values and the copy source; Member, Owner or Both, the start and the copy source clear the
 * values; a part removed clears its values. Changes already in the basket are never touched.
 */
export function guidedReducer(state: GuidedState, action: GuidedAction): GuidedState {
    switch (action.type) {
        case "reset":
            return { ...INITIAL_GUIDED_STATE, ...action.state };
        case "workload": {
            if (action.workload === state.workload) return state;
            const notice = cleared({ targets: state.ticks.length > 0, values: hasValues(state) }, "roles or groups");
            return { ...state, workload: action.workload, side: "member", copySourceId: state.from === "copy" ? action.copySourceId : null, ticks: [], overrides: {}, routeChanges: [], reviewNotes: [], notice };
        }
        case "side": {
            if (action.side === state.side) return state;
            return { ...state, side: action.side, overrides: {}, routeChanges: [], reviewNotes: [], notice: cleared({ targets: false, values: hasValues(state) }, "Member or Owner") };
        }
        case "from": {
            if (action.from === state.from) return state;
            const copySourceId = action.from === "copy" ? action.copySourceId : null;
            const ticks = copySourceId ? state.ticks.filter((id) => id !== copySourceId) : state.ticks;
            let parts = action.from === "model" ? state.parts.filter((p) => MODEL_PARTS.includes(p)) : state.parts;
            if (parts.length === 0) parts = ["activation"];
            const notice = cleared({ targets: ticks.length !== state.ticks.length, values: hasValues(state) }, "where to start from");
            return { ...state, from: action.from, copySourceId, ticks, parts, overrides: {}, routeChanges: [], reviewNotes: [], notice };
        }
        case "copySource": {
            if (state.from !== "copy" || action.id === state.copySourceId) return state;
            const ticks = state.ticks.filter((id) => id !== action.id);
            const notice = cleared({ targets: ticks.length !== state.ticks.length, values: hasValues(state) }, "the copy source");
            return { ...state, copySourceId: action.id, ticks, overrides: {}, routeChanges: [], reviewNotes: [], notice };
        }
        case "part": {
            if (state.parts.includes(action.part)) {
                const fields = new Set<string>(fieldsOfPart(action.part));
                const { next, isCleared } = withoutFields(state.overrides, [...fields] as SettingField[]);
                const routeChanges = state.routeChanges.filter((id) => !fields.has(fieldOfId(id)));
                const isDropped = routeChanges.length !== state.routeChanges.length;
                return { ...state, parts: state.parts.filter((p) => p !== action.part), overrides: next, routeChanges, notice: cleared({ targets: false, values: isCleared || isDropped }, "what to set") };
            }
            if (state.from === "model" && !MODEL_PARTS.includes(action.part)) return state;
            return { ...state, parts: PARTS.filter((p) => p === action.part || state.parts.includes(p)), notice: null };
        }
        case "tick": {
            if (state.from === "copy" && action.id === state.copySourceId) return state;
            const ticks = state.ticks.includes(action.id) ? state.ticks.filter((id) => id !== action.id) : [...state.ticks, action.id];
            return { ...state, ticks };
        }
        case "tickAll": {
            const add = action.ids.filter((id) => !state.ticks.includes(id) && !(state.from === "copy" && id === state.copySourceId));
            return add.length === 0 ? state : { ...state, ticks: [...state.ticks, ...add] };
        }
        case "overrides":
            return { ...state, overrides: { ...state.overrides, [action.key]: action.overrides } };
        case "planned":
            return { ...state, routeChanges: [...action.ids], reviewNotes: [...action.reviewNotes] };
        case "clearNotice":
            return state.notice === null ? state : { ...state, notice: null };
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Steps

export const GUIDED_STEPS: ReadonlyArray<{ step: GuidedStep; name: string; line: string }> = [
    { step: 1, name: "Start", line: "Roles or groups, what, from where" },
    { step: 2, name: "Targets", line: "Which ones" },
    { step: 3, name: "Settings", line: "Keep or set" },
    { step: 4, name: "People", line: "Add people" },
    { step: 5, name: "Review", line: "Then apply" },
];

/** The parts that are settings (People is its own step) */
export const settingsParts = (state: Pick<GuidedState, "parts">): GuidedPart[] => state.parts.filter((p) => p !== "people");

/** Settings is skipped without a settings part, People without People */
export function isSkipped(step: GuidedStep, state: Pick<GuidedState, "parts">): boolean {
    if (step === 3) return settingsParts(state).length === 0;
    if (step === 4) return !state.parts.includes("people");
    return false;
}

export function nextStep(step: GuidedStep, state: Pick<GuidedState, "parts">): GuidedStep {
    let next = step + 1;
    while (next < 5 && isSkipped(next as GuidedStep, state)) next += 1;
    return Math.min(next, 5) as GuidedStep;
}

export function previousStep(step: GuidedStep, state: Pick<GuidedState, "parts">): GuidedStep {
    let previous = step - 1;
    while (previous > 1 && isSkipped(previous as GuidedStep, state)) previous -= 1;
    return Math.max(previous, 1) as GuidedStep;
}

export type StepStatus = "done" | "current" | "upcoming" | "skipped";

export interface StepItem {
    step: GuidedStep;
    name: string;
    /** The muted line, or "Skipped" */
    line: string;
    status: StepStatus;
}

/** The steps bar: done steps (before the current one, not skipped) can be opened again */
export function describeSteps(state: Pick<GuidedState, "parts">, current: GuidedStep): StepItem[] {
    return GUIDED_STEPS.map(({ step, name, line }) => {
        const skipped = isSkipped(step, state);
        const status: StepStatus = step === current ? "current" : skipped ? "skipped" : step < current ? "done" : "upcoming";
        return { step, name, line: skipped ? "Skipped" : line, status };
    });
}

export interface StartContext {
    /** The admin may change at least one role, or one group; null when it may, else why not */
    workloadLock: Record<GuidedWorkload, string | null>;
}

/** Why Next waits on Start; null when it may go on */
export function startProblem(state: GuidedState, ctx: StartContext): string | null {
    const lock = ctx.workloadLock[state.workload];
    if (lock) return lock;
    if (state.parts.length === 0) return "Choose at least one thing to set.";
    if (state.from === "copy" && !state.copySourceId) return `Choose the ${state.workload === "roles" ? "role" : "group"} to copy from.`;
    return null;
}

/** Why Next waits on Targets: nothing ticked, or (access model, groups) a ticked group without a place */
export function targetsProblem(state: GuidedState, tickedOpen: readonly string[], unplacedNames: readonly string[]): string | null {
    if (tickedOpen.length === 0) return `Select at least one ${state.workload === "roles" ? "role" : "group"}.`;
    if (state.from === "model" && state.workload === "groups" && unplacedNames.length > 0) return `Place ${unplacedNames.join(", ")} in the access model first.`;
    return null;
}

/**
 * The step to show for the step asked (the URL's `gstep`): never past a step whose earlier steps are not complete, never
 * a skipped step, never Review (that is the review page). A reload, which keeps only `gstep`, starts at Start.
 */
export function reachableStep(wanted: number | undefined, state: Pick<GuidedState, "parts">, problems: { start: string | null; targets: string | null }): GuidedStep {
    let step = (wanted && wanted >= 1 && wanted <= 5 ? wanted : 1) as GuidedStep;
    if (step >= 2 && problems.start) return 1;
    if (step >= 3 && problems.targets) return 2;
    if (step === 5 || isSkipped(step, state)) step = previousStep(step, state);
    return step;
}

export const NOTHING_TO_REVIEW = "Nothing to review yet. Set at least one setting, or add people.";

// ---------------------------------------------------------------------------------------------------------------------
// Targets per side

/** The sides a route writes: one, or Member and Owner with Both */
export function sidesOf(state: Pick<GuidedState, "workload" | "side">): GroupAccess[] {
    if (state.workload === "roles") return ["member"];
    return state.side === "both" ? ["member", "owner"] : [state.side];
}

/**
 * The entries of the ticked targets: a role once, a group once per side, named "{group} · Member" and
 * "{group} · Owner" with Both. `entryOf` builds one (`roleEntry`, `groupEntry`).
 */
export function guidedEntries(state: GuidedState, ticked: readonly string[], entryOf: (id: string, access: GroupAccess) => SeveralEntry | null): SeveralEntry[] {
    const entries: SeveralEntry[] = [];
    for (const id of ticked) {
        for (const access of sidesOf(state)) {
            const entry = entryOf(id, access);
            if (!entry) continue;
            entries.push(state.workload === "groups" && state.side === "both" ? { ...entry, name: `${entry.name} · ${access === "owner" ? "Owner" : "Member"}` } : entry);
        }
    }
    return entries;
}

// ---------------------------------------------------------------------------------------------------------------------
// Settings blocks and their values

export interface SettingsBlock {
    key: string;
    /** "Privileged" (or "Control · Privileged" when the planes of a level differ) with the access model; null otherwise */
    title: string | null;
    entries: SeveralEntry[];
    /** The Set to values before the admin's own choices (the copy source, the catalog), only fields of the parts chosen */
    prefill: SeveralDraft;
    /** Lines under the block title: not in the catalog, no group template, a duration brought into range */
    notes: string[];
    /** Catalog labels of this block without a context in the tenant: the requirement stays Keep until one is chosen */
    unmatchedLabels: string[];
}

export interface BlockContext {
    catalog: AccessModelCatalog | null;
    /** The template id of a role (the catalog is keyed by it) */
    templateOf: (roleId: string) => string | undefined;
    /** The place of a group (the admin's, else the proposal); null when not placed */
    placementOf: (groupId: string) => GroupPlacement | null;
    /** A label slug to a context id of the tenant (spec 9.3), null when not matched or when the admin must choose */
    resolveContext: (slug: string) => string | null;
    /** The name of a label as the catalog words it */
    labelName: (slug: string) => string;
    tenantName: string;
    /** The copy source as read, on the side the route writes (Member with Both) */
    copySource: SeveralEntry | null;
    basket: Basket;
}

const fieldsOfParts = (parts: readonly GuidedPart[]) => new Set(parts.flatMap(fieldsOfPart));

function pick(draft: SeveralDraft, fields: ReadonlySet<SettingField>): SeveralDraft {
    const out: SeveralDraft = {};
    for (const [field, value] of Object.entries(draft) as [SettingField, SettingValue][]) if (fields.has(field)) out[field] = value;
    return out;
}

const sameConfig = (a: ExpectedConfig, b: ExpectedConfig) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

/**
 * A catalog duration as Edit writes it: whole or half hours from 1 to 24 (`PT{h}H`, `PT{h}H30M`), the range of the
 * slider (Defaults taken). A value outside it is brought into it; null when it is not an ISO duration of days, hours
 * and minutes.
 */
export function activationDurationFromCatalog(iso: string): { value: string; isChanged: boolean } | null {
    const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(iso);
    if (!m || (!m[1] && !m[2] && !m[3])) return null;
    const hours = Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0) + Number(m[3] ?? 0) / 60;
    const kept = Math.min(24, Math.max(1, Math.round(hours * 2) / 2));
    const whole = Math.floor(kept);
    const value = kept === whole ? `PT${whole}H` : `PT${whole}H30M`;
    return { value, isChanged: kept !== hours };
}

function catalogValues(config: ExpectedConfig, fields: ReadonlySet<SettingField>, ctx: BlockContext): { prefill: SeveralDraft; notes: string[]; unmatched: string[] } {
    const result = configToSetToValues(config, ctx.resolveContext);
    const prefill: SeveralDraft = {};
    const notes: string[] = [];
    for (const { field, to } of result.values) {
        if (!fields.has(field)) continue;
        if (field === "maxActivationDuration" && typeof to === "string") {
            const duration = activationDurationFromCatalog(to);
            if (!duration) continue;
            if (duration.isChanged) notes.push(`The catalog recommends ${to} for the maximum activation duration; Set to uses the nearest value from 1 to 24 hours.`);
            prefill[field] = duration.value;
        } else prefill[field] = to;
    }
    const unmatched = result.unmatchedContext && fields.has("activationRequirement") ? [result.unmatchedContext] : [];
    return { prefill, notes, unmatched };
}

/** "Privileged" when every plane of the level recommends the same, else "Control · Privileged" (as the access model page) */
function levelTitle(catalog: AccessModelCatalog, plane: Plane, level: SecurityLevel, configOf: (plane: Plane) => ExpectedConfig | undefined): string {
    const own = configOf(plane);
    const others = (["Control", "Management", "Data"] as Plane[]).map(configOf);
    return own && others.every((c) => c && sameConfig(c, own)) ? level : `${plane} · ${level}`;
}

/** The values of a role in the catalog: its level's (spec 6.3), its own when the catalog has no cell for the level */
function roleConfig(catalog: AccessModelCatalog, plane: Plane, level: SecurityLevel, own: ExpectedConfig): ExpectedConfig {
    return findLevel(catalog, plane, level)?.expectedConfig ?? own;
}

/**
 * The blocks of the Settings step. The current settings and a copy are one block with every target (a copy prefilled
 * with the source's values, its waiting changes included). The access model makes one block per level (spec 6.3): a
 * role with the values of its plane and level, one block for a level whose planes recommend the same; roles not in the
 * catalog in "Not classified" without values; a group at its placement with the `groups[]` template of its side.
 */
export function settingsBlocks(state: GuidedState, entries: readonly SeveralEntry[], ctx: BlockContext): SettingsBlock[] {
    const fields = fieldsOfParts(settingsParts(state));
    if (state.from !== "model") {
        const prefill = state.from === "copy" && ctx.copySource
            ? pick(copyDraft(ctx.copySource, settingsParts(state) as CopyCategory[], ctx.basket), fields)
            : {};
        return entries.length > 0 ? [{ key: "all", title: null, entries: [...entries], prefill, notes: [], unmatchedLabels: [] }] : [];
    }

    type Placed = { place: { plane: Plane; securityLevel: SecurityLevel } | null; config: ExpectedConfig | null; title: string; entries: SeveralEntry[]; note?: string };
    const blocks = new Map<string, Placed>();
    const put = (key: string, make: () => Omit<Placed, "entries">, entry: SeveralEntry) => {
        const block = blocks.get(key) ?? { ...make(), entries: [] };
        block.entries.push(entry);
        blocks.set(key, block);
    };
    const catalog = ctx.catalog;
    for (const entry of entries) {
        if (entry.target.kind === "role") {
            const role = catalog ? findCatalogRole(catalog, ctx.templateOf(entry.target.id)) : undefined;
            if (!catalog || !role) {
                put("unclassified", () => ({ place: null, config: null, title: "Not classified", note: "Not in the catalog: these roles get no values from the access model." }), entry);
                continue;
            }
            const config = roleConfig(catalog, role.plane, role.securityLevel, role.expectedConfig);
            const title = levelTitle(catalog, role.plane, role.securityLevel, (p) => findLevel(catalog, p, role.securityLevel)?.expectedConfig);
            put(`${title}|${JSON.stringify(Object.entries(config).sort())}`, () => ({ place: { plane: role.plane, securityLevel: role.securityLevel }, config, title }), entry);
        } else {
            const access = entry.target.access;
            const side = state.side === "both" ? ` · ${access === "owner" ? "Owner" : "Member"}` : "";
            const place = ctx.placementOf(entry.target.id);
            if (!catalog || !place) {
                put(`unplaced|${access}`, () => ({ place: null, config: null, title: `Not placed${side}`, note: "Not placed in the access model: these groups get no values." }), entry);
                continue;
            }
            const template = findGroupTemplate(catalog, place.plane, place.securityLevel);
            const title = `${levelTitle(catalog, place.plane, place.securityLevel, (p) => findGroupTemplate(catalog, p, place.securityLevel)?.[access])}${side}`;
            put(`${title}|${template ? JSON.stringify(Object.entries(template[access]).sort()) : "none"}`, () => ({
                place,
                config: template ? template[access] : null,
                title,
                ...(template ? {} : { note: `The catalog has no settings for ${place.plane} · ${place.securityLevel} groups yet: every row stays Keep.` }),
            }), entry);
        }
    }

    const ordered = [...blocks.entries()].sort(([, a], [, b]) => (a.place && b.place ? comparePlacement(a.place, b.place) : a.place ? -1 : b.place ? 1 : 0));
    // Two blocks of one title (roles whose catalog values differ) are told apart by a number
    const seen = new Map<string, number>();
    return ordered.map(([key, b]) => {
        const n = (seen.get(b.title) ?? 0) + 1;
        seen.set(b.title, n);
        const values = b.config ? catalogValues(b.config, fields, ctx) : { prefill: {}, notes: [], unmatched: [] };
        return {
            key,
            title: n > 1 ? `${b.title} (${n})` : b.title,
            entries: b.entries,
            prefill: values.prefill,
            notes: [...(b.note ? [b.note] : []), ...values.notes],
            unmatchedLabels: values.unmatched,
        };
    });
}

/** What the review says about the access model (spec 9.3): every label left without a context, with its targets */
export function unmatchedReviewNotes(blocks: readonly SettingsBlock[], ctx: Pick<BlockContext, "labelName" | "tenantName">): string[] {
    const bySlug = new Map<string, string[]>();
    for (const block of blocks) for (const slug of block.unmatchedLabels) bySlug.set(slug, [...(bySlug.get(slug) ?? []), ...block.entries.map((e) => e.name)]);
    return [...bySlug.entries()].map(([slug, names]) => `"${ctx.labelName(slug)}" is not matched to an authentication context in ${ctx.tenantName}, so "On activation, require" stays as it is for ${names.join(", ")}.`);
}

/** The values a block shows: the prefill with the admin's choices on top, only fields of the parts chosen */
export function draftOf(block: SettingsBlock, overrides: BlockOverrides | undefined, parts: readonly GuidedPart[]): SeveralDraft {
    const fields = fieldsOfParts(settingsParts({ parts: [...parts] }));
    const draft: SeveralDraft = { ...block.prefill };
    for (const field of overrides?.kept ?? []) delete draft[field];
    Object.assign(draft, overrides?.set ?? {});
    return pick(draft, fields);
}

/** What the admin's new draft of a block means against its prefill: values set, prefilled fields back to Keep */
export function overridesFrom(prefill: SeveralDraft, next: SeveralDraft): BlockOverrides {
    const set: SeveralDraft = {};
    const kept: SettingField[] = [];
    for (const field of Object.keys(prefill) as SettingField[]) if (!(field in next)) kept.push(field);
    for (const [field, value] of Object.entries(next) as [SettingField, SettingValue][]) {
        if (JSON.stringify(prefill[field]) !== JSON.stringify(value)) set[field] = value;
    }
    return { set, kept };
}

/** The source of the changes: the access model, a copy, else Guided */
export function sourceOf(from: GuidedFrom): ChangeSourceKind {
    return from === "model" ? "model" : from === "copy" ? "copy" : "guided";
}

export interface GuidedPlan {
    add: BasketSetting[];
    /** Fields left alone because a change from Edit or Import waits on them: "{target}: {field}" ids */
    heldBack: string[];
    leaveOut: string[];
    problem: string | null;
    /** Targets left alone because a field set is not read for them */
    skipped: string[];
}

/**
 * Every block through `planSeveral`: one change per target and field whose value differs. The plan is made against the
 * basket without the route's own earlier changes, and `leaveOut` names them, so Next from Settings replaces what the
 * route added before (a row back to Keep, a target unticked) and never touches changes from Edit or Import.
 */
export function planGuided(state: GuidedState, blocks: readonly SettingsBlock[], basket: Basket): GuidedPlan {
    const plan: GuidedPlan = { add: [], heldBack: [], leaveOut: [...state.routeChanges], problem: null, skipped: [] };
    const own = new Set(state.routeChanges);
    basket = leaveOut(basket, state.routeChanges);
    const problems: string[] = [];
    for (const block of blocks) {
        const one = planSeveral(draftOf(block, state.overrides[block.key], state.parts), block.entries, basket, sourceOf(state.from));
        // A change from Edit or Import on the same field stays: Guided never replaces or removes it
        for (const change of one.add) {
            const id = changeId(change);
            if (basket.changes.some((c) => changeId(c) === id && !own.has(id))) plan.heldBack.push(id);
            else plan.add.push(change);
        }
        for (const id of one.leaveOut) if (!plan.leaveOut.includes(id)) plan.leaveOut.push(id);
        if (one.problem) problems.push(one.problem);
        for (const name of one.skipped) if (!plan.skipped.includes(name)) plan.skipped.push(name);
    }
    plan.problem = problems.length > 0 ? problems.join(" ") : null;
    return plan;
}

/**
 * What Guided held back because Edit or Import already changes the same field (`planGuided.heldBack`), said in the
 * review: the tenant run of 2026-10-09 found "Both" giving the Owner side Guided's value while the Member side silently
 * kept the Edit change.
 */
export function heldBackReviewNotes(ids: readonly string[], basket: Basket, nameOf: (target: Target) => string): string[] {
    const held = new Set(ids);
    return basket.changes
        .filter((c): c is BasketSetting => c.kind === "setting" && held.has(changeId(c)))
        .map((c) => `${nameOf(c.target)}: "${fieldLabel(c.field)}" keeps the change made in ${c.source.from === "import" ? "Import" : "Edit"}, so Guided's value is not used there. Leave that change out and run Guided again to use Guided's value.`);
}

/** The ids of the adds Guided made earlier (source `guided`): the route that begins now never takes them */
export function guidedAddIds(basket: Basket): string[] {
    return basket.changes.filter((c) => c.kind === "add" && c.source.from === "guided").map(changeId);
}

/**
 * The basket changes a choice takes with it (spec 6: a change in Start clears the later steps): the route's setting
 * changes the new state no longer holds, the people Guided added when People goes or roles and groups change, and the
 * people added for a target that is unticked. Changes from Edit, Import or an undo, and the people of an earlier Guided
 * visit, are never in it.
 */
export function droppedByChoice(previous: GuidedState, next: GuidedState, basket: Basket): string[] {
    const ids = previous.routeChanges.filter((id) => !next.routeChanges.includes(id));
    const inherited = new Set(previous.inheritedAdds);
    const untickedIds = new Set(previous.ticks.filter((id) => !next.ticks.includes(id)));
    const peopleGo = previous.parts.includes("people") && (!next.parts.includes("people") || next.workload !== previous.workload);
    for (const change of basket.changes) {
        if (change.kind !== "add" || change.source.from !== "guided") continue;
        const id = changeId(change);
        if (inherited.has(id)) continue;
        if (peopleGo || untickedIds.has(change.target.id)) ids.push(id);
    }
    return ids;
}
