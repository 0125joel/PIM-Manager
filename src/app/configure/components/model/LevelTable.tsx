import { Tag } from "@/components/ui/Tag";
import { LEVEL_TABLE_NOTE, NO_GROUP_TEMPLATE, type LevelSettingRow } from "@/utils/accessModelView";

interface LevelTableProps {
    rows: readonly LevelSettingRow[];
    tenantName: string;
    /** The catalog has no group templates (a live file without them; the published 2026-10-03.1 has four): the line of spec 8 */
    hasNoGroupTemplate: boolean;
}

const HOW: Record<"byName" | "byPolicy" | "chosen", string> = { byName: "matched by name", byPolicy: "matched by policy", chosen: "chosen" };

/** "Recommended settings per level" (spec 8): the settings per level and the tenant's context for each catalog label */
export function LevelTable({ rows, tenantName, hasNoGroupTemplate }: LevelTableProps) {
    return (
        <section aria-labelledby="model-levels-title" className="rounded border border-line bg-surface p-4 sm:p-5">
            <h2 id="model-levels-title" className="text-base font-semibold text-ink">Recommended settings per level</h2>
            <p className="mt-2 text-[13px] text-body">{LEVEL_TABLE_NOTE(tenantName)}</p>
            <div className="mt-3 overflow-x-auto" tabIndex={0} role="region" aria-label="Level settings table">
                <table className="w-full min-w-[680px] text-left text-[13px]">
                    <caption className="sr-only">Recommended settings per level</caption>
                    <thead>
                        <tr className="text-xs text-muted">
                            <th scope="col" className="py-2 pr-3 font-semibold">Level</th>
                            <th scope="col" className="py-2 pr-3 font-semibold">Max activation</th>
                            <th scope="col" className="py-2 pr-3 font-semibold">Approval</th>
                            <th scope="col" className="py-2 pr-3 font-semibold">Justification</th>
                            <th scope="col" className="py-2 pr-3 font-semibold">Catalog label</th>
                            <th scope="col" className="py-2 font-semibold">{`In ${tenantName}`}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row) => (
                            <tr key={row.key} className="border-t border-line align-top">
                                <th scope="row" className="py-3 pr-3 font-semibold text-ink">{row.level}</th>
                                <td className="py-3 pr-3 text-ink">{row.maxActivation}</td>
                                <td className="py-3 pr-3 text-ink">{row.approval}</td>
                                <td className="py-3 pr-3 text-ink">{row.justification}</td>
                                <td className="py-3 pr-3 text-ink">
                                    {row.label.text}
                                    {row.label.slug && <span className="block font-mono text-xs text-muted">{row.label.slug}</span>}
                                </td>
                                <td className="py-3 text-ink">
                                    {row.inTenant && row.inTenant.how !== "notMatched" ? (
                                        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                                            {row.inTenant.name}
                                            <Tag variant="accent" icon="check">{HOW[row.inTenant.how]}</Tag>
                                        </span>
                                    ) : row.inTenant ? (
                                        <span className="text-warn-text">not matched</span>
                                    ) : row.label.text === "Standard MFA" ? "Multifactor authentication" : null}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {hasNoGroupTemplate && <p className="mt-3 text-[13px] text-body">{NO_GROUP_TEMPLATE}</p>}
        </section>
    );
}
