"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/Button";
import { DemoLock } from "@/components/ui/DemoLock";

interface RemovalConfirmProps {
    removalNames: readonly string[];
    /** From 20 targets on: the count per setting (spec 12.3) */
    countPerSetting: readonly { label: string; count: number }[] | null;
    /** False while the review says fix first: "Remove and apply" waits */
    canConfirm: boolean;
    onCancel: () => void;
    onConfirm: () => void;
}

/**
 * The inline confirmation above the review bar (spec 12.3): the removals by name, "Remove and apply" in danger and
 * Cancel; not a dialog (the page stays usable). Focus moves to Cancel when it opens and back to Apply when it
 * closes; Escape inside it cancels.
 */
export function RemovalConfirm({ removalNames, countPerSetting, canConfirm, onCancel, onConfirm }: RemovalConfirmProps) {
    const cancelRef = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        // Above the sticky bar, not under it
        cancelRef.current?.scrollIntoView({ block: "center" });
        cancelRef.current?.focus({ preventScroll: true });
    }, []);
    const n = removalNames.length;
    // With 20 or more targets the count per setting is confirmed too, also without removals (spec 12.3, C2-04)
    const isRemoval = n > 0;
    return (
        <div
            role="group"
            aria-labelledby="removal-confirm-title"
            onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                event.stopPropagation();
                onCancel();
            }}
            className={`mt-6 rounded border p-4 ${isRemoval ? "border-danger-text bg-danger-tint" : "border-line bg-surface"}`}
        >
            <p id="removal-confirm-title" className="text-sm font-semibold text-ink">{isRemoval ? `Remove ${n} ${n === 1 ? "assignment" : "assignments"}: ${removalNames.join(", ")}` : "Apply these changes to many targets"}</p>
            {countPerSetting && countPerSetting.length > 0 && (
                <ul aria-label="Settings changed" className="mt-2 list-disc pl-5 text-[13px] leading-5 text-body">
                    {countPerSetting.map((s) => <li key={s.label}>{s.label}: {s.count} {s.count === 1 ? "target" : "targets"}</li>)}
                </ul>
            )}
            <div className="mt-3 flex flex-wrap justify-end gap-2">
                <Button ref={cancelRef} onClick={onCancel}>Cancel</Button>
                <DemoLock>
                    {(locked) => (
                        <button
                            type="button"
                            disabled={locked || !canConfirm}
                            onClick={onConfirm}
                            className={`inline-flex h-[34px] items-center rounded border px-3 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-50 max-sm:h-11 ${isRemoval ? "border-danger-text bg-surface text-danger-text hover:bg-danger-tint" : "border-transparent bg-accent text-accent-ink hover:opacity-90"}`}
                        >
                            {isRemoval ? "Remove and apply" : "Apply"}
                        </button>
                    )}
                </DemoLock>
            </div>
        </div>
    );
}
