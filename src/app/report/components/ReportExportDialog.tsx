"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { StatusBox } from "@/components/ui/StatusBox";
import { Tag } from "@/components/ui/Tag";
import { Icon } from "@/components/icons/Icon";
import { CSV_BOM } from "@/utils/exportSchema";
import { EXPORT_STORAGE_KEY, describeFilter, hasActiveFilter, parseStoredChoice, planExport, type ExportChoice, type ExportData, type ExportPurpose } from "@/utils/reportExportPlan";
import { getErrorMessage } from "@/utils/errorUtils";
import { Logger } from "@/utils/logger";

interface ReportExportDialogProps {
    isOpen: boolean;
    onClose: () => void;
    /** Everything the page knows; null while the dialog is closed */
    data: ExportData | null;
}

const PURPOSES: { value: ExportPurpose; label: string; format: string; text: string }[] = [
    { value: "overview", label: "Overview", format: "CSV", text: "Read in Excel or hand to an auditor: one row per assignment with names, type, scope and end date, and one row per role or group with its settings." },
    { value: "bulk", label: "For Configure Import", format: "CSV", text: "The exact import format of Configure Import, with IDs. Change the file and import it to apply the same settings or assignments elsewhere." },
    { value: "backup", label: "Backup", format: "JSON", text: "Everything as it is now, every policy with all its rules and every assignment, in one file. Keep it before you change anything." },
];

const FOOTERS: Record<ExportPurpose, string> = {
    overview: "The first rows state the tenant, when the data was read, the filter and who exported. Replacing names also leaves out the object IDs of people, the exporter and the search words; role and group names stay.",
    bulk: "Import in Configure. Exported and imported with the same columns, so a file you import again sets exactly what it says. Names are never replaced here: the IDs must match the tenant.",
    backup: "Starts with schema version, tenant, when the data was read and exported and the app version, and includes the authentication contexts and custom extensions so names and IDs can be traced. A later version can compare a backup with the tenant.",
};

const NOTES: Record<string, string> = {
    overviewAssignments: "Assignments: role or group and its ID, privileged, name, UPN, object ID, type (user, guest, app, group), direct or through a group, state, activated or assigned, scope, start and end, emergency access.",
    overviewRoleSettings: "Role settings: one column for each tile of the role configuration, as readable text.",
    overviewGroupSettings: "Group settings: the same tiles, one row for Member and one for Owner.",
    bulkAssignments: "Assignments: role or group, principal, member or owner, eligible or active, Scope ID, End Date (date or permanent).",
    bulkPolicies: "Policies: every setting of Activation, Assignment and Notification, approvers with ID and type, custom extensions.",
};

const WHY_ACTIVATED = "Activated assignments end by themselves; importing them would create standing access.";
const WHY_VIA_GROUP = "Members through a group get the role from the group, which is in the file already.";

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

