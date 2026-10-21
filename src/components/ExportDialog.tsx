"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { StatusBox } from "@/components/ui/StatusBox";
import { FILE_SCHEMAS, writeCsv, type ExportRow } from "@/utils/exportSchema";
import { buildExportReport, buildExportRows, defaultBlocks, EXPORT_BLOCKS, type ChartStyle, type ExportAudience, type ExportBlockKey, type ExportDetail, type ExportInput, type ExportOptions } from "@/utils/exportReport";
import { getErrorMessage } from "@/utils/errorUtils";
import { Logger } from "@/utils/logger";

type Format = "pdf" | "csv";

export interface ExportAvailability {
    directoryRoles: { available: boolean; count: number };
    pimGroups: { available: boolean; count: number };
    unmanagedGroups: { available: boolean };
    securityAlerts: { available: boolean };
}

interface ExportDialogProps {
    isOpen: boolean;
    onClose: () => void;
    /** Everything the dashboard knows; the dialog applies the options to it */
    input: Omit<ExportInput, "meta">;
    meta: Omit<ExportInput["meta"], "exportedAt">;
    /** What the page counts now: the starting point of the workload checkboxes */
    counting: ExportOptions["counting"];
    availability: ExportAvailability;
    /** The filter sentence of the page, empty when no filter is active */
    filterSentence: string;
}

const DETAILS: { value: ExportDetail; label: string; text: string }[] = [
    { value: "summary", label: "Summary", text: "One to two pages: key numbers, what needs attention, alerts and charts." },
    { value: "full", label: "Full", text: "Adds the roles, groups and accounts behind each item, and the definitions." },
    { value: "appendix", label: "Full with appendix", text: "Adds a landscape table of every assignment. Admin audience only." },
];

