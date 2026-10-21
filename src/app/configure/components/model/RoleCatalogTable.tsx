"use client";

import { useMemo, useState } from "react";
import { Tag } from "@/components/ui/Tag";
import { PLANES, REASON_TEXT, SECURITY_LEVELS, type CatalogReason, type Plane, type SecurityLevel } from "@/utils/accessModelCatalog";
import { EMPTY_ROLE_FILTER, ROLES_INTRO, countGrid, filterCatalogRoles, toggleCell, type CatalogRoleRow } from "@/utils/accessModelView";
import type { AccessModelCatalog } from "@/utils/accessModelCatalog";
import { WhyDisclosure } from "./WhyDisclosure";

interface RoleCatalogTableProps {
    catalog: AccessModelCatalog;
    rows: readonly CatalogRoleRow[];
    tenantName: string;
}

/** A tenant has 145 roles in the catalog: the table folds */
const FOLD = 40;
const REASONS: readonly CatalogReason[] = ["isPrivileged", "fullControl", "permissions"];
const SELECT = "h-[34px] rounded border border-line bg-surface px-2 text-[13px] text-ink max-sm:h-11";

/** "All roles in the catalog" (spec 8): the plane by level count grid as filter buttons, the filters and the role table */
export function RoleCatalogTable({ catalog, rows, tenantName }: RoleCatalogTableProps) {
    const [filter, setFilter] = useState(EMPTY_ROLE_FILTER);
    // "Show all" holds for the filter it was chosen under; a new filter folds the table again
    const [unfoldedFor, setUnfoldedFor] = useState<string | null>(null);
    const filterKey = JSON.stringify(filter);
    const isUnfolded = unfoldedFor === filterKey;
    const grid = useMemo(() => countGrid(catalog), [catalog]);
    const shown = useMemo(() => filterCatalogRoles(rows, filter), [rows, filter]);
    const visible = isUnfolded ? shown : shown.slice(0, FOLD);

    return (
        <section aria-labelledby="model-roles-title" className="rounded border border-line bg-surface p-4 sm:p-5">
            <h2 id="model-roles-title" className="text-base font-semibold text-ink">All roles in the catalog</h2>
            <p className="mt-2 text-[13px] text-body">{ROLES_INTRO}</p>

            <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[420px] text-left text-[13px]">
                    <caption className="sr-only">Roles per plane and level. Choose a count to filter the table below.</caption>
                    <thead>
                        <tr className="text-xs text-muted">
                            <th scope="col" className="py-2 pr-3 font-semibold">Plane</th>
                            {SECURITY_LEVELS.map((l) => <th key={l} scope="col" className="py-2 pr-3 text-center font-semibold">{l}</th>)}
                            <th scope="col" className="py-2 text-center font-semibold">All</th>
                        </tr>
                    </thead>
                    <tbody>
                        {grid.rows.map((row) => (
                            <tr key={row.plane} className="border-t border-line">
                                <th scope="row" className="py-2 pr-3 font-semibold text-ink">{row.plane}</th>
                                {row.cells.map((cell) => {
                                    const isOn = filter.plane === row.plane && filter.level === cell.level;
                                    return (
                                        <td key={cell.level} className="py-2 pr-3 text-center">
                                            <button
                                                type="button"
                                                aria-pressed={isOn}
                                                disabled={cell.count === 0}
                                                aria-label={`${row.plane}, ${cell.level}: ${cell.count} ${cell.count === 1 ? "role" : "roles"}`}
                                                onClick={() => setFilter(toggleCell(filter, row.plane as Plane, cell.level as SecurityLevel))}
                                                className={`h-9 min-w-14 rounded border px-2 text-ink tabular-nums max-sm:h-11 ${isOn ? "border-accent bg-accent-tint" : "border-line bg-surface hover:bg-page"} disabled:text-muted disabled:hover:bg-surface`}
                                            >
                                                {cell.count}
                                            </button>
                                        </td>
                                    );
                                })}
                                <td className="py-2 text-center text-body tabular-nums">{row.total}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
                <label className="relative min-w-48 flex-1">
                    <span className="sr-only">Search roles</span>
                    <input
                        type="search"
                        value={filter.query}
                        onChange={(e) => setFilter({ ...filter, query: e.target.value })}
                        placeholder="Search roles"
                        className="h-[34px] w-full rounded border border-line bg-surface px-3 text-[13px] text-ink placeholder:text-muted max-sm:h-11"
                    />
                </label>
                <select aria-label="Plane" className={SELECT} value={filter.plane ?? ""} onChange={(e) => setFilter({ ...filter, plane: (e.target.value || null) as Plane | null })}>
                    <option value="">Every plane</option>
                    {PLANES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <select aria-label="Level" className={SELECT} value={filter.level ?? ""} onChange={(e) => setFilter({ ...filter, level: (e.target.value || null) as SecurityLevel | null })}>
                    <option value="">Every level</option>
                    {SECURITY_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
                <select aria-label="Reason" className={SELECT} value={filter.reason ?? ""} onChange={(e) => setFilter({ ...filter, reason: (e.target.value || null) as CatalogReason | null })}>
                    <option value="">Every reason</option>
                    {REASONS.map((r) => <option key={r} value={r}>{REASON_TEXT[r]}</option>)}
                </select>
                <span className="text-xs text-muted tabular-nums">{`${shown.length} ${shown.length === 1 ? "role" : "roles"}`}</span>
            </div>

            <div className="mt-3 overflow-x-auto" tabIndex={0} role="region" aria-label="Role table">
                <table className="w-full min-w-[900px] text-left text-[13px]">
                    <caption className="sr-only">Roles in the catalog with their plane, level and recommended settings</caption>
                    <thead>
                        <tr className="text-xs text-muted">
                            <th scope="col" className="py-2 pr-3 font-semibold">Role</th>
                            <th scope="col" className="py-2 pr-3 font-semibold">Plane</th>
                            <th scope="col" className="py-2 pr-3 font-semibold">Level</th>
                            <th scope="col" className="py-2 pr-3 font-semibold">Why this level</th>
                            <th scope="col" className="py-2 pr-3 font-semibold">Privileged</th>
                            <th scope="col" className="py-2 pr-3 font-semibold">Recommended</th>
                            <th scope="col" className="py-2 font-semibold">{tenantName}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {visible.map((row) => (
                            <tr key={row.templateId} className="border-t border-line align-top">
                                <th scope="row" className="py-2.5 pr-3 text-left font-semibold text-ink">
                                    {row.name}
                                    <WhyDisclosure why={row.why} />
                                </th>
                                {/* Spec 8: plane and level are the reviewed part of the catalog (C2-06) */}
                                <td className="py-2.5 pr-3 text-ink">{row.plane}<span className="block text-xs text-muted">reviewed</span></td>
                                <td className="py-2.5 pr-3 text-ink">{row.level}<span className="block text-xs text-muted">reviewed</span></td>
                                <td className="py-2.5 pr-3 text-ink">{row.reasonText}</td>
                                <td className="py-2.5 pr-3 text-ink">{row.privileged}<span className="block text-xs text-muted">from Microsoft</span></td>
                                <td className="py-2.5 pr-3 text-ink">{row.recommended}<span className="block text-xs text-muted">by rule</span></td>
                                <td className="py-2.5">
                                    {row.tenant.kind === "looksRight" && <Tag variant="accent" icon="check">Looks right</Tag>}
                                    {row.tenant.kind === "differs" && <Tag variant="warn">{`${row.tenant.count} ${row.tenant.count === 1 ? "setting differs" : "settings differ"}`}</Tag>}
                                </td>
                            </tr>
                        ))}
                        {shown.length === 0 && <tr className="border-t border-line"><td colSpan={7} className="py-6 text-center text-sm text-body">No roles match this filter.</td></tr>}
                    </tbody>
                </table>
            </div>
            {!isUnfolded && shown.length > FOLD && (
                <button type="button" onClick={() => setUnfoldedFor(filterKey)} className="mt-2 rounded text-xs text-accent underline underline-offset-2 hover:no-underline max-sm:min-h-11">{`Show all ${shown.length} roles`}</button>
            )}
        </section>
    );
}
