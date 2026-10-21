/**
 * The PIM Monitor access model catalog (spec 9): parsing and validation of `eam-catalog.json` (schema 1), the loader
 * with the bundled fallback (fetch injected), the mapping of its sparse `expectedConfig` to "Set to" values, the group
 * placement proposal and the Conditional Access check of a label. The hook is `hooks/useAccessModelCatalog.ts`.
 *
 * The catalog is a proposal: a template lands in the basket and goes through the review like any other change.
 */
import type { ActivationRequirementValue, SettingField, SettingValue } from "@/utils/policyRules";

export const CATALOG_URL = "https://pimmonitor.com/catalog/v1/eam-catalog.json";
export const SUPPORTED_CATALOG_MAJOR = 1;

export type Plane = "Control" | "Management" | "Data";
export type SecurityLevel = "Privileged" | "Specialized" | "Enterprise";

export const PLANES: readonly Plane[] = ["Control", "Management", "Data"];
export const SECURITY_LEVELS: readonly SecurityLevel[] = ["Privileged", "Specialized", "Enterprise"];

/** Sparse: a missing field is Keep */
export interface ExpectedConfig {
    maxActivationDuration?: string;
    requireMFA?: boolean;
    /** A label slug such as `phish-resistant-sif` */
    authContext?: string;
    requireJustification?: boolean;
    requireApproval?: boolean;
    allowPermanentEligible?: boolean;
    allowPermanentActive?: boolean;
}

export interface CatalogRole {
    templateId: string;
    displayName: string;
    plane: Plane;
    securityLevel: SecurityLevel;
    isPrivileged: boolean;
    expectedConfig: ExpectedConfig;
    note?: string;
    reviewNeeded?: boolean;
}

export interface CatalogLevel {
    plane: Plane;
    securityLevel: SecurityLevel;
    expectedConfig: ExpectedConfig;
}

export interface CatalogGroupTemplate {
    plane: Plane;
    securityLevel: SecurityLevel;
    member: ExpectedConfig;
    owner: ExpectedConfig;
}

export interface CatalogAuthContext {
    slug: string;
    description?: string;
    requireState?: string;
    requireAuthStrengthId?: string;
    requireSignInFrequencyEveryTime?: boolean;
    requireCompliantDevice?: boolean;
}

export interface AccessModelCatalog {
    schemaVersion: string;
    catalogVersion: string;
    publishedAt?: string;
    source?: unknown;
    roles: CatalogRole[];
    levels: CatalogLevel[];
    groups: CatalogGroupTemplate[];
    authContexts: CatalogAuthContext[];
}

export type CatalogParseResult =
    | { ok: true; catalog: AccessModelCatalog }
    | { ok: false; reason: "newerVersion"; schemaVersion: string }
    | { ok: false; reason: "invalid"; detail: string };

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isPlane = (v: unknown): v is Plane => typeof v === "string" && (PLANES as readonly string[]).includes(v);
const isLevel = (v: unknown): v is SecurityLevel => typeof v === "string" && (SECURITY_LEVELS as readonly string[]).includes(v);

/** An ISO 8601 duration of days, hours and minutes (`PT1H`, `PT1H30M`, `P1D`); anything else would fail at write time */
const ISO_DURATION = /^P(?=\d|T\d)(\d+D)?(T(?=\d)(\d+H)?(\d+M)?)?$/;

function readConfig(raw: unknown): ExpectedConfig {
    if (!isObject(raw)) return {};
    const config: ExpectedConfig = {};
    const duration = raw.maxActivationDuration;
    // A zero length (`PT0M`) is no maximum to set either
    if (typeof duration === "string" && ISO_DURATION.test(duration) && /[1-9]/.test(duration)) config.maxActivationDuration = duration;
    if (typeof raw.requireMFA === "boolean") config.requireMFA = raw.requireMFA;
    if (typeof raw.authContext === "string" && raw.authContext) config.authContext = raw.authContext;
    if (typeof raw.requireJustification === "boolean") config.requireJustification = raw.requireJustification;
    if (typeof raw.requireApproval === "boolean") config.requireApproval = raw.requireApproval;
    if (typeof raw.allowPermanentEligible === "boolean") config.allowPermanentEligible = raw.allowPermanentEligible;
    if (typeof raw.allowPermanentActive === "boolean") config.allowPermanentActive = raw.allowPermanentActive;
    return config;
}