function download(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function fileStem(tenant: string | null, date: Date): string {
    const slug = (tenant ?? "tenant").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "tenant";
    return `pim-report-${slug}-${date.toISOString().slice(0, 10)}`;
}

function Group({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
    return (
        <fieldset className="min-w-0 border-0 p-0">
            <legend className="mb-2 p-0 text-sm font-semibold text-ink">{title}</legend>
            {hint && <p className="-mt-1 mb-2 text-xs text-muted">{hint}</p>}
            {children}
        </fieldset>
    );
}

function Check({ checked, onChange, disabled, label, hint }: { checked: boolean; onChange: (value: boolean) => void; disabled?: boolean; label: string; hint?: string }) {
    const id = useId();
    return (
        <div className="flex items-start gap-2">
            <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 rounded-[3px] accent-[var(--accent)] disabled:opacity-50" />
            <label htmlFor={id} className={`text-sm ${disabled ? "text-muted" : "text-ink"}`}>
                {label}
                {hint && <span className="block text-xs text-muted">{hint}</span>}
            </label>
        </div>
    );
}

/** The export menu (spec 3.5): PDF or CSV, detail, audience, names, charts, workloads, contents and the filter. */
export function ExportDialog({ isOpen, onClose, input, meta, counting: initialCounting, availability, filterSentence }: ExportDialogProps) {
    const [format, setFormat] = useState<Format>("pdf");
    const [detail, setDetail] = useState<ExportDetail>("full");
    const [audience, setAudience] = useState<ExportAudience>("admin");
    const [anonymise, setAnonymise] = useState(false);
    const [chartStyle, setChartStyle] = useState<ChartStyle>("bars");
    const [applyFilter, setApplyFilter] = useState(true);
    const [counting, setCounting] = useState(initialCounting);
    const [blocks, setBlocks] = useState(() => defaultBlocks("full"));
    const [isWorking, setIsWorking] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const radioName = useId();

    const isManagement = audience === "management";
    const effectiveDetail: ExportDetail = isManagement && detail === "appendix" ? "full" : detail;
    const options: ExportOptions = useMemo(() => ({ detail: effectiveDetail, audience, chartStyle, anonymise, applyFilter, counting, blocks }), [effectiveDetail, audience, chartStyle, anonymise, applyFilter, counting, blocks]);
    const hasFilter = filterSentence !== "";
    const isNothingCounted = !counting.directoryRoles && !counting.pimGroups;

    const chooseDetail = (value: ExportDetail) => {
        setDetail(value);
        setBlocks(defaultBlocks(value));
    };
    const chooseAudience = (value: ExportAudience) => {
        setAudience(value);
        if (value === "management" && detail === "appendix") chooseDetail("full");
    };

    const handleExport = async () => {
        setIsWorking(true);
        setError(null);
        const exportedAt = new Date();
        const fullInput: ExportInput = { ...input, meta: { ...meta, exportedAt } };
        try {
            if (format === "csv") {
                // The same columns as the Report's Overview assignments file (one schema, the first twelve unchanged)
                const csv = writeCsv(FILE_SCHEMAS.overviewAssignments, buildExportRows(fullInput, options) as unknown as ExportRow[]);
                download(new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" }), `${fileStem(meta.tenantName, exportedAt)}.csv`);
            } else {
                const report = buildExportReport(fullInput, options);
                const [{ pdf }, { ReportDocument, registerReportFonts }] = await Promise.all([import("@react-pdf/renderer"), import("@/components/pdf/ReportDocument")]);
                registerReportFonts(window.location.origin);
                const blob = await pdf(<ReportDocument report={report} chartStyle={chartStyle} />).toBlob();
                download(blob, `${fileStem(meta.tenantName, exportedAt)}.pdf`);
            }
            onClose();
        } catch (e) {
            Logger.error("ExportDialog", "Export failed", e);
            setError(getErrorMessage(e));
        } finally {
            setIsWorking(false);
        }
    };

    const workloads: { key: keyof ExportOptions["counting"]; label: string; hint?: string; available: boolean }[] = [
        { key: "directoryRoles", label: "Directory roles", hint: `${availability.directoryRoles.count} roles`, available: availability.directoryRoles.available },
        { key: "pimGroups", label: "PIM for Groups", hint: availability.pimGroups.available ? `${availability.pimGroups.count} groups` : "Not granted yet", available: availability.pimGroups.available },
        { key: "unmanagedGroups", label: "Groups outside PIM", available: availability.unmanagedGroups.available && counting.pimGroups },
        { key: "securityAlerts", label: "Security alerts", hint: availability.securityAlerts.available ? undefined : "Not granted yet", available: availability.securityAlerts.available },
    ];

    return (
        <Dialog isOpen={isOpen} onClose={onClose} title="Export" width={640}>
            <div className="flex max-h-[calc(100dvh-180px)] flex-col gap-5 overflow-y-auto pr-1">
                <Group title="Format">
                    <SegmentedControl<Format> variant="pill" ariaLabel="Format" value={format} onChange={setFormat} options={[{ value: "pdf", label: "PDF" }, { value: "csv", label: "CSV" }]} />
                    <p className="mt-2 text-xs text-muted">{format === "pdf" ? "A report you can hand to others." : "One row per assignment with name, UPN or mail and object id, for a spreadsheet."}</p>
                </Group>

                {format === "pdf" && (
                    <Group title="Detail">
                        <div role="radiogroup" aria-label="Detail" className="grid gap-2 sm:grid-cols-3">
                            {DETAILS.map((d) => {
                                const isDisabled = d.value === "appendix" && isManagement;
                                return (
                                    <label key={d.value} className={`flex cursor-pointer flex-col gap-1 rounded border p-3 text-sm ${effectiveDetail === d.value ? "border-accent bg-accent-tint" : "border-line bg-surface"} ${isDisabled ? "cursor-not-allowed opacity-50" : ""}`}>
                                        <span className="flex items-center gap-2 font-semibold text-ink">
                                            <input type="radio" name={radioName} checked={effectiveDetail === d.value} disabled={isDisabled} onChange={() => chooseDetail(d.value)} className="accent-[var(--accent)]" />
                                            {d.label}
                                        </span>
                                        <span className="text-xs text-body">{d.text}</span>
                                    </label>
                                );
                            })}
                        </div>
                    </Group>
                )}

                <div className="grid gap-5 sm:grid-cols-2">
                    <Group title="Audience">
                        <SegmentedControl<ExportAudience> variant="pill" ariaLabel="Audience" value={audience} onChange={chooseAudience} options={[{ value: "admin", label: "Admin" }, { value: "management", label: "Management" }]} />
                        <p className="mt-2 text-xs text-muted">{isManagement ? "Numbers and roles, no names of people." : "Names of people where they matter."}</p>
                        <div className="mt-3">
                            <Check checked={anonymise || isManagement} disabled={isManagement} onChange={setAnonymise} label="Replace names of people" hint="Person 1, Person 2, the same label everywhere. Groups, apps and roles keep their names." />
                        </div>
                    </Group>
                    {format === "pdf" && (
                        <Group title="Charts">
                            <SegmentedControl<ChartStyle> variant="pill" ariaLabel="Chart style" value={chartStyle} onChange={setChartStyle} options={[{ value: "bars", label: "Bars" }, { value: "donuts", label: "Donuts" }, { value: "tables", label: "Tables" }]} />
                            <p className="mt-2 text-xs text-muted">Every chart also prints its numbers.</p>
                        </Group>
                    )}
                </div>

                <Group title="What is counted">
                    <div className="grid gap-2 sm:grid-cols-2">
                        {workloads.map((w) => (
                            <Check key={w.key} checked={counting[w.key] && w.available} disabled={!w.available} onChange={(value) => setCounting((prev) => ({ ...prev, [w.key]: value }))} label={w.label} hint={w.hint} />
                        ))}
                    </div>
                    <div className="mt-3">
                        <Check checked={applyFilter && hasFilter} disabled={!hasFilter} onChange={setApplyFilter} label="Apply the current filter" hint={hasFilter ? filterSentence : "No filter is active."} />
                    </div>
                </Group>

                {format === "pdf" && (
                    <Group title="Contents" hint={`${effectiveDetail === "summary" ? "Summary" : "Full"} starts with the blocks below ticked; change them as you like.`}>
                        <div className="grid gap-2 sm:grid-cols-2">
                            {EXPORT_BLOCKS.map((b) => (
                                <Check key={b.key} checked={blocks[b.key]} onChange={(value) => setBlocks((prev) => ({ ...prev, [b.key as ExportBlockKey]: value }))} label={b.label} hint={b.hint} />
                            ))}
                        </div>
                    </Group>
                )}

                <p className="text-xs text-muted">The header of the document says what is counted, when the data was read, the filter, who exported and the version.</p>
                {error && <StatusBox variant="error" title="The export failed" onDismiss={() => setError(null)} dismissLabel="Dismiss: export error">{error}</StatusBox>}
            </div>
            <div className="mt-5 flex justify-end gap-2">
                <Button variant="secondary" onClick={onClose}>Cancel</Button>
                <Button variant="primary" isLoading={isWorking} disabled={isNothingCounted} onClick={() => void handleExport()}>{format === "pdf" ? "Export PDF" : "Export CSV"}</Button>
            </div>
        </Dialog>
    );
}
