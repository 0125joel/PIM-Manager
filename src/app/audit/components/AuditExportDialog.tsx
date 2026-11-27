"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { StatusBox } from "@/components/ui/StatusBox";
import {
    AUDIT_EXPORT_INCLUDE_ALL,
    AUDIT_EXPORT_STORAGE_KEY,
    describeAuditScope,
    isAzureExport,
    parseStoredAuditExportChoice,
    describeNoActivationScope,
    includeHint,
    planAuditExport,
    planNoActivationExport,
    type AuditExportChoice,
    type AuditExportCounts,
    type AuditExportInclude,
    type AuditExportFormat,
    type AuditExportInput,
    type AuditPdfData,
    type NoActivationExportInput,
    type NoActivationPdfData,
} from "@/utils/auditExportPlan";
import { CSV_BOM } from "@/utils/exportSchema";
import { getErrorMessage } from "@/utils/errorUtils";
import { Logger } from "@/utils/logger";

/** What the page knows at the moment of the click; `exportedAt` is set when the file is made */
export type AuditExportData = Omit<AuditExportInput, "exportedAt">;

/** What the page knows at the click in the No activation view */
export type NoActivationExportData = Omit<NoActivationExportInput, "exportedAt">;

/** The workloads of the Include group (Entra Audit only): what each holds on the page, and what could limit it */
export interface AuditExportWorkloads {
    counts: AuditExportCounts;
    unit: "assignment" | "action";
    /** No activation: why PIM for Groups is not included, or null */
    groupsReason: string | null;
    /** The environment filter of the page */
    env: "role" | "group" | "both" | undefined;
}

interface AuditExportDialogProps {
    isOpen: boolean;
    onClose: () => void;
    /** Makes the events of the export for the chosen workloads; null while there is nothing to export */
    buildData: (include: AuditExportInclude) => AuditExportData | null;
    /** The No activation view: when given, the file holds its rows (CSV, JSON or PDF) and `buildData` is not used */
    buildIdleData?: (include: AuditExportInclude) => NoActivationExportData | null;
    /** Left out (Azure Audit), there is no Include group and the file holds everything */
    workloads?: AuditExportWorkloads;
    /** Printed in the PDF footer */
    appVersion: string;
}

const FORMATS: { value: AuditExportFormat; label: string; text: string }[] = [
    { value: "csv", label: "CSV", text: "One row per action, with reason, ticket and approver, for a spreadsheet." },
    { value: "json", label: "JSON", text: "The same actions with all kept fields." },
    { value: "pdf", label: "PDF", text: "Audit report: period, sources, totals and the actions." },
];

const IDLE_TEXT: Record<AuditExportFormat, string> = {
    csv: "One row per assignment, with its activation, for a spreadsheet.",
    json: "The same assignments with all kept fields.",
    pdf: "Audit report: period, sources, totals and the assignments.",
};

