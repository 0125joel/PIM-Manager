"use client";

import { Icon } from "@/components/icons/Icon";
import type { EntryLock } from "@/utils/configureStart";
import type { ConfigureMode } from "@/utils/configureUrlState";
import { MODES } from "./modes";

interface EntryCardsProps {
    tenantName: string;
    lock: EntryLock;
    onOpen: (mode: Exclude<ConfigureMode, "model">) => void;
}

const ENTRIES = (tenant: string): { mode: Exclude<ConfigureMode, "model">; text: string; when: string }[] => [
    { mode: "guided", text: "Set the same rules on several roles or groups, step by step. Start from the current settings, a copy of another role, or the access model.", when: "When you want the order done for you: a baseline, a new tenant, a yearly review" },
    { mode: "edit", text: "Open a role or group, change any setting, add or remove people. Select several to change them together. Changes wait until you review them.", when: "When you know what to change" },
    { mode: "import", text: `Role or group settings and assignments from a CSV, or an access model file from PIM Monitor. Every row is checked against ${tenant} first.`, when: "When you have many rows, or a round trip from the Report" },
];

/** The three entry cards of the start page (spec 4): each card is one button; locked until the admin may change something */
export function EntryCards({ tenantName, lock, onOpen }: EntryCardsProps) {
    const isLocked = lock.kind !== "none";
    return (
        <div className="mb-4 grid gap-4 min-[900px]:grid-cols-3">
            {ENTRIES(tenantName).map(({ mode, text, when }) => {
                const info = MODES[mode];
                return (
                    <button
                        key={mode}
                        type="button"
                        aria-labelledby={`entry-name-${mode}`}
                        aria-disabled={isLocked || undefined}
                        aria-describedby={`entry-text-${mode} entry-when-${mode}${isLocked && lock.kind !== "checking" ? ` entry-lock-${mode}` : ""}`}
                        onClick={() => { if (!isLocked) onOpen(mode); }}
                        className={`flex flex-col items-start rounded border border-line bg-surface p-4 text-left transition-colors duration-150 ${isLocked ? "cursor-not-allowed" : "hover:border-accent"}`}
                    >
                        <span className="flex items-center gap-3">
                            <span className={`inline-flex h-9 w-9 items-center justify-center rounded ${info.tile} ${isLocked ? "opacity-60" : ""}`}><Icon name={info.icon} size={20} /></span>
                            <span id={`entry-name-${mode}`} className="text-base font-semibold text-ink">{info.name}</span>
                        </span>
                        <span id={`entry-text-${mode}`} className="mt-3 text-sm text-body">{text}</span>
                        <span id={`entry-when-${mode}`} className="mt-2 text-xs text-muted">{when}</span>
                        {(lock.kind === "closed" || lock.kind === "consent") && (
                            <span id={`entry-lock-${mode}`} className="mt-3 flex items-center gap-1.5 text-xs text-muted">
                                <Icon name={lock.kind === "consent" ? "key" : "lock"} size={16} />{lock.text}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}
