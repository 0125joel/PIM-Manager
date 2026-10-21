"use client";

import { useId, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { Button } from "@/components/ui/Button";
import { downloadText } from "@/utils/download";
import { CSV_BOM } from "@/utils/exportSchema";
import { IMPORT_KINDS, type ImportKind } from "@/utils/importDetect";
import { buildReference, buildTemplate, type KindReference, type ReferenceBox } from "@/utils/importReference";

const ORDER: readonly ImportKind[] = ["roleAssignments", "groupAssignments", "rolePolicies", "groupPolicies", "accessModel", "accessModelChoices"];

function Box({ box }: { box: ReferenceBox }) {
    const isRequired = box.badge === "Required";
    return (
        <section aria-label={`${box.badge}: ${box.title}`} className={`min-w-0 rounded border bg-surface ${isRequired ? "border-ink" : "border-line"}`}>
            <div className="flex flex-wrap items-center gap-2 px-3 pt-3 pb-2">
                <span className={`inline-flex h-[22px] items-center rounded border px-1.5 text-[12px] font-medium ${isRequired ? "border-ink bg-ink text-surface" : "border-line bg-page text-body"}`}>{box.badge}</span>
                <h3 className="text-[13px] font-semibold text-ink">{box.title}</h3>
                {box.countLabel && <span className="ml-auto text-xs text-muted">{box.countLabel}</span>}
            </div>
            <div className="overflow-x-auto px-3 pb-3">
                <table className="w-full min-w-[460px] table-fixed text-left text-xs">
                    <colgroup><col className="w-[38%]" /><col className="w-[28%]" /><col className="w-[34%]" /></colgroup>
                    <thead>
                        <tr className="text-muted">
                            <th scope="col" className="py-1.5 pr-3 font-normal">Column</th>
                            <th scope="col" className="py-1.5 pr-3 font-normal">Valid values</th>
                            <th scope="col" className="py-1.5 font-normal">Notes</th>
                        </tr>
                    </thead>
                    <tbody>
                        {box.rows.map((row) => (
                            <tr key={row.header} className="border-t border-line align-top">
                                <th scope="row" className="py-2 pr-3 font-mono text-[12px] font-normal text-ink">{row.header}</th>
                                <td className="py-2 pr-3">
                                    <span className="flex flex-wrap gap-1">
                                        {row.values.map((v) => <code key={v} className="rounded border border-line bg-page px-1.5 py-0.5 font-mono text-[11px] text-ink">{v}</code>)}
                                    </span>
                                </td>
                                <td className="py-2 text-body">{row.note}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

function ReferenceBody({ reference }: { reference: KindReference }) {
    const left = reference.boxes.filter((b) => b.id === "required" || b.id === "activation");
    const right = reference.boxes.filter((b) => b.id !== "required" && b.id !== "activation");
    const template = buildTemplate(reference.kind);
    return (
        <div className="pb-4">
            <div className="grid items-start gap-3 min-[1100px]:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-3">{left.map((b) => <Box key={b.id} box={b} />)}</div>
                <div className="flex min-w-0 flex-col gap-3">{right.map((b) => <Box key={b.id} box={b} />)}</div>
            </div>
            {reference.kind !== "accessModel" && reference.kind !== "accessModelChoices" && (
                <>
                    <p className="mt-4 text-xs text-body">Leave an optional column out, or leave its cell empty, to keep the current value.</p>
                    <p className="mt-3 rounded bg-page px-3 py-2.5 text-xs text-body">From Excel, save as CSV UTF-8. Files with semicolons, as European Excel writes them, are recognised too.</p>
                </>
            )}
            {template && (
                <Button size="sm" className="mt-3" onClick={() => downloadText(template.csv, template.fileName, "text/csv;charset=utf-8", CSV_BOM)}>
                    Download the template
                </Button>
            )}
        </div>
    );
}

/** "What can I import?" (spec 7.1): one disclosure per type, the reference generated from `FILE_SCHEMAS` */
export function FileReference({ initialOpen = null }: { initialOpen?: ImportKind | null }) {
    const [open, setOpen] = useState<ImportKind | null>(initialOpen);
    const id = useId();
    return (
        <section aria-labelledby={`${id}-title`} className="rounded border border-line bg-surface p-4 sm:p-5">
            <h2 id={`${id}-title`} className="text-[13px] text-body">What can I import?</h2>
            <p className="mt-1 text-xs text-body">The files the Report exports as &quot;For Configure Import&quot; open here unchanged, and every column they hold is read. A template has the headers and one example row.</p>
            <ul className="mt-3 border-t border-line">
                {ORDER.filter((k) => IMPORT_KINDS.includes(k)).map((kind) => {
                    const reference = buildReference(kind);
                    const isOpen = open === kind;
                    const panelId = `${id}-${kind}`;
                    return (
                        <li key={kind} className="border-b border-line last:border-b-0">
                            <button
                                type="button"
                                aria-expanded={isOpen}
                                aria-controls={isOpen ? panelId : undefined}
                                onClick={() => setOpen(isOpen ? null : kind)}
                                className="flex w-full items-center gap-3 py-3 text-left max-sm:min-h-11"
                            >
                                <Icon name={isOpen ? "chevron-down" : "chevron-right"} size={16} className="text-body" />
                                <span className="min-w-0 flex-1 text-sm">
                                    <span className="font-semibold text-ink">{reference.label}</span>
                                    <span className="ml-2 text-xs text-body max-sm:hidden">{reference.description}</span>
                                </span>
                                <span className="shrink-0 text-xs text-muted">{`${reference.requiredCount} required`}</span>
                            </button>
                            {isOpen && <div id={panelId}><ReferenceBody reference={reference} /></div>}
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
