/**
 * The access model page as data (spec 8, 9.4; NG-73): the fixed texts of the board, the catalog line, the level rules
 * with their counts, the recommended settings per level with the tenant's matched context, the plane by level count
 * grid, a row per catalog role with "Why" and how the tenant compares, the filters, and the placement of groups.
 * Pure; `app/configure/components/model` draws it.
 */
import type { RoleDetailData } from "@/types/directoryRole.types";
import type { PimGroupData } from "@/types/pimGroup.types";
import {
    PLANES,
    SECURITY_LEVELS,
    REASON_TEXT,
    configToSetToValues,
    contextsMeetingLabel,
    proposeGroupPlacement,
    reasonForLevel,
    type AccessModelCatalog,
    type CatalogReason,
    type ConditionalAccessPolicyLike,
    type ExpectedConfig,
    type GroupPlacementProposal,
    type LoadedCatalog,
    type Plane,
    type SecurityLevel,
} from "@/utils/accessModelCatalog";
import { matchContext, type GroupPlacement, type TenantContext } from "@/utils/authContextSlug";
import { readTargetSettings } from "@/utils/configureSettingRows";
import { describeActivationDuration } from "@/utils/configureTargets";
import { formatTime } from "@/utils/configureStart";
import { getRolesHeldByGroups } from "@/utils/groupsOutsidePim";
import { readSettingValue, settingValuesEqualFor } from "@/utils/policyRules";

// ---------------------------------------------------------------------------------------------------------------------
// Fixed texts (the board of round 10)

export const INTERPRETATION = {
    title: "This is an interpretation, not a Microsoft classification.",
    text: "Microsoft's Enterprise Access Model describes planes and security levels, but Microsoft does not assign a plane or level to each role. Per role it only publishes whether the role is privileged. Plane, level and the recommended settings below are PIM Monitor's reading of the role permissions. Weigh them against your own risk before you apply them.",
};

export const PLANE_TEXT: Record<Plane, string> = {
    Control: "Identity, authentication and authorization. A compromise changes who can access what, tenant-wide.",
    Management: "One workload or the hosting infrastructure, such as Intune, Exchange, SharePoint or Defender.",
    Data: "Mostly reading or serving business data, telemetry or end-user support.",
};

export const PLANE_NOTE = "Identity and security permissions outrank workload permissions. Read-only does not lower the plane; it lowers the level.";

export const LEVEL_RULES: ReadonlyArray<{ reason: CatalogReason; title: string; text: string }> = [
    { reason: "isPrivileged", title: "Microsoft marks it privileged.", text: "Then it is at least Privileged, whatever else applies." },
    { reason: "fullControl", title: "Full control of a workload.", text: "All mailboxes, all sites or all source code count as a privileged blast radius, such as Exchange or SharePoint Administrator." },
    { reason: "permissions", title: "Otherwise its permissions decide.", text: "Administering a bounded service or changing access settings is Specialized; reading, end-user and support actions are Enterprise." },
];

export const LEVEL_TABLE_NOTE = (tenant: string) => `Microsoft publishes no values per role. PIM Monitor pins Microsoft's general guidance to a level. The labels are matched to ${tenant}'s authentication contexts by name.`;
export const NO_GROUP_TEMPLATE = "The catalog has no settings per group yet, so Configure offers no group template. You can still place each group; the place is kept for Guided.";
export const ROLES_INTRO = "Choose a cell to filter. Where each value comes from: from Microsoft (privileged or not), reviewed (plane and level, read from the permissions), by rule (settings, from the level).";

/** Short names of the known labels, as the board shows them; other labels show their description or slug */
const LABEL_NAMES: Record<string, string> = {
    "phish-resistant-sif": "Phishing-resistant + sign-in frequency",
    "phish-resistant-no-sif": "Phishing-resistant",
    "phish-resistant-compliant-device": "Phishing-resistant on a compliant device",
    "phish-resistant-compliant-device-sif": "Phishing-resistant on a compliant device + sign-in frequency",
};

// ---------------------------------------------------------------------------------------------------------------------
// The catalog line and the level rules

/** "Catalog of {version} from pimmonitor.com, read after sign-in at {time}." or the fallback line (spec 8) */
export function catalogLine(loaded: LoadedCatalog, now: Date): string {
    const version = loaded.catalog.catalogVersion;
    if (loaded.origin === "live") return `Catalog of ${version} from pimmonitor.com, read after sign-in at ${formatTime(loaded.readAt, now)}.`;
    if (loaded.fallbackReason === "newerVersion") return `This catalog needs a newer PIM Manager. Catalog of ${version} that ships with this PIM Manager version is used.`;
    return `Catalog of ${version} that ships with this PIM Manager version. pimmonitor.com could not be reached.`;
}

export function levelRuleCounts(catalog: AccessModelCatalog): Record<CatalogReason, number> {
    const counts: Record<CatalogReason, number> = { isPrivileged: 0, fullControl: 0, permissions: 0 };
    for (const role of catalog.roles) counts[reasonForLevel(role)] += 1;
    return counts;
}

// ---------------------------------------------------------------------------------------------------------------------
// Recommended settings per level