function readStoredChoice(): ExportChoice {
    try {
        return parseStoredChoice(window.localStorage.getItem(EXPORT_STORAGE_KEY));
    } catch {
        return parseStoredChoice(null);
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

/** The export dialog of the Report (spec 10.1): purpose, contents, scope, the files you get, and the footer. */
export function ReportExportDialog({ isOpen, onClose, data }: ReportExportDialogProps) {
    const [choice, setChoice] = useState<ExportChoice>(readStoredChoice);
    const [isWorking, setIsWorking] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const radioName = useId();

    const update = (next: ExportChoice) => {
        setChoice(next);
        try {
            window.localStorage.setItem(EXPORT_STORAGE_KEY, JSON.stringify(next));
        } catch {
            // Remembering the last choice is a convenience
        }
    };

    const plan = useMemo(() => (data ? planExport(data, choice) : null), [data, choice]);
    if (!data || !plan) return <Dialog isOpen={false} onClose={onClose} title="Export" width={600}>{null}</Dialog>;

    const { purpose } = choice;
    const isBackup = purpose === "backup";
    const hasFilter = hasActiveFilter(data);
    const hasRoles = data.allRoles.length > 0;
    const useGroups = choice.scope.groups && data.canExportGroups;
    const isFilterOn = hasFilter && !isBackup && choice.scope.applyFilter;
    const filterHint = isBackup
        ? "A backup ignores the filter."
        : !hasFilter
            ? "No filter active."
            : `${describeFilter(data)}: ${data.filteredRoles.length} of ${data.allRoles.length} roles${useGroups ? `, ${data.filteredGroups.length} of ${data.allGroups.length} groups` : ""}`;

    const setOverview = (key: keyof ExportChoice["overview"], value: boolean) => update({ ...choice, overview: { ...choice.overview, [key]: value } });
    const setBulk = (key: keyof ExportChoice["bulk"], value: boolean) => update({ ...choice, bulk: { ...choice.bulk, [key]: value } });
    const setScope = (key: keyof ExportChoice["scope"], value: boolean) => update({ ...choice, scope: { ...choice.scope, [key]: value } });

    const fileCount = plan.files.length;
    const exportLabel = fileCount === 1 ? "Export 1 file" : fileCount === 0 ? "Export" : `Export ${fileCount} files`;
    const ids = new Set(plan.files.map((f) => f.id));
    const notes = [
        ...(purpose === "overview" ? ["overviewAssignments", "overviewRoleSettings", "overviewGroupSettings"].filter((id) => ids.has(id)) : []),
        ...(purpose === "bulk" ? [...(ids.has("bulkRoleAssignments") || ids.has("bulkGroupAssignments") ? ["bulkAssignments"] : []), ...(ids.has("bulkRolePolicies") || ids.has("bulkGroupPolicies") ? ["bulkPolicies"] : [])] : []),
    ];

    const handleExport = async () => {
        setIsWorking(true);
        setError(null);
        try {
            // Built again at the moment of the click: the date in the names and the days left count from now
            const fresh = planExport({ ...data, meta: { ...data.meta, exportedAt: new Date() } }, choice);
            for (const file of fresh.files) {
                download(file.build(), file.name, file.mime);
                // Browsers ask before they let a page download several files at once; a short pause keeps them in line
                if (fresh.files.length > 1) await delay(250);
            }
            onClose();
        } catch (e) {
            Logger.error("ReportExportDialog", "Export failed", e);
            setError(getErrorMessage(e));
        } finally {
            setIsWorking(false);
        }
    };

    return (
        <Dialog isOpen={isOpen} onClose={onClose} title="Export" width={600}>
            <div className="flex max-h-[calc(100dvh-190px)] flex-col gap-5 overflow-y-auto pr-1">
                <fieldset className="min-w-0 border-0 p-0">
                    <legend className="mb-2 p-0 text-[13px] leading-5 text-muted">What is it for</legend>
                    <div role="radiogroup" aria-label="What is it for" className="flex flex-col gap-2">
                        {PURPOSES.map((p) => {
                            const isSelected = purpose === p.value;
                            return (
                                <label key={p.value} className={`flex cursor-pointer items-start gap-3 rounded border p-3 ${isSelected ? "border-accent bg-accent-tint" : "border-line bg-surface"}`}>
                                    <input type="radio" name={radioName} checked={isSelected} onChange={() => update({ ...choice, purpose: p.value })} className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]" />
                                    <span className="min-w-0">
                                        <span className="flex items-center gap-2 text-[15px] leading-5 font-semibold text-ink">
                                            {p.label}
                                            <span className="rounded border border-line bg-surface px-1 font-mono text-[11px] leading-4 font-normal text-muted">{p.format}</span>
                                        </span>
                                        <span className="mt-1 block text-sm leading-5 text-body">{p.text}</span>
                                    </span>
                                </label>
                            );
                        })}
                    </div>
                </fieldset>

                <div className="grid gap-5 sm:grid-cols-2">
                    <Group title="Contents">
                        {purpose === "overview" && (
                            <>
                                <Check checked={choice.overview.assignments} onChange={(v) => setOverview("assignments", v)} label="Assignments, one row each" />
                                <Check checked={choice.overview.roleSettings} onChange={(v) => setOverview("roleSettings", v)} label="Role settings, one row per role" />
                                <Check checked={choice.overview.groupSettings} onChange={(v) => setOverview("groupSettings", v)} label="Group settings, one row per group, member and owner" />
                            </>
                        )}
                        {purpose === "bulk" && (
                            <>
                                <Check checked={choice.bulk.rolePolicies} onChange={(v) => setBulk("rolePolicies", v)} label="Role policies" />
                                <Check checked={choice.bulk.groupPolicies} onChange={(v) => setBulk("groupPolicies", v)} label="Group policies" />
                                <Check checked={choice.bulk.roleAssignments} onChange={(v) => setBulk("roleAssignments", v)} label="Role assignments" />
                                <Check checked={choice.bulk.groupAssignments} onChange={(v) => setBulk("groupAssignments", v)} label="Group assignments" />
                            </>
                        )}
                        {isBackup && <Check checked disabled label="Policies, rules and assignments" hint="A backup is always complete." />}
                    </Group>
                    <Group title="Scope">
                        <Check checked={choice.scope.roles && hasRoles} disabled={!hasRoles} onChange={(v) => setScope("roles", v)} label="Directory roles" />
                        <Check checked={useGroups} disabled={!data.canExportGroups} onChange={(v) => setScope("groups", v)} label="PIM for Groups" hint={data.canExportGroups ? undefined : "Not granted yet"} />
                        <Check checked={isFilterOn} disabled={!hasFilter || isBackup} onChange={(v) => setScope("applyFilter", v)} label="Apply the current filter" hint={filterHint} />
                        {purpose === "overview" && <Check checked={choice.overview.anonymise} onChange={(v) => setOverview("anonymise", v)} label="Replace names with Person 1, 2, ..." />}
                    </Group>
                </div>

                <fieldset className="min-w-0 border-0 p-0">
                    <legend className="mb-2 p-0 text-[13px] leading-5 text-muted">You get</legend>
                    <ul className="m-0 list-none overflow-hidden rounded border border-line bg-surface p-0">
                        {plan.files.length === 0 && <li className="px-3 py-2 text-sm text-muted">Nothing is chosen.</li>}
                        {plan.files.map((file) => (
                            <li key={file.id} className="flex items-center gap-2 border-b border-line px-3 py-2 last:border-b-0">
                                <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink">{file.name}</span>
                                <span className="shrink-0 text-[13px] text-body">{file.count}</span>
                            </li>
                        ))}
                        {purpose === "bulk" && plan.notIncluded.activated > 0 && (
                            <li className="flex items-center gap-2 border-b border-line bg-band px-3 py-2">
                                <Icon name="info" size={16} className="shrink-0 text-muted" />
                                <span className="min-w-0 flex-1 text-[13px] text-body">{`Not included: ${plan.notIncluded.activated} activated`}</span>
                                <Tag tip={WHY_ACTIVATED} className="shrink-0 border-transparent bg-transparent">Why</Tag>
                            </li>
                        )}
                        {purpose === "bulk" && plan.notIncluded.viaGroup > 0 && (
                            <li className="flex items-center gap-2 border-b border-line bg-band px-3 py-2">
                                <Icon name="info" size={16} className="shrink-0 text-muted" />
                                <span className="min-w-0 flex-1 text-[13px] text-body">{`Not included: ${plan.notIncluded.viaGroup} through a group`}</span>
                                <Tag tip={WHY_VIA_GROUP} className="shrink-0 border-transparent bg-transparent">Why</Tag>
                            </li>
                        )}
                        {notes.map((id) => (
                            <li key={id} className="border-b border-line px-3 py-2 text-[13px] leading-5 text-muted last:border-b-0">{NOTES[id]}</li>
                        ))}
                    </ul>
                </fieldset>

                <p className="text-[13px] leading-5 text-body">{FOOTERS[purpose]}</p>
                {error && <StatusBox variant="error" title="The export failed" onDismiss={() => setError(null)} dismissLabel="Dismiss: export error">{error}</StatusBox>}
            </div>
            <div className="mt-5 flex justify-end gap-2">
                <Button variant="secondary" onClick={onClose}>Cancel</Button>
                <Button variant="primary" isLoading={isWorking} disabled={fileCount === 0} onClick={() => void handleExport()}>{exportLabel}</Button>
            </div>
        </Dialog>
    );
}
