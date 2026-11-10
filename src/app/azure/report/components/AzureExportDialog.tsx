"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { StatusBox } from "@/components/ui/StatusBox";
import { CSV_BOM } from "@/utils/exportSchema";
import {
    AZURE_EXPORT_STORAGE_KEY, describeAzureFilters, isFilterApplied, parseStoredAzureChoice, planAzureExport,
    type AzureExportChoice, type AzureExportData,
} from "@/utils/azureExportPlan";
import type { AzureRolePair } from "@/utils/azureExportRows";
import { scopeLineFor } from "@/utils/azureReport";
import { getErrorMessage } from "@/utils/errorUtils";
import { Logger } from "@/utils/logger";

interface AzureExportDialogProps {
    /** Everything the export needs; null while the dialog is closed */
    data: AzureExportData | null;
    onClose: () => void;
    /** Subscriptions still loading (for the hint); 0 when all are read */
    loadingCount: number;
    /** Reads the role settings of the pairs not read yet; resolves when done or aborted */
    readPolicies: (pairs: AzureRolePair[], onProgress: (done: number, total: number) => void, signal: AbortSignal) => Promise<void>;
    /** For the fixture route: the choice at the start instead of the remembered one */
    initialChoice?: AzureExportChoice;
    /** For the fixture route: show the reading line at the start */
    initialReading?: { done: number; total: number };
}

/** Overview is the only purpose that works; the other two come with Azure Configure */
const PURPOSES: { value: string; label: string; format: string; text: string; enabled: boolean }[] = [
    { value: "overview", label: "Overview", format: "CSV", text: "Read in Excel or hand to an auditor: one row per assignment with names, type, scope and end date, and one row per role and scope with its settings.", enabled: true },
    { value: "bulk", label: "For Configure Import", format: "CSV", text: "The import format of Azure Configure, with IDs, to apply the same settings or assignments elsewhere.", enabled: false },
    { value: "backup", label: "Backup", format: "JSON", text: "Every policy with all its rules and every assignment, in one file.", enabled: false },
];

const FOOTER = "The first rows state the tenant, when the data was read, the scope and filter, that the view is partial, and who exported. Replacing names also leaves out the object IDs of people, the exporter and the search words; role, scope and group names stay.";