/** Parses a catalog file. A major `schemaVersion` other than 1 is "needs a newer PIM Manager", never a guess. */
export function parseAccessModelCatalog(raw: unknown): CatalogParseResult {
    if (!isObject(raw)) return { ok: false, reason: "invalid", detail: "The file is not a JSON object." };
    const schemaVersion = typeof raw.schemaVersion === "string" ? raw.schemaVersion : "";
    const major = Number(schemaVersion.split(".")[0]);
    if (!schemaVersion || !Number.isInteger(major)) return { ok: false, reason: "invalid", detail: "The file has no schemaVersion." };
    if (major !== SUPPORTED_CATALOG_MAJOR) return { ok: false, reason: "newerVersion", schemaVersion };
    if (!Array.isArray(raw.roles)) return { ok: false, reason: "invalid", detail: "The file has no roles list." };

    const roles: CatalogRole[] = [];
    for (const r of raw.roles) {
        if (!isObject(r) || typeof r.templateId !== "string" || !isPlane(r.plane) || !isLevel(r.securityLevel)) continue;
        roles.push({
            templateId: r.templateId.toLowerCase(),
            displayName: typeof r.displayName === "string" ? r.displayName : r.templateId,
            plane: r.plane,
            securityLevel: r.securityLevel,
            isPrivileged: r.isPrivileged === true,
            expectedConfig: readConfig(r.expectedConfig),
            ...(typeof r.note === "string" && r.note ? { note: r.note } : {}),
            ...(r.reviewNeeded === true ? { reviewNeeded: true } : {}),
        });
    }
    const levels: CatalogLevel[] = (Array.isArray(raw.levels) ? raw.levels : [])
        .filter((l): l is Record<string, unknown> => isObject(l) && isPlane(l.plane) && isLevel(l.securityLevel))
        .map((l) => ({ plane: l.plane as Plane, securityLevel: l.securityLevel as SecurityLevel, expectedConfig: readConfig(l.expectedConfig) }));
    const groups: CatalogGroupTemplate[] = (Array.isArray(raw.groups) ? raw.groups : [])
        .filter((g): g is Record<string, unknown> => isObject(g) && isPlane(g.plane) && isLevel(g.securityLevel))
        .map((g) => ({ plane: g.plane as Plane, securityLevel: g.securityLevel as SecurityLevel, member: readConfig(g.member), owner: readConfig(g.owner) }));
    const authContexts: CatalogAuthContext[] = (Array.isArray(raw.authContexts) ? raw.authContexts : [])
        .filter((a): a is Record<string, unknown> => isObject(a) && typeof a.slug === "string" && !!a.slug)
        .map((a) => ({
            slug: a.slug as string,
            ...(typeof a.description === "string" ? { description: a.description } : {}),
            ...(typeof a.requireState === "string" ? { requireState: a.requireState } : {}),
            ...(typeof a.requireAuthStrengthId === "string" ? { requireAuthStrengthId: a.requireAuthStrengthId } : {}),
            ...(typeof a.requireSignInFrequencyEveryTime === "boolean" ? { requireSignInFrequencyEveryTime: a.requireSignInFrequencyEveryTime } : {}),
            ...(typeof a.requireCompliantDevice === "boolean" ? { requireCompliantDevice: a.requireCompliantDevice } : {}),
        }));

    // A file of the right major whose rows all fail to read is not a catalog to show as live
    if (roles.length === 0) return { ok: false, reason: "invalid", detail: "No role could be read." };
    const missing = PLANES.flatMap((plane) => SECURITY_LEVELS.filter((level) => !levels.some((l) => l.plane === plane && l.securityLevel === level)).map((level) => `${plane} ${level}`));
    if (missing.length > 0) return { ok: false, reason: "invalid", detail: `No settings for ${missing.join(", ")}.` };

    return {
        ok: true,
        catalog: {
            schemaVersion,
            catalogVersion: typeof raw.catalogVersion === "string" ? raw.catalogVersion : "unknown",
            ...(typeof raw.publishedAt === "string" ? { publishedAt: raw.publishedAt } : {}),
            ...(raw.source !== undefined ? { source: raw.source } : {}),
            roles,
            levels,
            groups,
            authContexts,
        },
    };
}

export function findCatalogRole(catalog: AccessModelCatalog, templateId: string | null | undefined): CatalogRole | undefined {
    if (!templateId) return undefined;
    const key = templateId.toLowerCase();
    return catalog.roles.find((r) => r.templateId === key);
}