export function labelName(slug: string, catalog: AccessModelCatalog): string {
    return LABEL_NAMES[slug] ?? catalog.authContexts.find((c) => c.slug === slug)?.description ?? slug;
}

/** "1 hour, approval, Phishing-resistant + sign-in frequency"; "8 hours, no approval, Standard MFA" */
export function describeConfig(config: ExpectedConfig, catalog: AccessModelCatalog): string {
    const parts: string[] = [];
    const duration = describeActivationDuration(config.maxActivationDuration);
    if (duration) parts.push(duration);
    if (config.requireApproval !== undefined) parts.push(config.requireApproval ? "approval" : "no approval");
    if (config.authContext) parts.push(labelName(config.authContext, catalog));
    else if (config.requireMFA === true) parts.push("Standard MFA");
    else if (config.requireMFA === false) parts.push("nothing on activation");
    return parts.join(", ");
}

const yesNo = (v: boolean | undefined) => (v === undefined ? "Keep" : v ? "Yes" : "No");

export interface LevelSettingRow {
    key: string;
    /** "Privileged", or "Control · Privileged" when the planes of a level differ */
    level: string;
    maxActivation: string;
    approval: string;
    justification: string;
    /** The catalog label, or "Standard MFA" / "Nothing" without one */
    label: { text: string; slug: string | null };
    /** The tenant's context for the label: matched by name, by policy, chosen, or null when not matched (no label: null) */
    inTenant: { name: string; how: "byName" | "byPolicy" | "chosen" } | { name: null; how: "notMatched" } | null;
}

/** The contexts whose enabled Conditional Access policies meet a label (spec 9.3, second step; C2-03); none without the read */
type ByPolicy = (slug: string) => string[] | undefined;
function byPolicyOf(catalog: AccessModelCatalog, policies: readonly ConditionalAccessPolicyLike[] | null | undefined): ByPolicy {
    return (slug) => {
        const label = catalog.authContexts.find((c) => c.slug === slug);
        return label && policies ? contextsMeetingLabel(label, policies) : undefined;
    };
}

const sameConfig = (a: ExpectedConfig, b: ExpectedConfig) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

function levelRow(key: string, level: string, config: ExpectedConfig, catalog: AccessModelCatalog, contexts: readonly TenantContext[], chosen: Readonly<Record<string, string>>, byPolicy: ByPolicy): LevelSettingRow {
    let inTenant: LevelSettingRow["inTenant"] = null;
    if (config.authContext) {
        const match = matchContext(config.authContext, contexts, chosen, byPolicy(config.authContext));
        inTenant = match.kind === "byName" || match.kind === "byPolicy" || match.kind === "chosen"
            ? { name: contexts.find((c) => c.id === match.contextId)?.displayName ?? match.contextId, how: match.kind }
            : { name: null, how: "notMatched" };
    }
    return {
        key,
        level,
        maxActivation: describeActivationDuration(config.maxActivationDuration) ?? "Keep",
        approval: yesNo(config.requireApproval),
        justification: yesNo(config.requireJustification),
        label: config.authContext
            ? { text: labelName(config.authContext, catalog), slug: config.authContext }
            : { text: config.requireMFA === true ? "Standard MFA" : config.requireMFA === false ? "Nothing" : "Keep", slug: null },
        inTenant,
    };
}

/** One row per level when the three planes recommend the same, else one row per plane and level (spec 8) */
export function levelSettingRows(catalog: AccessModelCatalog, contexts: readonly TenantContext[], chosen: Readonly<Record<string, string>>, policies?: readonly ConditionalAccessPolicyLike[] | null): LevelSettingRow[] {
    const rows: LevelSettingRow[] = [];
    const byPolicy = byPolicyOf(catalog, policies);
    for (const level of SECURITY_LEVELS) {
        const cells = PLANES.map((plane) => catalog.levels.find((l) => l.plane === plane && l.securityLevel === level)).filter((c): c is NonNullable<typeof c> => !!c);
        if (cells.length === 0) continue;
        if (cells.every((c) => sameConfig(c.expectedConfig, cells[0].expectedConfig))) rows.push(levelRow(level, level, cells[0].expectedConfig, catalog, contexts, chosen, byPolicy));
        else for (const c of cells) rows.push(levelRow(`${c.plane}-${level}`, `${c.plane} · ${level}`, c.expectedConfig, catalog, contexts, chosen, byPolicy));
    }
    return rows;
}

// ---------------------------------------------------------------------------------------------------------------------
// The count grid and the role table

export interface CountGrid {
    rows: { plane: Plane; cells: { level: SecurityLevel; count: number }[]; total: number }[];
    total: number;
}

export function countGrid(catalog: AccessModelCatalog): CountGrid {
    return {
        rows: PLANES.map((plane) => {
            const cells = SECURITY_LEVELS.map((level) => ({ level, count: catalog.roles.filter((r) => r.plane === plane && r.securityLevel === level).length }));
            return { plane, cells, total: cells.reduce((sum, c) => sum + c.count, 0) };
        }),
        total: catalog.roles.length,
    };
}