const NOTES: Record<string, string> = {
    azureAssignments: "Assignments: role, principal with sign-in name and object ID, type, member type, eligible, active or permanent, start and end, scope with level, ID, resource type and subscription, delegated, privileged, emergency access, activated or assigned, inherited.",
    azureRoleSettings: "Role settings: one row per role and scope the assignments are on, with one column for each tile of the role configuration. Azure does not inherit role settings, so every scope has its own row.",
};

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function download(content: string, name: string, mime: string): void {
    const blob = new Blob([mime.startsWith("text/csv") ? CSV_BOM : "", content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function readStoredChoice(): AzureExportChoice {
    try {
        return parseStoredAzureChoice(window.localStorage.getItem(AZURE_EXPORT_STORAGE_KEY));
    } catch {
        return parseStoredAzureChoice(null);
    }
}

function Group({ title, children }: { title: string; children: ReactNode }) {
    return (
        <fieldset className="min-w-0 border-0 p-0">
            <legend className="mb-2 p-0 text-[13px] leading-5 text-muted">{title}</legend>
            <div className="flex flex-col gap-2.5">{children}</div>
        </fieldset>
    );
}

function Check({ checked, onChange, disabled, label, hint }: { checked: boolean; onChange?: (value: boolean) => void; disabled?: boolean; label: string; hint?: string }) {
    const id = useId();
    return (
        <div className="flex items-start gap-2">
            <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange?.(e.target.checked)} className="mt-[3px] h-4 w-4 shrink-0 rounded-[3px] accent-[var(--accent)] disabled:opacity-50" />
            <label htmlFor={id} className={`text-[15px] leading-[22px] ${disabled ? "text-muted" : "text-ink"}`}>
                {label}
                {hint && <span className="block text-[13px] leading-[19px] text-muted">{hint}</span>}
            </label>
        </div>
    );
}

/** The export dialog of the Azure Report, as the Entra Report export dialog: purpose, contents, scope, the files you get, and the footer. */
export function AzureExportDialog({ data, onClose, loadingCount, readPolicies, initialChoice, initialReading }: AzureExportDialogProps) {
    const [choice, setChoice] = useState<AzureExportChoice>(() => initialChoice ?? readStoredChoice());
    const [isWorking, setIsWorking] = useState(initialReading !== undefined);
    const [reading, setReading] = useState<{ done: number; total: number } | null>(initialReading ?? null);
    const [error, setError] = useState<string | null>(null);
    const controllerRef = useRef<AbortController | null>(null);
    const radioName = useId();

    const update = (next: AzureExportChoice) => {
        setChoice(next);
        // The fixture route does not write storage
        if (initialChoice) return;
        try {
            window.localStorage.setItem(AZURE_EXPORT_STORAGE_KEY, JSON.stringify(next));
        } catch {
            // Remembering the last choice is a convenience
        }
    };

    // Leaving the page stops the policy reads and the downloads still to come, so no file lands on another page
    useEffect(() => () => controllerRef.current?.abort(), []);

    const plan = useMemo(() => (data ? planAzureExport(data, choice) : null), [data, choice]);
    if (!data || !plan) return <Dialog isOpen={false} onClose={onClose} title="Export" width={600}>{null}</Dialog>;

    const cancel = () => {
        controllerRef.current?.abort();
        onClose();
    };

    const filterText = describeAzureFilters(data.view.filters);
    const filterPart = filterText === "None" ? "" : `, ${filterText}`;
    const filterHint = loadingCount > 0
        ? (loadingCount === 1 ? "Still loading 1 subscription." : `Still loading ${loadingCount} subscriptions.`)
        : `${scopeLineFor(data.view.scope?.name ?? "", data.view.filters.origin)}${filterPart}: ${data.view.rows.length} of ${data.allRows.length} assignments`;

    const fileCount = plan.files.length;
    const exportLabel = fileCount === 1 ? "Export 1 file" : fileCount === 0 ? "Export" : `Export ${fileCount} files`;

    const handleExport = async () => {
        const controller = new AbortController();
        controllerRef.current = controller;
        setIsWorking(true);
        setError(null);
        try {
            if (choice.roleSettings && plan.toRead > 0) {
                setReading({ done: 0, total: plan.toRead });
                await readPolicies(plan.pairs, (done, total) => setReading({ done, total }), controller.signal);
                if (controller.signal.aborted) return;
            }
            // Built again at the moment of the click: the date in the names and the days left count from now
            const fresh = planAzureExport({ ...data, meta: { ...data.meta, exportedAt: new Date() } }, choice);
            for (const file of fresh.files) {
                if (controller.signal.aborted) return;
                download(file.build(), file.name, file.mime);
                // Browsers ask before they let a page download several files at once; a short pause keeps them in line
                if (fresh.files.length > 1) await delay(250);
            }
            onClose();
        } catch (e: unknown) {
            // Cancel aborts the reads and closes the dialog: an abort is not a failed export
            if (controller.signal.aborted) return;
            Logger.error("AzureExportDialog", "Export failed", e);
            setError(getErrorMessage(e));
        } finally {
            setIsWorking(false);
            setReading(null);
        }
    };

    return (
        <Dialog isOpen onClose={cancel} title="Export" width={600}>
            <div className="flex max-h-[calc(100dvh-190px)] flex-col gap-5 overflow-y-auto pr-1">
                <fieldset className="min-w-0 border-0 p-0">
                    <legend className="mb-2 p-0 text-[13px] leading-5 text-muted">What is it for</legend>
                    <div role="radiogroup" aria-label="What is it for" className="flex flex-col gap-2">
                        {PURPOSES.map((p) => {
                            // Overview is the one purpose that works, so it is always the selected one
                            const isSelected = p.enabled;
                            return (
                                <label key={p.value} className={p.enabled ? `flex cursor-pointer items-start gap-3 rounded border p-3 ${isSelected ? "border-accent bg-accent-tint" : "border-line bg-surface"}` : "flex cursor-not-allowed items-start gap-3 rounded border border-line bg-surface p-3 opacity-60"}>
                                    <input type="radio" name={radioName} checked={isSelected} disabled={!p.enabled} readOnly className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]" />
                                    <span className="min-w-0">
                                        <span className="flex items-center gap-2 text-[15px] leading-5 font-semibold text-ink">
                                            {p.label}
                                            <span className="rounded border border-line bg-surface px-1 font-mono text-[11px] leading-4 font-normal text-muted">{p.format}</span>
                                        </span>
                                        <span className="mt-1 block text-sm leading-5 text-body">{p.text}</span>
                                        {!p.enabled && <span className="mt-1 block text-[13px] leading-[19px] text-muted">Comes with Azure Configure.</span>}
                                    </span>
                                </label>
                            );
                        })}
                    </div>
                </fieldset>

                <div className="grid gap-5 sm:grid-cols-2">
                    <Group title="Contents">
                        <Check checked={choice.assignments} onChange={(v) => update({ ...choice, assignments: v })} label="Assignments, one row each" />
                        <Check checked={choice.roleSettings} onChange={(v) => update({ ...choice, roleSettings: v })} label="Role settings, one row per role and scope" />
                    </Group>
                    <Group title="Scope">
                        <Check checked={isFilterApplied(data, choice)} disabled={loadingCount > 0} onChange={(v) => update({ ...choice, applyFilter: v })} label="Apply the current scope and filter" hint={filterHint} />
                        <Check checked={choice.anonymise} onChange={(v) => update({ ...choice, anonymise: v })} label="Replace names with Person 1, 2, ..." />
                    </Group>
                </div>

                <fieldset className="min-w-0 border-0 p-0">
                    <legend className="mb-2 p-0 text-[13px] leading-5 text-muted">You get</legend>
                    <ul className="m-0 list-none overflow-hidden rounded border border-line bg-surface p-0">
                        {plan.files.length === 0 && <li className="px-3 py-2 text-sm text-muted">Nothing is chosen.</li>}
                        {plan.files.map((file) => (
                            <li key={file.id} className="flex items-center gap-2 border-b border-line px-3 py-2 last:border-b-0">
                                {/* The Azure names are longer than Entra's: below 640 they wrap at a hyphen instead of being cut off (Joël 2026-10-24) */}
                                <span className="min-w-0 flex-1 font-mono text-[13px] text-ink sm:truncate">{file.name}</span>
                                <span className="shrink-0 text-[13px] text-body">{file.count}</span>
                            </li>
                        ))}
                        {plan.files.filter((file) => NOTES[file.id]).map((file) => (
                            <li key={`note-${file.id}`} className="border-b border-line px-3 py-2 text-[13px] leading-5 text-muted last:border-b-0">{NOTES[file.id]}</li>
                        ))}
                    </ul>
                </fieldset>

                <p className="text-[13px] leading-5 text-body">{FOOTER}</p>
                {reading && <p role="status" className="text-[13px] leading-5 text-body">Reading role settings {reading.done} of {reading.total}</p>}
                {error && <StatusBox variant="error" title="The export failed" onDismiss={() => setError(null)} dismissLabel="Dismiss: export error">{error}</StatusBox>}
            </div>
            <div className="mt-5 flex justify-end gap-2">
                <Button variant="secondary" onClick={cancel}>Cancel</Button>
                <Button variant="primary" isLoading={isWorking} disabled={fileCount === 0} onClick={() => void handleExport()}>{exportLabel}</Button>
            </div>
        </Dialog>
    );
}
