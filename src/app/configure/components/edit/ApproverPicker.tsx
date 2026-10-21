"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { useDebouncedSearch, type FoundPrincipal, type PrincipalSearchFn } from "@/hooks/useUserSearch";
import type { ApproverRef } from "@/utils/policyRules";

interface ApproverPickerProps {
    approvers: readonly ApproverRef[];
    onChange: (approvers: ApproverRef[]) => void;
    disabled?: boolean;
    /** A group with approval on: the last approver cannot be removed (groups have no default approvers) */
    keepLast?: boolean;
    /** Users and groups by name (Graph in the app, the fixture's own list on the fixture page) */
    search: PrincipalSearchFn;
    /** Which results may be picked (Add people for a role: only role-assignable groups); all when absent */
    accept?: (found: FoundPrincipal) => boolean;
    /** The name of the chip list and of the Add button (Add people reuses the picker) */
    listLabel?: string;
    addLabel?: string;
}

const nameOf = (a: ApproverRef) => (a.type === "manager" ? "Manager" : a.displayName && a.displayName !== a.id ? a.displayName : a.id);

/**
 * The approvers of spec 5.5: chips with remove, "Add" opens a search over users and groups (3 characters, debounced).
 * The combobox follows the WAI-ARIA pattern: the input owns a listbox, the arrows move the active option, Enter picks it.
 */
export function ApproverPicker({ approvers, onChange, disabled = false, keepLast = false, search, accept, listLabel = "Approvers", addLabel = "Add" }: ApproverPickerProps) {
    const [isAdding, setIsAdding] = useState(false);
    const [active, setActive] = useState(0);
    const exclude = useMemo(() => new Set(approvers.map((a) => a.id.toLowerCase())), [approvers]);
    const finder = useDebouncedSearch(exclude, search);
    const results = accept ? finder.results.filter(accept) : finder.results;
    const listId = useId();
    const addRef = useRef<HTMLButtonElement>(null);
    // The search field goes when it closes: focus returns to Add (it renders again on the next paint)
    const close = () => {
        finder.reset();
        setActive(0);
        setIsAdding(false);
        requestAnimationFrame(() => addRef.current?.focus());
    };

    const pick = (index: number) => {
        const found = results[index];
        if (!found) return;
        onChange([...approvers, { id: found.id, type: found.kind, displayName: found.displayName }]);
        close();
    };

    return (
        <div className="flex flex-col gap-2">
            {approvers.length > 0 && (
                <ul className="flex flex-wrap gap-1.5" aria-label={listLabel}>
                    {approvers.map((a) => (
                        <li key={`${a.type}:${a.id}`} className="inline-flex h-7 items-center gap-1.5 rounded border border-line bg-surface pr-1 pl-2 text-[13px] text-ink">
                            <Icon name={a.type === "group" ? "group" : "user"} size={16} className="text-muted" />
                            {nameOf(a)}
                            <button
                                type="button"
                                disabled={disabled || (keepLast && approvers.length === 1)}
                                title={keepLast && approvers.length === 1 ? "Groups need at least one approver while approval is on." : undefined}
                                onClick={() => onChange(approvers.filter((x) => !(x.type === a.type && x.id === a.id)))}
                                aria-label={keepLast && approvers.length === 1 ? `${nameOf(a)} is the last approver and stays while approval is on` : `Remove ${nameOf(a)}`}
                                className="inline-flex h-5 w-5 items-center justify-center rounded text-muted hover:bg-page hover:text-ink disabled:opacity-50 max-sm:h-11 max-sm:w-11"
                            >
                                <Icon name="close" size={16} />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            {isAdding ? (
                <div className="relative">
                    <input
                        type="text"
                        role="combobox"
                        aria-expanded={results.length > 0}
                        aria-autocomplete="list"
                        aria-controls={results.length > 0 ? listId : undefined}
                        aria-activedescendant={results.length > 0 ? `${listId}-${active}` : undefined}
                        aria-label="Search people and groups"
                        // A field the admin opened on purpose takes focus
                        autoFocus
                        value={finder.term}
                        placeholder="Name of a person or group"
                        onChange={(event) => { finder.setTerm(event.target.value); setActive(0); }}
                        onKeyDown={(event) => {
                            if (event.key === "ArrowDown") { event.preventDefault(); setActive((i) => Math.min(i + 1, Math.max(0, results.length - 1))); }
                            else if (event.key === "ArrowUp") { event.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
                            else if (event.key === "Enter") { event.preventDefault(); pick(active); }
                            else if (event.key === "Escape") close();
                        }}
                        className="h-[34px] w-full rounded border border-line bg-surface px-3 text-sm text-ink placeholder:text-muted max-sm:h-11"
                    />
                    <p className="mt-1 text-xs text-muted" aria-live="polite">
                        {finder.term.trim().length < finder.minLength ? `Type at least ${finder.minLength} characters.` : finder.isSearching ? "Searching…" : finder.error ? finder.error : results.length === 0 ? "Nobody found." : ""}
                    </p>
                    {results.length > 0 && (
                        <ul id={listId} role="listbox" aria-label="People and groups found" className="absolute z-20 mt-1 w-full overflow-hidden rounded border border-line bg-surface shadow-thumb">
                            {results.map((found, index) => (
                                <li
                                    key={found.id}
                                    id={`${listId}-${index}`}
                                    role="option"
                                    aria-selected={index === active}
                                    onMouseDown={(event) => { event.preventDefault(); pick(index); }}
                                    onMouseEnter={() => setActive(index)}
                                    className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-[13px] ${index === active ? "bg-accent-tint text-ink" : "text-body"}`}
                                >
                                    <Icon name={found.kind === "group" ? "group" : "user"} size={16} className="text-muted" />
                                    <span className="min-w-0 flex-1 truncate">{found.displayName}</span>
                                    <span className="truncate text-xs text-muted">{found.kind === "group" ? "Group" : found.userPrincipalName}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            ) : (
                <button
                    ref={addRef}
                    type="button"
                    disabled={disabled}
                    onClick={() => setIsAdding(true)}
                    className="inline-flex h-[30px] w-fit items-center gap-1.5 rounded border border-line bg-surface px-2.5 text-[13px] font-medium text-ink hover:bg-page disabled:cursor-not-allowed disabled:opacity-50 max-sm:h-11"
                >
                    <Icon name="add" size={16} />
                    {addLabel}
                </button>
            )}
        </div>
    );
}
