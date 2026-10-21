"use client";

import { useMemo } from "react";
import { Icon } from "@/components/icons/Icon";
import { Button } from "@/components/ui/Button";
import { StatusBox } from "@/components/ui/StatusBox";
import type { RoleDetailData } from "@/types/directoryRole.types";
import type { PimGroupData } from "@/types/pimGroup.types";
import type { AccessModelCatalogStatus } from "@/hooks/useAccessModelCatalog";
import { PLANES, contextsMeetingLabel, type ConditionalAccessPolicyLike, type LoadedCatalog } from "@/utils/accessModelCatalog";
import { INTERPRETATION, LEVEL_RULES, PLANE_NOTE, PLANE_TEXT, catalogLine, catalogRoleRows, groupPlacementRows, levelRuleCounts, levelSettingRows } from "@/utils/accessModelView";
import { GroupPlacement as GroupPlacementSection } from "./GroupPlacement";
import { LevelTable } from "./LevelTable";
import { RoleCatalogTable } from "./RoleCatalogTable";
import { matchContext, type GroupPlacement, type TenantContext } from "@/utils/authContextSlug";
import { accessModelFileName, buildAccessModelFile, serializeAccessModelFile } from "@/utils/accessModelFile";
import { buildRoleCsv, buildRoleCsvRows } from "@/utils/accessModelRoleCsv";
import { CSV_BOM } from "@/utils/exportSchema";
import { downloadText } from "@/utils/download";

/** What the access model page gets from its container (the app page or the fixture route) */
export interface ModelData {
    /** The catalog as read (live or the bundled copy); null while it is read */
    loaded: LoadedCatalog | null;
    status: AccessModelCatalogStatus;
    onRetry: () => void;
    /** The tenant id and name (null while the name is not read): the export file names the tenant */
    tenantId: string;
    tenantName: string;
    tenantDisplayName: string | null;
    /** The roles as loaded (descriptions, the tenant comparison) */
    roles: RoleDetailData[];
    /** Every group (under PIM and outside it), for the placement of spec 9.4 */
    groups: PimGroupData[];
    /** The tenant's authentication contexts */
    contexts: TenantContext[];
    /** The admin's own label choices (`pim-access-model-contexts:{tenantId}`) */
    contextChoices: Readonly<Record<string, string>>;
    /** The admin's group placements (`pim-access-model-groups:{tenantId}`) */
    groupPlacements: Readonly<Record<string, GroupPlacement>>;
    onPlaceGroup: (groupId: string, placement: GroupPlacement | null) => void;
    /** Keeps the admin's context for a catalog label (`pim-access-model-contexts:{tenantId}`, spec 9.3) */
    onChooseContext: (slug: string, contextId: string | null) => void;
    /** The tenant's Conditional Access policies when they could be read: the second step of the label matching (9.3) */
    conditionalAccessPolicies: readonly ConditionalAccessPolicyLike[] | null;
    now: Date;
}

/**
 * Saves the admin's label choices and group placements as a file, to read back with Import a file. The file holds the
 * names next to the ids; nothing is sent anywhere, the browser downloads it.
 */
function ChoicesExport({ data }: { data: ModelData }) {
    const choiceCount = Object.keys(data.contextChoices).length + Object.keys(data.groupPlacements).length;
    const catalog = data.loaded?.catalog ?? null;
    // A label to the tenant's context, as the compare and the Settings page match it (own choice, name, then Conditional Access)
    const resolveContext = (slug: string): string | null => {
        const label = catalog?.authContexts.find((c) => c.slug === slug);
        const byPolicy = label && data.conditionalAccessPolicies ? contextsMeetingLabel(label, data.conditionalAccessPolicies) : undefined;
        const match = matchContext(slug, data.contexts, data.contextChoices, byPolicy);
        return match.kind === "chosen" || match.kind === "byName" || match.kind === "byPolicy" ? match.contextId : null;
    };
    const exportRoleSettings = () => {
        if (!catalog) return;
        const rows = buildRoleCsvRows({ catalog, roles: data.roles, resolveContext });
        const date = new Date().toISOString().slice(0, 10);
        const tenant = data.tenantDisplayName ? data.tenantDisplayName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") : "tenant";
        const preamble = [`Recommended role settings from the PIM Monitor access model, for ${data.tenantDisplayName ?? "this tenant"}, exported ${date}.`, "Empty cells keep the current setting. Import this file with Import a file under Configure."];
        downloadText(buildRoleCsv(rows, preamble), `pim-manager-access-model-roles-${tenant}-${date}.csv`, "text/csv;charset=utf-8", CSV_BOM);
    };
    const exportChoices = () => {
        const file = buildAccessModelFile({
            tenantId: data.tenantId,
            tenantName: data.tenantDisplayName,
            exportedAt: new Date(),
            contextChoices: data.contextChoices,
            groupPlacements: data.groupPlacements,
            contexts: data.contexts,
            groups: data.groups.map((g) => ({ id: g.group.id, displayName: g.group.displayName })),
        });
        downloadText(serializeAccessModelFile(file), accessModelFileName(file), "application/json;charset=utf-8");
    };
    return (
        <section aria-labelledby="model-export-title" className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded border border-line bg-surface p-4 sm:p-5">
            <div className="min-w-0 flex-1">
                <h2 id="model-export-title" className="text-sm font-semibold text-ink">Export</h2>
                <p className="mt-0.5 text-xs text-body">The recommended role settings as a CSV you can edit before you import it. Or the label choices and group placements above as JSON, to import again.</p>
            </div>
            <Button variant="primary" disabled={!catalog || data.roles.length === 0} onClick={exportRoleSettings}>
                Export the role settings (CSV)
            </Button>
            <Button disabled={choiceCount === 0} onClick={exportChoices}>
                {choiceCount === 0 ? "No choices to export yet" : "Export the choices (JSON)"}
            </Button>
        </section>
    );
}