export function findLevel(catalog: AccessModelCatalog, plane: Plane, level: SecurityLevel): CatalogLevel | undefined {
    return catalog.levels.find((l) => l.plane === plane && l.securityLevel === level);
}

export function findGroupTemplate(catalog: AccessModelCatalog, plane: Plane, level: SecurityLevel): CatalogGroupTemplate | undefined {
    return catalog.groups.find((g) => g.plane === plane && g.securityLevel === level);
}

export interface SetToValue {
    field: SettingField;
    to: SettingValue;
}

export interface ConfigToSetToResult {
    values: SetToValue[];
    /** The label slug that could not be matched to a context in the tenant: the requirement stays Keep */
    unmatchedContext?: string;
}

/**
 * `expectedConfig` to Set to values (spec 9.2): `authContext` present makes the requirement that context (through
 * `resolveContext`, the label to context matching of 9.3); only `requireMFA` makes it MFA; `requireMFA` false without
 * `authContext` makes it Nothing. A label without a match stays Keep, never silently MFA.
 */
export function configToSetToValues(config: ExpectedConfig, resolveContext: (slug: string) => string | null): ConfigToSetToResult {
    const values: SetToValue[] = [];
    let unmatchedContext: string | undefined;
    if (config.maxActivationDuration) values.push({ field: "maxActivationDuration", to: config.maxActivationDuration });
    if (config.authContext) {
        const contextId = resolveContext(config.authContext);
        if (contextId) values.push({ field: "activationRequirement", to: { kind: "authenticationContext", contextId } satisfies ActivationRequirementValue });
        else unmatchedContext = config.authContext;
    } else if (config.requireMFA === true) {
        values.push({ field: "activationRequirement", to: { kind: "mfa" } });
    } else if (config.requireMFA === false) {
        values.push({ field: "activationRequirement", to: { kind: "none" } });
    }
    if (config.requireJustification !== undefined) values.push({ field: "requireJustificationOnActivation", to: config.requireJustification });
    if (config.requireApproval !== undefined) values.push({ field: "requireApproval", to: config.requireApproval });
    if (config.allowPermanentEligible !== undefined) values.push({ field: "allowPermanentEligible", to: config.allowPermanentEligible });
    if (config.allowPermanentActive !== undefined) values.push({ field: "allowPermanentActive", to: config.allowPermanentActive });
    return unmatchedContext ? { values, unmatchedContext } : { values };
}

const LEVEL_RANK: Record<SecurityLevel, number> = { Privileged: 0, Specialized: 1, Enterprise: 2 };
const PLANE_RANK: Record<Plane, number> = { Control: 0, Management: 1, Data: 2 };

/** Strictest first: Privileged above Specialized above Enterprise, then Control above Management above Data */
export function comparePlacement(a: { plane: Plane; securityLevel: SecurityLevel }, b: { plane: Plane; securityLevel: SecurityLevel }): number {
    return LEVEL_RANK[a.securityLevel] - LEVEL_RANK[b.securityLevel] || PLANE_RANK[a.plane] - PLANE_RANK[b.plane];
}

export interface GroupPlacementProposal {
    plane: Plane;
    securityLevel: SecurityLevel;
    /** The role that decided it ("From {role}") */
    fromRole: string;
}

/**
 * Where a group sits in the access model (spec 9.4): at the strictest place of the roles it holds, following the
 * clean source principle. A group without roles in the catalog gets no proposal.
 */
export function proposeGroupPlacement(catalog: AccessModelCatalog, heldRoleTemplateIds: readonly string[]): GroupPlacementProposal | null {
    const places = heldRoleTemplateIds
        .map((id) => findCatalogRole(catalog, id))
        .filter((r): r is CatalogRole => !!r)
        .sort(comparePlacement);
    const top = places[0];
    return top ? { plane: top.plane, securityLevel: top.securityLevel, fromRole: top.displayName } : null;
}

export type CatalogReason = "isPrivileged" | "fullControl" | "permissions";

/** "Why this level" (spec 8): from the published fields only (the catalog has no `levelBasis`) */
export function reasonForLevel(role: CatalogRole): CatalogReason {
    if (role.isPrivileged) return "isPrivileged";
    if (role.securityLevel === "Privileged") return "fullControl";
    return "permissions";
}

export const REASON_TEXT: Record<CatalogReason, string> = {
    isPrivileged: "Microsoft marks it privileged",
    fullControl: "Full control of a workload",
    permissions: "Its permissions",
};

