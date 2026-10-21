/**
 * The admin's access model choices as a file (Configure, Access model page): the label to authentication context choices
 * and the group placements, saved to a JSON file and read back by Import a file. Pure. Nothing here writes to a tenant:
 * an import keeps the choices in this browser, as Settings does. A tenant is matched first, so a file from another
 * tenant can only place what that tenant has too (a context by its name, a group by its id).
 */
import { PLANES, SECURITY_LEVELS, type Plane, type SecurityLevel } from "@/utils/accessModelCatalog";
import { slugify, type GroupPlacement, type TenantContext } from "@/utils/authContextSlug";

export const ACCESS_MODEL_FILE_FORMAT = "pim-manager-access-model";
export const ACCESS_MODEL_FILE_VERSION = 1;
/** More than this many entries of one kind (labels or groups) is not a file this page writes: the file is refused */
export const MAX_FILE_ENTRIES = 500;

export interface AccessModelLabelEntry {
    /** The label slug of the PIM Monitor catalog, e.g. `phish-resistant-sif` */
    label: string;
    contextId: string;
    /** The context's display name when it was chosen: the import matches a context by name first */
    contextName: string | null;
}

export interface AccessModelGroupEntry {
    groupId: string;
    groupName: string | null;
    plane: Plane;
    securityLevel: SecurityLevel;
}

export interface AccessModelFile {
    format: typeof ACCESS_MODEL_FILE_FORMAT;
    formatVersion: typeof ACCESS_MODEL_FILE_VERSION;
    exportedAt: string;
    tenant: { id: string; name: string | null };
    labels: AccessModelLabelEntry[];
    groups: AccessModelGroupEntry[];
}

export interface BuildInput {
    tenantId: string;
    tenantName: string | null;
    exportedAt: Date;
    contextChoices: Readonly<Record<string, string>>;
    groupPlacements: Readonly<Record<string, GroupPlacement>>;
    /** The tenant's contexts and groups as read now, for the names written next to the ids */
    contexts: readonly TenantContext[];
    groups: readonly { id: string; displayName: string }[];
}

/** The file of the choices as they stand (sorted, so two exports of the same choices are the same file) */
export function buildAccessModelFile(input: BuildInput): AccessModelFile {
    const contextName = new Map(input.contexts.map((c) => [c.id, c.displayName] as const));
    const groupName = new Map(input.groups.map((g) => [g.id.toLowerCase(), g.displayName] as const));
    const labels = Object.entries(input.contextChoices)
        .map(([label, contextId]) => ({ label, contextId, contextName: contextName.get(contextId) ?? null }))
        .sort((a, b) => a.label.localeCompare(b.label));
    const groups = Object.entries(input.groupPlacements)
        .map(([groupId, placement]) => ({
            groupId,
            groupName: groupName.get(groupId.toLowerCase()) ?? null,
            plane: placement.plane,
            securityLevel: placement.securityLevel,
        }))
        .sort((a, b) => (a.groupName ?? a.groupId).localeCompare(b.groupName ?? b.groupId));
    return {
        format: ACCESS_MODEL_FILE_FORMAT,
        formatVersion: ACCESS_MODEL_FILE_VERSION,
        exportedAt: input.exportedAt.toISOString(),
        tenant: { id: input.tenantId, name: input.tenantName },
        labels,
        groups,
    };
}

export function serializeAccessModelFile(file: AccessModelFile): string {
    return `${JSON.stringify(file, null, 2)}\n`;
}