function download(blob: Blob, name: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function readStoredChoice(): AuditExportChoice {
    try {
        return parseStoredAuditExportChoice(window.localStorage.getItem(AUDIT_EXPORT_STORAGE_KEY));
    } catch {
        return parseStoredAuditExportChoice(null);
    }
}

/** The export dialog of the Audit page (spec section 6): the scope, CSV, JSON or PDF, replace names, and what every file states. */
export function AuditExportDialog({ isOpen, onClose: onCloseDialog, buildData, buildIdleData, workloads, appVersion }: AuditExportDialogProps) {
    const [choice, setChoice] = useState<AuditExportChoice>(readStoredChoice);
    const [isWorking, setIsWorking] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const controllerRef = useRef<AbortController | null>(null);
    // Leaving the page stops a PDF that is still being drawn, so no file lands on another page
    useEffect(() => () => controllerRef.current?.abort(), []);
    const radioName = useId();
    const replaceId = useId();
    const includeId = useId();
    // Not remembered: a stored choice could silently leave a workload out. It goes back to both on every way the dialog closes.
    const [include, setInclude] = useState<AuditExportInclude>(AUDIT_EXPORT_INCLUDE_ALL);
    const onClose = () => {
        setInclude(AUDIT_EXPORT_INCLUDE_ALL);
        onCloseDialog();
    };

    const update = (next: AuditExportChoice) => {
        setChoice(next);
        try {
            // Only the format and the option; never the tenant, the events or the filters
            window.localStorage.setItem(AUDIT_EXPORT_STORAGE_KEY, JSON.stringify(next));
        } catch {
            // Remembering the last choice is a convenience
        }
    };

    // A workload with no rows cannot be chosen
    const effective: AuditExportInclude = workloads
        ? { roles: include.roles && workloads.counts.roles > 0, groups: include.groups && workloads.counts.groups > 0 }
        : AUDIT_EXPORT_INCLUDE_ALL;
    const isNothingChosen = workloads !== undefined && !effective.roles && !effective.groups;
    const isIdle = buildIdleData !== undefined;
    // Built only while the dialog is open: the page renders on every move of a drag
    const data = isOpen && !isIdle ? buildData(effective) : null;
    const idleData = isOpen && isIdle ? buildIdleData(effective) : null;
    const isAzureFile = data !== null && isAzureExport(data.events);
    const current = isIdle ? idleData : data;
    if (!current) return <Dialog isOpen={false} onClose={onClose} title="Export audit" width={480}>{null}</Dialog>;

    const handleExport = async () => {
        const controller = new AbortController();
        controllerRef.current = controller;
        setIsWorking(true);
        setError(null);
        try {
            // Planned at the moment of the click: the date in the name and the export time count from now
            const exportedAt = new Date();
            const file = isIdle && idleData ? planNoActivationExport({ ...idleData, exportedAt }, choice) : data ? planAuditExport({ ...data, exportedAt }, choice) : null;
            if (!file) return;
            if (file.format === "pdf") {
                const [{ pdf }, { registerReportFonts }, { AuditReportDocument }, { NoActivationReportDocument }] = await Promise.all([
                    import("@react-pdf/renderer"),
                    import("@/components/pdf/ReportDocument"),
                    import("@/components/pdf/AuditReportDocument"),
                    import("@/components/pdf/NoActivationReportDocument"),
                ]);
                registerReportFonts(window.location.origin);
                const document = idleData
                    ? <NoActivationReportDocument data={file.pdf as NoActivationPdfData} version={appVersion} />
                    : <AuditReportDocument data={file.pdf as AuditPdfData} version={appVersion} />;
                const blob = await pdf(document).toBlob();
                if (controller.signal.aborted) return;
                download(blob, file.fileName);
            } else {
                download(new Blob([file.format === "csv" ? CSV_BOM : "", file.content], { type: file.mime }), file.fileName);
            }
            onClose();
        } catch (e: unknown) {
            Logger.error("AuditExportDialog", "Export failed", getErrorMessage(e));
            setError(getErrorMessage(e));
        } finally {
            setIsWorking(false);
        }
    };

    return (
        <Dialog isOpen={isOpen} onClose={onClose} title="Export audit" width={480}>
            <div className="flex max-h-[calc(100dvh-190px)] flex-col gap-4 overflow-y-auto pr-1">
                <p className="text-sm leading-5 text-body">{isNothingChosen ? "Nothing is chosen." : idleData ? describeNoActivationScope(idleData.rows.length, idleData.period) : describeAuditScope(data?.events.length ?? 0, current.period)}</p>
                {workloads && (
                    <fieldset className="min-w-0 border-0 p-0">
                        <legend className="mb-2 p-0 text-[13px] leading-5 text-muted">Include</legend>
                        <div className="flex flex-col gap-2.5">
                            {([["roles", "Entra roles"], ["groups", "PIM for Groups"]] as const).map(([key, label]) => {
                                const count = workloads.counts[key];
                                const hint = includeHint({ workload: key, count, unit: workloads.unit, groupsReason: workloads.groupsReason, env: workloads.env });
                                const id = `${includeId}-${key}`;
                                return (
                                    <div key={key} className="flex items-start gap-2">
                                        <input id={id} type="checkbox" checked={effective[key]} disabled={count === 0} onChange={(e) => setInclude({ ...include, [key]: e.target.checked })} className="mt-[3px] h-4 w-4 shrink-0 rounded-[3px] accent-[var(--accent)] disabled:opacity-50" />
                                        <label htmlFor={id} className={`text-[15px] leading-[22px] ${count === 0 ? "text-muted" : "text-ink"}`}>
                                            {label}
                                            {hint && <span className="block text-[13px] leading-[19px] text-muted">{hint}</span>}
                                        </label>
                                    </div>
                                );
                            })}
                        </div>
                    </fieldset>
                )}
                <fieldset className="min-w-0 border-0 p-0">
                    <legend className="mb-2 p-0 text-[13px] leading-5 text-muted">Format</legend>
                    <div role="radiogroup" aria-label="Format" className="flex flex-col gap-2">
                        {FORMATS.map((format) => {
                            const isSelected = choice.format === format.value;
                            return (
                                <label key={format.value} className={`flex cursor-pointer items-start gap-3 rounded border p-3 ${isSelected ? "border-accent bg-accent-tint" : "border-line bg-surface"}`}>
                                    <input type="radio" name={radioName} checked={isSelected} onChange={() => update({ ...choice, format: format.value })} className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]" />
                                    <span className="min-w-0">
                                        <span className="block text-[15px] leading-5 font-semibold text-ink">{format.label}</span>
                                        <span className="mt-1 block text-[13px] leading-[19px] text-muted">{isIdle ? IDLE_TEXT[format.value] : format.text}</span>
                                    </span>
                                </label>
                            );
                        })}
                    </div>
                </fieldset>
                <div className="flex items-start gap-2">
                    <input id={replaceId} type="checkbox" checked={choice.replaceNames} onChange={(e) => update({ ...choice, replaceNames: e.target.checked })} className="mt-[3px] h-4 w-4 shrink-0 rounded-[3px] accent-[var(--accent)]" />
                    <label htmlFor={replaceId} className="text-[15px] leading-[22px] text-ink">
                        Replace names with User 1, 2, ...
                        <span className="block text-[13px] leading-[19px] text-muted">
                            {isAzureFile
                                ? "Also leaves out the object IDs of people, the exporter, the search words, the scope and subscription IDs, and the reason, new value and ticket, because they can hold names. Role, group and scope names stay."
                                : "Also leaves out the object IDs of people, the exporter, the search words, and the reason, new value and ticket, because they can hold names. Role and group names stay."}
                        </span>
                    </label>
                </div>
                <p className="text-[13px] leading-5 text-muted">
                    Every export states the period, the source, the oldest event available, when it was read and anything that could not be read. It always holds all kept fields, also when Show more details is off.
                </p>
                {error && <StatusBox variant="error" title="The export failed" onDismiss={() => setError(null)} dismissLabel="Dismiss: export error">{error}</StatusBox>}
            </div>
            <div className="mt-5 flex justify-end gap-2">
                <Button variant="secondary" onClick={onClose}>Cancel</Button>
                <Button variant="primary" isLoading={isWorking} disabled={isNothingChosen} onClick={() => void handleExport()}>Export</Button>
            </div>
        </Dialog>
    );
}