export type CatalogOrigin = "live" | "bundled";
/** Why the bundled copy is used: the host could not be reached (or answered an error), the file is of a newer major, or it is invalid */
export type CatalogFallbackReason = "unreachable" | "newerVersion" | "invalid";

export interface LoadedCatalog {
    catalog: AccessModelCatalog;
    origin: CatalogOrigin;
    fallbackReason?: CatalogFallbackReason;
    /** The schema version of the file that needs a newer PIM Manager */
    newerSchemaVersion?: string;
    readAt: Date;
}

export const CATALOG_TIMEOUT_MS = 8000;

/**
 * Reads the catalog from pimmonitor.com (no tenant data is sent: a plain GET without credentials), falls back to the
 * bundled copy on any failure. Never throws unless the bundled copy itself is broken.
 */
export async function loadAccessModelCatalog(options: {
    fetchImpl: typeof fetch;
    loadBundled: () => Promise<unknown>;
    timeoutMs?: number;
    now?: () => Date;
}): Promise<LoadedCatalog> {
    const now = options.now ?? (() => new Date());
    const bundled = async (fallbackReason: CatalogFallbackReason, newerSchemaVersion?: string): Promise<LoadedCatalog> => {
        const parsed = parseAccessModelCatalog(await options.loadBundled());
        if (!parsed.ok) throw new Error(`The bundled access model catalog is not valid (${parsed.reason}).`);
        return { catalog: parsed.catalog, origin: "bundled", fallbackReason, ...(newerSchemaVersion ? { newerSchemaVersion } : {}), readAt: now() };
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? CATALOG_TIMEOUT_MS);
    let raw: unknown;
    try {
        const response = await options.fetchImpl(CATALOG_URL, { signal: controller.signal, credentials: "omit", headers: { Accept: "application/json" } });
        if (!response.ok) return bundled("unreachable");
        raw = await response.json();
    } catch {
        return bundled("unreachable");
    } finally {
        clearTimeout(timer);
    }
    const parsed = parseAccessModelCatalog(raw);
    if (parsed.ok) return { catalog: parsed.catalog, origin: "live", readAt: now() };
    return parsed.reason === "newerVersion" ? bundled("newerVersion", parsed.schemaVersion) : bundled("invalid");
}

/** The parts of a Conditional Access policy the label check reads (v1.0 `conditionalAccessPolicy`) */
export interface ConditionalAccessPolicyLike {
    state?: string | null;
    conditions?: { applications?: { includeAuthenticationContextClassReferences?: readonly string[] | null } | null } | null;
    grantControls?: { builtInControls?: readonly string[] | null; authenticationStrength?: { id?: string | null } | null } | null;
    sessionControls?: { signInFrequency?: { isEnabled?: boolean | null; frequencyInterval?: string | null } | null } | null;
}

/** Whether one policy meets every requirement the label states; a requirement the label does not state is not checked */
export function policyMeetsLabel(policy: ConditionalAccessPolicyLike, label: CatalogAuthContext): boolean {
    if ((policy.state ?? "").toLowerCase() !== (label.requireState ?? "enabled").toLowerCase()) return false;
    if (label.requireAuthStrengthId && (policy.grantControls?.authenticationStrength?.id ?? "").toLowerCase() !== label.requireAuthStrengthId.toLowerCase()) return false;
    if (label.requireSignInFrequencyEveryTime === true) {
        const sif = policy.sessionControls?.signInFrequency;
        if (sif?.isEnabled !== true || (sif.frequencyInterval ?? "").toLowerCase() !== "everytime") return false;
    }
    if (label.requireCompliantDevice === true && !(policy.grantControls?.builtInControls ?? []).some((c) => c.toLowerCase() === "compliantdevice")) return false;
    return true;
}

/**
 * The contexts whose policy meets the label (spec 9.3, second step): a context counts when one of the policies that
 * target it meets every requirement the label states. A label that states no requirement matches nothing, so the
 * admin chooses.
 */
export function contextsMeetingLabel(label: CatalogAuthContext, policies: readonly ConditionalAccessPolicyLike[]): string[] {
    const states = label.requireAuthStrengthId || label.requireSignInFrequencyEveryTime || label.requireCompliantDevice;
    if (!states) return [];
    const hits = new Set<string>();
    for (const policy of policies) {
        if (!policyMeetsLabel(policy, label)) continue;
        for (const id of policy.conditions?.applications?.includeAuthenticationContextClassReferences ?? []) hits.add(id);
    }
    return [...hits].sort();
}
