"use client";

import { useEffect, useId, useRef, useState, type DragEvent } from "react";
import { Icon } from "@/components/icons/Icon";
import { Button } from "@/components/ui/Button";
import { MAX_IMPORT_BYTES, tooBigMessage } from "@/utils/importDetect";
import { IMPORT_EXAMPLES } from "./importSession";

interface DropZoneProps {
    /** Focus the file input on mount ("Other file") */
    takeFocus?: boolean;
    /** A file the admin chose or dropped, already read as text */
    onFile: (fileName: string, text: string) => void;
    /** "Use the example": the app reads the bundled file */
    onExample: (fileName: string) => Promise<void>;
}

/**
 * Choose a file (spec 7.1). The zone is a real `<input type="file">` (visually hidden, so the keyboard reaches it and
 * the browser's own file dialog opens on Enter or Space) with a styled label; dropping a file on the zone does the same.
 */
export function DropZone({ onFile, onExample, takeFocus = false }: DropZoneProps) {
    const inputId = useId();
    const exampleId = useId();
    const input = useRef<HTMLInputElement>(null);
    // After "Other file" the focus comes back to the file input (I-12); on a first visit the page keeps its focus
    useEffect(() => { if (takeFocus) input.current?.focus(); }, [takeFocus]);
    const [isOver, setIsOver] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);
    const [example, setExample] = useState(IMPORT_EXAMPLES[0].file);
    const [isLoadingExample, setIsLoadingExample] = useState(false);

    const read = async (file: File) => {
        setProblem(null);
        if (file.size > MAX_IMPORT_BYTES) {
            setProblem(tooBigMessage(file.size));
            return;
        }
        try {
            onFile(file.name, await file.text());
        } catch {
            setProblem("This file could not be read. Choose it again.");
        }
    };

    const onDrop = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        setIsOver(false);
        const file = event.dataTransfer.files?.[0];
        if (file) void read(file);
    };

    const loadChosenExample = async () => {
        setProblem(null);
        setIsLoadingExample(true);
        try {
            await onExample(example);
        } catch {
            setProblem("The example could not be loaded. Try again.");
        } finally {
            setIsLoadingExample(false);
        }
    };

    return (
        <div className="rounded border border-line bg-surface p-4 sm:p-5">
            <div
                onDragOver={(event) => { event.preventDefault(); setIsOver(true); }}
                onDragLeave={() => setIsOver(false)}
                onDrop={onDrop}
                className={`flex flex-wrap items-center justify-center gap-x-4 gap-y-3 rounded border border-dashed px-4 py-8 text-center has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-(--focus) ${isOver ? "border-accent bg-accent-tint" : "border-line bg-page"}`}
            >
                <span className="inline-flex items-center gap-3 text-left">
                    <Icon name="upload" size={20} className="text-body" />
                    <span>
                        <span className="block text-sm text-ink">Drop a CSV or an access model JSON here, up to 5 MB.</span>
                        <span className="block text-xs text-body">PIM Manager recognises what is in it from the columns.</span>
                    </span>
                </span>
                <input
                    ref={input}
                    id={inputId}
                    type="file"
                    accept=".csv,.json,text/csv,application/json"
                    className="peer sr-only"
                    onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void read(file);
                        // The same file can be chosen again after a fix
                        event.target.value = "";
                    }}
                />
                <label htmlFor={inputId} className="inline-flex h-[34px] cursor-pointer items-center rounded border border-line bg-surface px-3 text-[13px] font-medium text-ink hover:bg-page peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-(--focus) max-sm:h-11">
                    Choose file
                </label>
            </div>
            {problem && <p role="alert" className="mt-3 text-sm text-danger-text">{problem}</p>}
            <div className="mt-4 flex flex-wrap items-center gap-2">
                <label htmlFor={exampleId} className="text-xs text-body">Or try an example:</label>
                <select
                    id={exampleId}
                    value={example}
                    onChange={(event) => setExample(event.target.value)}
                    className="h-[34px] rounded border border-line bg-surface px-2 text-[13px] text-ink max-sm:h-11"
                >
                    {IMPORT_EXAMPLES.map((e) => <option key={e.file} value={e.file}>{e.file}</option>)}
                </select>
                <Button onClick={() => void loadChosenExample()} isLoading={isLoadingExample}>Use the example</Button>
            </div>
        </div>
    );
}
