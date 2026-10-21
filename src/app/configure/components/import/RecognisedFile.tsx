"use client";

import { useEffect, useId, useRef } from "react";
import { Icon } from "@/components/icons/Icon";
import { Button } from "@/components/ui/Button";
import { StatusBox } from "@/components/ui/StatusBox";
import { CSV_KINDS, KIND_INFO, describeDecidedBy, describeKind, type ImportFile, type ImportKind } from "@/utils/importDetect";

interface RecognisedFileProps {
    file: ImportFile;
    onChooseKind: (kind: ImportKind | null) => void;
    onOtherFile: () => void;
}

const CHIP = "inline-flex h-[28px] items-center gap-1 rounded border px-2 text-[12px] leading-4 max-sm:min-h-8";

function ChipRow({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="w-16 shrink-0 text-xs font-semibold text-ink">{label}</span>
            <ul className="flex flex-wrap items-center gap-2">{children}</ul>
        </div>
    );
}

/** A file with thousands of unknown columns or keys must not freeze the page (I-10) */
const MAX_CHIPS = 30;

/** The box above the rows (spec 7.2): the file, how it was recognised, the Required, Also read and Skipped chips */
export function RecognisedFile({ file, onChooseKind, onOtherFile }: RecognisedFileProps) {
    const selectId = useId();
    // The file input went away when the file was chosen: the focus goes to the file's heading (I-12)
    const headingRef = useRef<HTMLHeadingElement>(null);
    useEffect(() => { headingRef.current?.focus(); }, [file.fileName]);
    const { detected } = file;
    // A file that was read as JSON (or failed to) has no CSV kind to choose (I-11)
    const isCsv = file.csv !== null || (file.kind === null && file.json === null && !/\.json$/i.test(file.fileName));
    const select = (
        <span className="flex flex-wrap items-center gap-2">
            <label htmlFor={selectId} className="text-xs text-body">{file.kind ? "Not right? Read it as" : "Read it as"}</label>
            <select
                id={selectId}
                value={file.kind ?? ""}
                onChange={(event) => onChooseKind((event.target.value || null) as ImportKind | null)}
                className="h-[34px] rounded border border-line bg-surface px-2 text-[13px] text-ink max-sm:h-11"
            >
                {!file.kind && <option value="">Choose a type</option>}
                {CSV_KINDS.map((k) => <option key={k} value={k}>{KIND_INFO[k].label}</option>)}
            </select>
        </span>
    );
    return (
        <section aria-label="The file" className="rounded border border-line bg-surface">
            <div className="flex flex-wrap items-start gap-x-4 gap-y-3 p-4 sm:p-5">
                <span aria-hidden="true" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded bg-mode-import-tint text-mode-import"><Icon name="file-data" size={16} /></span>
                <div className="min-w-0 flex-1 max-sm:basis-full">
                    <h2 ref={headingRef} tabIndex={-1} className="text-sm font-semibold break-words text-ink focus:outline-none">{file.kind ? `${file.fileName}: ${describeKind(file)}` : file.fileName}</h2>
                    {file.kind && <p className="mt-0.5 text-xs text-body">{describeDecidedBy(detected.decidedBy)}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2 max-sm:basis-full max-sm:justify-end">
                    {isCsv && select}
                    <Button onClick={onOtherFile}>Other file</Button>
                </div>
            </div>
            {!file.kind && detected.problem && (
                <div className="border-t border-line p-4 sm:p-5">
                    <StatusBox variant="error" title="This file was not recognised">{detected.problem}</StatusBox>
                </div>
            )}
            {file.kind && detected.required.length > 0 && (
                <div className="flex flex-col gap-3 border-t border-line p-4 sm:p-5">
                    <ChipRow label="Required">
                        {detected.required.map((r) => (
                            <li key={r.label} className={`${CHIP} ${r.present ? "border-transparent bg-success-tint text-success-text" : "border-transparent bg-danger-tint text-danger-text"}`}>
                                <Icon name={r.present ? "check" : "error"} size={16} />
                                {r.label}
                                {!r.present && <span className="sr-only"> is missing</span>}
                            </li>
                        ))}
                    </ChipRow>
                    {detected.alsoRead.length > 0 && (
                        <ChipRow label="Also read">
                            {detected.alsoRead.slice(0, MAX_CHIPS).map((h) => <li key={h} className={`${CHIP} border-line bg-surface text-ink`}>{h}</li>)}
                            {detected.alsoRead.length > MAX_CHIPS && <li className="text-xs text-muted">{`and ${detected.alsoRead.length - MAX_CHIPS} more`}</li>}
                        </ChipRow>
                    )}
                    {detected.skipped.length > 0 && (
                        <ChipRow label="Skipped">
                            {detected.skipped.slice(0, MAX_CHIPS).map((s) => <li key={s.header} className={`${CHIP} border-line bg-surface text-muted line-through`}>{s.header}</li>)}
                            {detected.skipped.length > MAX_CHIPS && <li className="text-xs text-muted">{`and ${detected.skipped.length - MAX_CHIPS} more`}</li>}
                            <li className="list-none text-xs text-body">
                                {detected.skipped.some((s) => s.reason === "readOnly") ? "Read-only columns from the export are not written." : "Unknown columns are ignored."}
                                {detected.skipped.some((s) => s.reason === "readOnly") && detected.skipped.some((s) => s.reason === "unknown") && " Unknown columns are ignored."}
                            </li>
                        </ChipRow>
                    )}
                </div>
            )}
        </section>
    );
}