/**
 * The access model page (spec 8, NG-73): the interpretation notice and the catalog line, plane and level, the
 * recommended settings per level, the groups (spec 9.4) and every role in the catalog. A reference page: nothing here
 * writes to a tenant. "Use as a template" is in the head of the page (ConfigureView), which opens Guided.
 */
export function ModelPage({ data }: { data: ModelData }) {
    const catalog = data.loaded?.catalog ?? null;
    const levelRows = useMemo(() => (catalog ? levelSettingRows(catalog, data.contexts, data.contextChoices, data.conditionalAccessPolicies) : []), [catalog, data.contexts, data.contextChoices, data.conditionalAccessPolicies]);
    const roleRows = useMemo(() => (catalog ? catalogRoleRows(catalog, data.roles, data.contexts, data.contextChoices, data.conditionalAccessPolicies) : []), [catalog, data.roles, data.contexts, data.contextChoices, data.conditionalAccessPolicies]);
    const counts = useMemo(() => (catalog ? levelRuleCounts(catalog) : null), [catalog]);
    const placementRows = useMemo(() => (catalog ? groupPlacementRows(catalog, data.groups, data.roles, data.groupPlacements) : []), [catalog, data.groups, data.roles, data.groupPlacements]);

    if (!data.loaded || !catalog || !counts) {
        if (data.status === "failed") {
            return (
                <StatusBox variant="error" title="Could not read the catalog" action={<Button onClick={data.onRetry}>Try again</Button>}>
                    The access model catalog could not be read and no copy is available. Try again.
                </StatusBox>
            );
        }
        return (
            <p role="status" className="flex items-center gap-2 rounded border border-line bg-surface px-4 py-6 text-sm text-body">
                <Icon name="spinner" size={16} />
                Reading the catalog…
            </p>
        );
    }

    return (
        <div className="flex flex-col gap-4">
            <section aria-label="About this classification" className="rounded border border-line bg-page p-4 sm:p-5">
                <div className="flex items-start gap-3">
                    <Icon name="info" size={16} className="mt-0.5 text-body" />
                    <div className="max-w-3xl text-[13px] leading-5 text-body">
                        <p className="font-semibold text-ink">{INTERPRETATION.title}</p>
                        <p className="mt-1">{INTERPRETATION.text}</p>
                        <p className="mt-2">{catalogLine(data.loaded, data.now)}</p>
                    </div>
                </div>
            </section>

            <div className="grid gap-4 min-[900px]:grid-cols-2">
                <section aria-labelledby="model-plane-title" className="rounded border border-line bg-surface p-4 sm:p-5">
                    <h2 id="model-plane-title" className="text-base font-semibold text-ink">Plane: what a role governs</h2>
                    <dl className="mt-3 text-[13px]">
                        {PLANES.map((plane) => (
                            <div key={plane} className="grid grid-cols-[6.5rem_1fr] gap-3 border-t border-line py-2.5 first:border-t-0">
                                <dt className="font-semibold text-ink">{plane}</dt>
                                <dd className="text-body">{PLANE_TEXT[plane]}</dd>
                            </div>
                        ))}
                    </dl>
                    <p className="mt-2 text-[13px] text-body">{PLANE_NOTE}</p>
                </section>
                <section aria-labelledby="model-level-title" className="rounded border border-line bg-surface p-4 sm:p-5">
                    <h2 id="model-level-title" className="text-base font-semibold text-ink">Level: how strict, decided in this order</h2>
                    <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5 text-[13px] leading-5 text-body">
                        {LEVEL_RULES.map((rule) => (
                            <li key={rule.reason}>
                                <span className="font-semibold text-ink">{rule.title}</span>{` ${rule.text} ${counts[rule.reason]} ${counts[rule.reason] === 1 ? "role" : "roles"}.`}
                            </li>
                        ))}
                    </ol>
                </section>
            </div>

            <LevelTable rows={levelRows} tenantName={data.tenantName} hasNoGroupTemplate={catalog.groups.length === 0} />
            <GroupPlacementSection rows={placementRows} onPlace={data.onPlaceGroup} />
            <ChoicesExport data={data} />
            <RoleCatalogTable catalog={catalog} rows={roleRows} tenantName={data.tenantName} />
        </div>
    );
}