export type TenantComparison = { kind: "notLoaded" } | { kind: "looksRight" } | { kind: "differs"; count: number };

export interface CatalogRoleRow {
    templateId: string;
    name: string;
    plane: Plane;
    level: SecurityLevel;
    reason: CatalogReason;
    reasonText: string;
    privileged: "Yes" | "No";
    recommended: string;
    tenant: TenantComparison;
    why: { description: string | null; reasonText: string; note: string | null };
}

/**
 * How the role in the tenant compares with its recommended settings: the number of fields whose value differs. A role the
 * tenant does not have, or whose policy is not read, is "notLoaded"; a label without a context in the tenant is not
 * counted (it stays Keep, spec 9.3).
 */
export function compareRole(role: RoleDetailData | undefined, config: ExpectedConfig, contexts: readonly TenantContext[], chosen: Readonly<Record<string, string>>, byPolicy: ByPolicy = () => undefined): TenantComparison {
    const settings = role ? readTargetSettings(role.policy?.details?.rules) : null;
    if (!settings) return { kind: "notLoaded" };
    const { values } = configToSetToValues(config, (slug) => {
        const match = matchContext(slug, contexts, chosen, byPolicy(slug));
        return match.kind === "byName" || match.kind === "byPolicy" || match.kind === "chosen" ? match.contextId : null;
    });
    const count = values.filter((v) => !settingValuesEqualFor(v.field, readSettingValue(settings, v.field), v.to)).length;
    return count === 0 ? { kind: "looksRight" } : { kind: "differs", count };
}

export function catalogRoleRows(catalog: AccessModelCatalog, tenantRoles: readonly RoleDetailData[], contexts: readonly TenantContext[], chosen: Readonly<Record<string, string>>, policies?: readonly ConditionalAccessPolicyLike[] | null): CatalogRoleRow[] {
    const byPolicy = byPolicyOf(catalog, policies);
    const byTemplate = new Map<string, RoleDetailData>();
    for (const role of tenantRoles) byTemplate.set((role.definition.templateId ?? role.definition.id).toLowerCase(), role);
    return catalog.roles
        .map((role) => {
            const reason = reasonForLevel(role);
            const tenantRole = byTemplate.get(role.templateId.toLowerCase());
            return {
                templateId: role.templateId,
                name: role.displayName,
                plane: role.plane,
                level: role.securityLevel,
                reason,
                reasonText: REASON_TEXT[reason],
                privileged: role.isPrivileged ? "Yes" as const : "No" as const,
                recommended: describeConfig(role.expectedConfig, catalog),
                tenant: compareRole(tenantRole, role.expectedConfig, contexts, chosen, byPolicy),
                why: { description: tenantRole?.definition.description ?? null, reasonText: REASON_TEXT[reason], note: role.note ?? null },
            };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
}

export interface CatalogRoleFilter {
    plane: Plane | null;
    level: SecurityLevel | null;
    reason: CatalogReason | null;
    query: string;
}

export const EMPTY_ROLE_FILTER: CatalogRoleFilter = { plane: null, level: null, reason: null, query: "" };

export function filterCatalogRoles(rows: readonly CatalogRoleRow[], filter: CatalogRoleFilter): CatalogRoleRow[] {
    const q = filter.query.trim().toLowerCase();
    return rows.filter((r) => (!filter.plane || r.plane === filter.plane)
        && (!filter.level || r.level === filter.level)
        && (!filter.reason || r.reason === filter.reason)
        && (!q || r.name.toLowerCase().includes(q)));
}

/** A cell of the count grid as a filter: choosing the cell that is already the filter clears plane and level */
export function toggleCell(filter: CatalogRoleFilter, plane: Plane, level: SecurityLevel): CatalogRoleFilter {
    return filter.plane === plane && filter.level === level ? { ...filter, plane: null, level: null } : { ...filter, plane, level };
}

// ---------------------------------------------------------------------------------------------------------------------
// Groups (spec 9.4)

export interface GroupPlacementRow {
    groupId: string;
    name: string;
    /** "From {role}": the strictest place of the roles it holds; null without roles in the catalog */
    proposal: GroupPlacementProposal | null;
    /** The admin's own placement, kept per tenant; null when not placed */
    placement: GroupPlacement | null;
}

export function groupPlacementRows(catalog: AccessModelCatalog, groups: readonly PimGroupData[], roles: RoleDetailData[], stored: Readonly<Record<string, GroupPlacement>>): GroupPlacementRow[] {
    const templateOf = new Map(roles.map((r) => [r.definition.id, r.definition.templateId ?? r.definition.id]));
    // One pass over every role assignment for all groups (U-03), not one pass per group
    const heldBy = getRolesHeldByGroups(roles, groups.map((g) => g.group.id));
    return groups
        .map((g) => {
            const held = (heldBy.get(g.group.id.toLowerCase()) ?? []).map((h) => templateOf.get(h.roleId) ?? h.roleId);
            return { groupId: g.group.id, name: g.group.displayName, proposal: proposeGroupPlacement(catalog, held), placement: stored[g.group.id] ?? null };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
}
