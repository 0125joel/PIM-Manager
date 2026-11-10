"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { StatusBox } from "@/components/ui/StatusBox";
import { writeCsv } from "@/utils/exportSchema";
import { AZURE_ASSIGNMENT_COLUMNS } from "@/utils/azureExportRows";
import { AZURE_EXPORT_BLOCKS, azureExportFileStem, buildAzureDashboardCsvRows, buildAzureDashboardExportReport, defaultAzureBlocks, type AzureDashboardExportInput, type AzureExportBlockKey, type AzureExportOptions } from "@/utils/azureDashboardExport";
import type { ChartStyle, ExportAudience } from "@/utils/exportReport";
import { getErrorMessage } from "@/utils/errorUtils";
import { Logger } from "@/utils/logger";

type Format = "pdf" | "csv";
type Detail = AzureExportOptions["detail"];

interface AzureDashboardExportDialogProps {
    isOpen: boolean;
    onClose: () => void;
    /** Everything the dashboard knows; the dialog applies the options to it */
    input: Omit<AzureDashboardExportInput, "meta">;
    meta: Omit<AzureDashboardExportInput["meta"], "exportedAt">;
}

const DETAILS: { value: Detail; label: string; text: string }[] = [
    { value: "summary", label: "Summary", text: "One to two pages: key numbers, what needs attention, alerts and charts." },
    { value: "full", label: "Full", text: "Adds the accounts and scopes behind each item, and the definitions." },
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

/** The export menu of the Azure dashboard (NG-104b): PDF or CSV, detail, audience, names, charts, what is counted, contents and the filter. Follows `ExportDialog`. */
export function AzureDashboardExportDialog({ isOpen, onClose, input, meta }: AzureDashboardExportDialogProps) {
    const [format, setFormat] = useState<Format>("pdf");
    const [detail, setDetail] = useState<Detail>("full");
    const [audience, setAudience] = useState<ExportAudience>("admin");
    const [anonymise, setAnonymise] = useState(false);
    const [chartStyle, setChartStyle] = useState<ChartStyle>("bars");
    const [applyFilter, setApplyFilter] = useState(true);
    const [blocks, setBlocks] = useState(() => defaultAzureBlocks("full"));
    const [isWorking, setIsWorking] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const radioName = useId();

    const isManagement = audience === "management";
    const effectiveDetail: Detail = isManagement && detail === "appendix" ? "full" : detail;
    const options: AzureExportOptions = useMemo(() => ({ detail: effectiveDetail, audience, chartStyle, anonymise, applyFilter, blocks }), [effectiveDetail, audience, chartStyle, anonymise, applyFilter, blocks]);
    const hasFilter = input.filterSentence !== "";
    const isNothingCounted = input.statsWithoutFilter.assignments.length === 0;

    const chooseDetail = (value: Detail) => {
        setDetail(value);
        setBlocks(defaultAzureBlocks(value));
    };
    const chooseAudience = (value: ExportAudience) => {
        setAudience(value);
        if (value === "management" && detail === "appendix") chooseDetail("full");
    };

    const handleExport = async () => {
        setIsWorking(true);
        setError(null);
        const exportedAt = new Date();
        const fullInput: AzureDashboardExportInput = { ...input, meta: { ...meta, exportedAt } };
        try {
            if (format === "csv") {
                // The same columns as the Azure Report's assignments file
                const csv = writeCsv({ columns: AZURE_ASSIGNMENT_COLUMNS }, buildAzureDashboardCsvRows(fullInput, options, input.stats.homeTenantId));
                download(new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" }), `${azureExportFileStem(meta.tenantName, exportedAt)}.csv`);
            } else {
                const report = buildAzureDashboardExportReport(fullInput, options);
                const [{ pdf }, { ReportDocument, registerReportFonts }] = await Promise.all([import("@react-pdf/renderer"), import("@/components/pdf/ReportDocument")]);
                registerReportFonts(window.location.origin);
                const blob = await pdf(<ReportDocument report={report} chartStyle={chartStyle} />).toBlob();
                download(blob, `${azureExportFileStem(meta.tenantName, exportedAt)}.pdf`);
            }
            onClose();
        } catch (e: unknown) {
            Logger.error("AzureDashboardExportDialog", "Export failed", e);
            setError(getErrorMessage(e));
        } finally {
            setIsWorking(false);
        }
    };

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
                            <Check checked={anonymise || isManagement} disabled={isManagement} onChange={setAnonymise} label="Replace names of people" hint="Person 1, Person 2, the same label everywhere. Groups, apps, managed identities and agents keep their names." />
                        </div>
                    </Group>
                    {format === "pdf" && (
                        <Group title="Charts">
                            <SegmentedControl<ChartStyle> variant="pill" ariaLabel="Chart style" value={chartStyle} onChange={setChartStyle} options={[{ value: "bars", label: "Bars" }, { value: "donuts", label: "Donuts" }, { value: "tables", label: "Tables" }]} />
                            <p className="mt-2 text-xs text-muted">Every chart also prints its numbers.</p>
                        </Group>
                    )}
                </div>

                <Group title="What is counted" hint="Change these in the scope bar.">
                    <ul className="flex flex-col gap-1 text-sm text-ink">
                        <li>{input.scopeLine}</li>
                        <li>Include inherited: {input.includeInherited ? "on" : "off"}</li>
                        <li>Delegated subscriptions: {input.includeDelegated ? "counted" : "left out"}</li>
                    </ul>
                    <div className="mt-3">
                        <Check checked={applyFilter && hasFilter} disabled={!hasFilter} onChange={setApplyFilter} label="Apply the current filter" hint={hasFilter ? input.filterSentence : "No filter is active."} />
                    </div>
                </Group>

                {format === "pdf" && (
                    <Group title="Contents" hint={`${detail === "summary" ? "Summary" : detail === "appendix" ? "Full with appendix" : "Full"} starts with the blocks below ticked; change them as you like.`}>
                        <div className="grid gap-2 sm:grid-cols-2">
                            {AZURE_EXPORT_BLOCKS.map((b) => (
                                <Check key={b.key} checked={blocks[b.key]} onChange={(value) => setBlocks((prev) => ({ ...prev, [b.key as AzureExportBlockKey]: value }))} label={b.label} hint={b.hint} />
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
