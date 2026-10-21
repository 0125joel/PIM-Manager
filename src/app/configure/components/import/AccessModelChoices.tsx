"use client";

import { useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { StatusBox } from "@/components/ui/StatusBox";
import type { AccessModelFile } from "@/utils/accessModelFile";
import { planAccessModelImport, type GroupRow, type LabelRow } from "@/utils/accessModelFile";
import type { GroupPlacement, TenantContext } from "@/utils/authContextSlug";

interface AccessModelChoicesProps {
    file: AccessModelFile;
    tenantId: string;
    /** Entries the file held that could not be read, counted when the file was read */
    skipped: number;
    contexts: readonly TenantContext[];
    groups: readonly { id: string; displayName: string }[];
    /** False while the groups are not read: their placements are then not offered */
    groupsReady: boolean;
    groupsNote: string | null;
    contextChoices: Readonly<Record<string, string>>;
    groupPlacements: Readonly<Record<string, GroupPlacement>>;
    onChooseContext: (slug: string, contextId: string | null) => void;
    onPlaceGroup: (groupId: string, placement: GroupPlacement | null) => void;
    unchecked: ReadonlySet<string>;
    onToggle: (key: string) => void;
}

const labelKey = (label: string) => `label:${label}`;
const groupKey = (groupId: string) => `group:${groupId}`;

const LABEL_STATUS = {
    byName: "Matched by its name",
    byId: "Matched by its id",
    missing: "Not in this tenant",
} as const;

/** Where a row of the file stands in this tenant, as a short line for the admin */
function labelNote(row: LabelRow): string {
    if (row.match.status === "missing") return LABEL_STATUS.missing;
    if (row.current === row.match.contextId) return "Already set like this";
    return LABEL_STATUS[row.match.status];
}

/** A group that is placed like this already, or is not in this tenant, is not saved again */
function groupNeedsSave(row: GroupRow): boolean {
    if (row.match.status !== "byId") return false;
    const current = row.current;
    return !(current && current.plane === row.entry.plane && current.securityLevel === row.entry.securityLevel);
}

function groupNote(row: GroupRow, groupsReady: boolean): string {
    if (!groupsReady) return "Groups are not read";
    if (row.match.status === "missing") return "Not in this tenant";
    if (!groupNeedsSave(row)) return "Already set like this";
    return row.current ? "Placed, will be replaced" : "Not placed yet";
}

/**
 * "Import a file" for an access model file of PIM Manager: the label choices and group placements of the file, each row
 * matched against this tenant. Nothing is written to the tenant; "Save in this browser" keeps the ticked rows the way
 * the Access model page keeps them.
 */
export function AccessModelChoices({ file, tenantId, skipped, contexts, groups, groupsReady, groupsNote, contextChoices, groupPlacements, onChooseContext, onPlaceGroup, unchecked, onToggle }: AccessModelChoicesProps) {
    const id = useId();
    const [savedCount, setSavedCount] = useState<number | null>(null);
    const plan = useMemo(
        () => planAccessModelImport(file, { tenantId, contexts, groups, contextChoices, groupPlacements }),
        [file, tenantId, contexts, groups, contextChoices, groupPlacements],
    );
    const tenantName = file.tenant.name ?? "the file";
    const labelsToSave = plan.labels.filter((r) => r.match.status !== "missing" && r.current !== r.match.contextId && !unchecked.has(labelKey(r.entry.label)));
    const groupsToSave = plan.groups.filter((r) => groupNeedsSave(r) && groupsReady && !unchecked.has(groupKey(r.entry.groupId)));
    const toSave = labelsToSave.length + groupsToSave.length;
    const nothingInTenant = plan.labels.length + plan.groups.length > 0 && plan.labels.every((r) => r.match.status === "missing") && plan.groups.every((r) => r.match.status === "missing");

    const save = () => {
        for (const row of labelsToSave) if (row.match.status !== "missing") onChooseContext(row.entry.label, row.match.contextId);
        for (const row of groupsToSave) if (row.match.status === "byId") onPlaceGroup(row.match.groupId, { plane: row.entry.plane, securityLevel: row.entry.securityLevel });
        setSavedCount(toSave);
    };

    return (
        <div className="flex flex-col gap-4">
            {!plan.sameTenant && (
                <StatusBox variant="warn" title="This file is from another tenant">
                    {`It was exported from ${tenantName}. Labels are matched by their name only, and a group only when its id is in this tenant.`}
                </StatusBox>
            )}
            <section aria-labelledby={`${id}-title`} className="rounded border border-line bg-surface">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 p-4 sm:px-5">
                    <h2 id={`${id}-title`} className="text-sm font-semibold text-ink">{`Access model choices for ${tenantName}`}</h2>
                    <p className="text-xs text-body">{`Exported ${file.exportedAt ? file.exportedAt.slice(0, 10) : "at an unknown date"}. ${plan.labels.length} label ${plan.labels.length === 1 ? "choice" : "choices"} and ${plan.groups.length} group ${plan.groups.length === 1 ? "placement" : "placements"}.`}</p>
                </div>
                {plan.labels.length > 0 && (
                    <div className="overflow-x-auto border-t border-line">
                        <table className="w-full min-w-[560px] text-left text-sm">
                            <thead>
                                <tr className="text-xs text-muted">
                                    <th scope="col" className="w-12 py-2.5 pr-2 pl-4 font-normal sm:pl-5"><span className="sr-only">Use</span></th>
                                    <th scope="col" className="py-2.5 pr-3 font-normal">Label</th>
                                    <th scope="col" className="py-2.5 pr-3 font-normal">Authentication context in the file</th>
                                    <th scope="col" className="py-2.5 pr-4 font-normal sm:pr-5">In this tenant</th>
                                </tr>
                            </thead>
                            <tbody>
                                {plan.labels.map((row) => {
                                    const disabled = row.match.status === "missing";
                                    return (
                                        <tr key={row.entry.label} className="border-t border-line align-top">
                                            <td className="py-3 pl-4 sm:pl-5">
                                                <input
                                                    type="checkbox"
                                                    aria-label={`Label ${row.entry.label}`}
                                                    checked={!disabled && !unchecked.has(labelKey(row.entry.label))}
                                                    disabled={disabled}
                                                    onChange={() => onToggle(labelKey(row.entry.label))}
                                                    className="h-4 w-4 accent-(--accent)"
                                                />
                                            </td>
                                            <td className="py-3 pr-3 font-semibold text-ink">{row.entry.label}</td>
                                            <td className="py-3 pr-3 text-ink">{row.entry.contextName ?? row.entry.contextId}</td>
                                            <td className="py-3 pr-4 text-ink sm:pr-5">
                                                {row.match.status === "missing" ? (
                                                    <span className="text-body">{labelNote(row)}</span>
                                                ) : (
                                                    <span className="font-semibold">{row.match.contextName}</span>
                                                )}
                                                {row.match.status !== "missing" && <span className="mt-0.5 block text-xs text-body">{labelNote(row)}</span>}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
                {plan.groups.length > 0 && (
                    <div className="overflow-x-auto border-t border-line">
                        <table className="w-full min-w-[560px] text-left text-sm">
                            <thead>
                                <tr className="text-xs text-muted">
                                    <th scope="col" className="w-12 py-2.5 pr-2 pl-4 font-normal sm:pl-5"><span className="sr-only">Use</span></th>
                                    <th scope="col" className="py-2.5 pr-3 font-normal">Group</th>
                                    <th scope="col" className="py-2.5 pr-3 font-normal">Placement in the file</th>
                                    <th scope="col" className="py-2.5 pr-4 font-normal sm:pr-5">In this tenant</th>
                                </tr>
                            </thead>
                            <tbody>
                                {plan.groups.map((row) => {
                                    const disabled = row.match.status === "missing" || !groupsReady || !groupNeedsSave(row);
                                    const name = row.match.status === "byId" ? row.match.groupName : row.entry.groupName ?? row.entry.groupId;
                                    return (
                                        <tr key={row.entry.groupId} className="border-t border-line align-top">
                                            <td className="py-3 pl-4 sm:pl-5">
                                                <input
                                                    type="checkbox"
                                                    aria-label={`Group ${name}`}
                                                    checked={!disabled && !unchecked.has(groupKey(row.entry.groupId))}
                                                    disabled={disabled}
                                                    onChange={() => onToggle(groupKey(row.entry.groupId))}
                                                    className="h-4 w-4 accent-(--accent)"
                                                />
                                            </td>
                                            <td className="py-3 pr-3 font-semibold text-ink">{name}</td>
                                            <td className="py-3 pr-3 text-ink">{`${row.entry.plane}, ${row.entry.securityLevel}`}</td>
                                            <td className="py-3 pr-4 text-body sm:pr-5">{groupNote(row, groupsReady)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
                {plan.labels.length === 0 && plan.groups.length === 0 && (
                    <p className="border-t border-line px-4 py-6 text-center text-sm text-body sm:px-5">The file holds no choices.</p>
                )}
                {!groupsReady && groupsNote && plan.groups.length > 0 && (
                    <p className="border-t border-line px-4 py-3 text-xs text-body sm:px-5">{groupsNote}</p>
                )}
                {skipped > 0 && (
                    <p className="border-t border-line px-4 py-3 text-xs text-body sm:px-5">{`${skipped} ${skipped === 1 ? "entry" : "entries"} in the file could not be read and ${skipped === 1 ? "is" : "are"} left out.`}</p>
                )}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-line px-4 py-3 sm:px-5">
                    <p className="min-w-0 flex-1 text-xs text-body">The choices stay in this browser, as on the Access model page. Nothing is written to the tenant.</p>
                    <Button variant="primary" disabled={toSave === 0} onClick={save}>
                        {toSave === 0 ? "Nothing to save" : `Save ${toSave} ${toSave === 1 ? "choice" : "choices"} in this browser`}
                    </Button>
                </div>
            </section>
            {nothingInTenant && (
                <StatusBox variant="warn" title="None of the file matches this tenant">
                    The labels and groups in the file are not in this tenant. A file from another tenant only places what that tenant has too.
                </StatusBox>
            )}
            {savedCount !== null && (
                <p role="status" className="rounded border border-line bg-surface px-4 py-3 text-sm text-body">
                    {savedCount === 0 ? "Nothing was saved." : `${savedCount} ${savedCount === 1 ? "choice is" : "choices are"} saved in this browser. Open the Access model page to see them.`}
                </p>
            )}
        </div>
    );
}