/** The file name: the tenant's name (or "tenant") and the day of the export */
export function accessModelFileName(file: AccessModelFile): string {
    const tenant = slugify(file.tenant.name ?? "") || "tenant";
    return `pim-manager-access-model-${tenant}-${file.exportedAt.slice(0, 10)}.json`;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const isPlane = (v: unknown): v is Plane => (PLANES as readonly unknown[]).includes(v);
const isLevel = (v: unknown): v is SecurityLevel => (SECURITY_LEVELS as readonly unknown[]).includes(v);

/** True when the JSON is a file of this kind (the format key, not the version): the import detects it by this */
export function isAccessModelFile(json: unknown): boolean {
    return isRecord(json) && json.format === ACCESS_MODEL_FILE_FORMAT;
}

export type AccessModelFileParse =
    | { ok: true; file: AccessModelFile; skipped: number }
    | { ok: false; reason: string };

/**
 * Reads a file of this kind. A file of another version is refused; an entry that is not usable is skipped and counted,
 * so one bad entry never wipes the others.
 */
export function parseAccessModelFile(json: unknown): AccessModelFileParse {
    if (!isAccessModelFile(json) || !isRecord(json)) return { ok: false, reason: "This is not a PIM Manager access model file." };
    if (json.formatVersion !== ACCESS_MODEL_FILE_VERSION) return { ok: false, reason: "This file is from another version of PIM Manager. Export it again from this version." };
    const tenant = isRecord(json.tenant) ? json.tenant : {};
    const rawLabels = Array.isArray(json.labels) ? json.labels : [];
    const rawGroups = Array.isArray(json.groups) ? json.groups : [];
    if (rawLabels.length > MAX_FILE_ENTRIES || rawGroups.length > MAX_FILE_ENTRIES) return { ok: false, reason: "This file holds too many entries to be an access model file." };
    let skipped = 0;
    const labels: AccessModelLabelEntry[] = [];
    const seenLabels = new Set<string>();
    for (const entry of rawLabels) {
        if (isRecord(entry) && isText(entry.label) && isText(entry.contextId) && (entry.contextName === null || typeof entry.contextName === "string")) {
            // A label twice in one file: the first one counts, the second is skipped
            if (seenLabels.has(entry.label)) { skipped++; continue; }
            seenLabels.add(entry.label);
            labels.push({ label: entry.label, contextId: entry.contextId, contextName: entry.contextName ?? null });
        } else skipped++;
    }
    const groups: AccessModelGroupEntry[] = [];
    const seenGroups = new Set<string>();
    for (const entry of rawGroups) {
        if (isRecord(entry) && isText(entry.groupId) && isPlane(entry.plane) && isLevel(entry.securityLevel)) {
            if (seenGroups.has(entry.groupId.toLowerCase())) { skipped++; continue; }
            seenGroups.add(entry.groupId.toLowerCase());
            groups.push({
                groupId: entry.groupId,
                groupName: typeof entry.groupName === "string" ? entry.groupName : null,
                plane: entry.plane,
                securityLevel: entry.securityLevel,
            });
        } else skipped++;
    }
    return {
        ok: true,
        skipped,
        file: {
            format: ACCESS_MODEL_FILE_FORMAT,
            formatVersion: ACCESS_MODEL_FILE_VERSION,
            exportedAt: typeof json.exportedAt === "string" ? json.exportedAt : "",
            tenant: { id: typeof tenant.id === "string" ? tenant.id : "", name: typeof tenant.name === "string" ? tenant.name : null },
            labels,
            groups,
        },
    };
}

export type LabelMatch =
    | { status: "byName"; contextId: string; contextName: string }
    | { status: "byId"; contextId: string; contextName: string }
    | { status: "missing" };

/** A context id is only "c1" to "c99" and means something else in every tenant: it is matched in the same tenant only */

export type GroupMatch =
    | { status: "byId"; groupId: string; groupName: string }
    | { status: "missing" };

/** A context of this tenant for a label of the file: by its name (one match), else by its id in the same tenant, else nothing */
export function matchLabelEntry(entry: AccessModelLabelEntry, contexts: readonly TenantContext[], sameTenant: boolean): LabelMatch {
    if (entry.contextName) {
        const wanted = entry.contextName.trim().toLowerCase();
        const byName = contexts.filter((c) => c.displayName.trim().toLowerCase() === wanted);
        if (byName.length === 1) return { status: "byName", contextId: byName[0].id, contextName: byName[0].displayName };
    }
    const byId = sameTenant ? contexts.find((c) => c.id === entry.contextId) : undefined;
    if (byId) return { status: "byId", contextId: byId.id, contextName: byId.displayName };
    return { status: "missing" };
}

/** A group of this tenant for a placement of the file: by its id only, since names change and are not unique */
export function matchGroupEntry(entry: AccessModelGroupEntry, groups: readonly { id: string; displayName: string }[]): GroupMatch {
    const id = entry.groupId.toLowerCase();
    const found = groups.find((g) => g.id.toLowerCase() === id);
    return found ? { status: "byId", groupId: found.id, groupName: found.displayName } : { status: "missing" };
}

export interface LabelRow {
    entry: AccessModelLabelEntry;
    match: LabelMatch;
    /** The choice the admin has now for the label, null for none */
    current: string | null;
}

export interface GroupRow {
    entry: AccessModelGroupEntry;
    match: GroupMatch;
    current: GroupPlacement | null;
}

/** Every row of the file against this tenant and the choices as they stand (what the import screen shows) */
export function planAccessModelImport(
    file: AccessModelFile,
    tenant: { tenantId: string; contexts: readonly TenantContext[]; groups: readonly { id: string; displayName: string }[]; contextChoices: Readonly<Record<string, string>>; groupPlacements: Readonly<Record<string, GroupPlacement>> },
): { sameTenant: boolean; labels: LabelRow[]; groups: GroupRow[] } {
    const sameTenant = file.tenant.id !== "" && file.tenant.id.toLowerCase() === tenant.tenantId.toLowerCase();
    return {
        sameTenant,
        labels: file.labels.map((entry) => ({ entry, match: matchLabelEntry(entry, tenant.contexts, sameTenant), current: tenant.contextChoices[entry.label] ?? null })),
        groups: file.groups.map((entry) => {
            const match = matchGroupEntry(entry, tenant.groups);
            const id = match.status === "byId" ? match.groupId.toLowerCase() : null;
            const key = id ? Object.keys(tenant.groupPlacements).find((k) => k.toLowerCase() === id) : undefined;
            return { entry, match, current: key ? tenant.groupPlacements[key] : null };
        }),
    };
}
