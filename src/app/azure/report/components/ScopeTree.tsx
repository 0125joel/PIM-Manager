"use client";

import type { KeyboardEvent } from "react";
import { Icon } from "@/components/icons/Icon";
import { Tag } from "@/components/ui/Tag";
import { getNextIndex } from "@/utils/rovingFocus";
import { scopeIconFor } from "@/utils/azureResourceIcons";
import type { ScopeTreeRow } from "@/utils/azureReport";
import { isDelegatedScope } from "@/utils/azureReportStates";
import { AZURE_TERMS } from "@/config/help/azureReportTerms";

const DEPTH_PADDING = ["pl-2", "pl-6", "pl-10", "pl-14", "pl-[72px]", "pl-[88px]"];

interface ScopeTreeProps {
    rows: ScopeTreeRow[];
    selectedId: string | null;
    onSelect: (id: string) => void;
    /** The tenant of the user: a subscription of another tenant (Azure Lighthouse) is marked Delegated */
    homeTenantId?: string;
}

/** The scope tree as a list of buttons with one tab stop and arrow key navigation. */
export function ScopeTree({ rows, selectedId, onSelect, homeTenantId }: ScopeTreeProps) {
    const selectedKey = selectedId === null ? null : selectedId.toLowerCase();
    const hasSelectedRow = rows.some((row) => row.scope.id.toLowerCase() === selectedKey);

    const handleKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
        const current = buttons.findIndex((button) => button === document.activeElement);
        const next = getNextIndex(event.key, current, buttons.length, "vertical");
        if (next === null) return;
        event.preventDefault();
        buttons[next].focus();
    };

    return (
        <nav aria-label="Scopes">
            <p className="mb-1.5 px-2 text-xs uppercase tracking-[0.04em] text-muted">Scopes</p>
            <ul onKeyDown={handleKeyDown}>
                {rows.map((row, index) => {
                    const isSelected = row.scope.id.toLowerCase() === selectedKey;
                    const hasTabStop = hasSelectedRow ? isSelected : index === 0;
                    const classes = [
                        "flex w-full items-center gap-2 rounded py-1.5 pr-2 text-left leading-5 hover:bg-page max-sm:min-h-11",
                        row.scope.level === "resource" ? "text-[13px]" : "text-sm",
                        isSelected ? "bg-accent-tint font-medium text-accent" : "text-body",
                        DEPTH_PADDING[Math.min(row.depth, 5)],
                    ].join(" ");
                    return (
                        <li key={row.scope.id}>
                            <button
                                type="button"
                                aria-current={isSelected ? "true" : undefined}
                                tabIndex={hasTabStop ? 0 : -1}
                                onClick={() => onSelect(row.scope.id)}
                                className={classes}
                            >
                                <Icon name={scopeIconFor(row.scope)} size={16} />
                                {/* The tags wrap to a second line when the name needs the room, so a scope name is not cut for a tag */}
                                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                                    <span className="min-w-0 truncate">{row.scope.name}</span>
                                    {(isDelegatedScope(row.scope, homeTenantId) || row.scope.access !== undefined) && (
                                        <span className="ml-auto flex shrink-0 gap-1">
                                            {/* No tip: a tag with a tip is focusable, and a control inside the scope button is not allowed. The help panel lists the terms */}
                                            {isDelegatedScope(row.scope, homeTenantId) && <Tag>{AZURE_TERMS.delegated.label}</Tag>}
                                            {row.scope.access === "loading" && <Tag>{AZURE_TERMS.scopeLoading.label}</Tag>}
                                            {row.scope.access === "partial" && <Tag>{AZURE_TERMS.partial.label}</Tag>}
                                            {row.scope.access === "failed" && <Tag>{AZURE_TERMS.scopeFailed.label}</Tag>}
                                        </span>
                                    )}
                                </span>
                            </button>
                        </li>
                    );
                })}
            </ul>
        </nav>
    );
}
