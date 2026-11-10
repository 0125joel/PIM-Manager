"use client";

import { useMemo, useRef, useState } from "react";
import { ScopeTree } from "@/app/azure/report/components/ScopeTree";
import { Icon } from "@/components/icons/Icon";
import { Chip } from "@/components/ui/Chip";
import { Dialog } from "@/components/ui/Dialog";
import { Tag } from "@/components/ui/Tag";
import type { AzureScope } from "@/types/azureResource.types";
import { flattenScopeTree, visibleScopeRows } from "@/utils/azureReport";
import { azureScopePath, countAzureScopes } from "@/utils/azureDashboardView";

interface AzureScopeBarProps {
    scopes: AzureScope[];
    /** null: "All you can read" */
    chosenScopeId: string | null;
    homeTenantId?: string;
    /** The display name of the user's tenant; "your tenant" until it is known */
    tenantName: string;
    includeInherited: boolean;
    includeDelegated: boolean;
    /** null: back to "All you can read" */
    onSelectScope: (id: string | null) => void;
    onIncludeInheritedChange: (isOn: boolean) => void;
    onIncludeDelegatedChange: (isOn: boolean) => void;
    /** While the load runs the counts are 0 of 0: the visibility line is hidden */
    isVisibilityHidden?: boolean;
    /** Details off (calm details spec 3.4): no counts after the path, no delegated count or Lighthouse tag, no Include inherited at the top scope, no visibility line */
    isCompact?: boolean;
}

function plural(n: number, one: string, many: string): string {
    return `${n} ${n === 1 ? one : many}`;
}

/** The scope bar of the Azure dashboard (dashboard spec 5.1): the scope, Include inherited, Delegated subscriptions and the visibility line. */
export function AzureScopeBar({ scopes, chosenScopeId, homeTenantId, tenantName, includeInherited, includeDelegated, onSelectScope, onIncludeInheritedChange, onIncludeDelegatedChange, isVisibilityHidden = false, isCompact = false }: AzureScopeBarProps) {
    const [isSheetOpen, setIsSheetOpen] = useState(false);
    const pathButton = useRef<HTMLButtonElement>(null);
    const counts = useMemo(() => countAzureScopes(scopes, homeTenantId), [scopes, homeTenantId]);
    const path = useMemo(() => azureScopePath(scopes, chosenScopeId), [scopes, chosenScopeId]);
    const rows = useMemo(() => visibleScopeRows(flattenScopeTree(scopes), chosenScopeId), [scopes, chosenScopeId]);
    const isTopScope = chosenScopeId === null || path.length === 0;

    // Dialog returns focus to its opener only when the user closes it; a close by the parent does not, so the bar does it
    const select = (id: string | null) => {
        onSelectScope(id);
        setIsSheetOpen(false);
        requestAnimationFrame(() => pathButton.current?.focus());
    };

    return (
        <div className="flex flex-wrap items-center gap-2.5 rounded border border-line bg-surface px-3 py-2.5" data-tour="azure-scope">
            <span className="font-mono text-xs text-muted">scope</span>
            <button
                ref={pathButton}
                type="button"
                onClick={() => setIsSheetOpen(true)}
                className="inline-flex min-h-8 min-w-0 items-center gap-2 rounded border border-line px-2.5 text-[13px] leading-5 text-ink transition-colors duration-150 hover:bg-page max-sm:min-h-11 max-sm:w-full"
            >
                <Icon name="scope" size={16} className="shrink-0" />
                {isTopScope ? (
                    <>
                        <span className="shrink-0 font-medium">All you can read</span>
                        {!isCompact && <span className="min-w-0 truncate text-muted max-sm:hidden">{`· ${plural(counts.managementGroups, "management group", "management groups")}, ${plural(counts.subscriptions, "subscription", "subscriptions")}`}</span>}
                        {!isCompact && <span className="min-w-0 truncate text-muted sm:hidden">{`· ${plural(counts.subscriptions, "subscription", "subscriptions")}`}</span>}
                    </>
                ) : (
                    <span className="min-w-0 truncate">
                        {path.map((name, index) => (
                            <span key={index}>
                                {index > 0 && <span className="text-muted"> › </span>}
                                <span className={index === path.length - 1 ? "font-medium" : undefined}>{name}</span>
                            </span>
                        ))}
                    </span>
                )}
                <Icon name="chevron-down" size={16} className="ml-auto shrink-0 text-muted" />
            </button>
            {!(isCompact && isTopScope) && (
                <Chip
                    kind="toggle"
                    label="Include inherited"
                    isOn={includeInherited}
                    onToggle={() => onIncludeInheritedChange(!includeInherited)}
                    isDisabled={isTopScope}
                    disabledReason="Nothing above this scope"
                />
            )}
            {counts.delegatedSubscriptions > 0 && (
                <>
                    <span aria-hidden="true" className="h-5 w-px bg-line max-sm:hidden" />
                    <span className="inline-flex items-center gap-2">
                        <Chip kind="toggle" label="Delegated subscriptions" isOn={includeDelegated} onToggle={() => onIncludeDelegatedChange(!includeDelegated)} />
                        {!isCompact && <span className="font-mono text-xs text-muted">{counts.delegatedSubscriptions}</span>}
                        {!isCompact && <Tag variant="accent">Lighthouse</Tag>}
                    </span>
                </>
            )}
            {!isVisibilityHidden && !isCompact && <p className="text-[13px] leading-5 text-body sm:ml-auto max-sm:w-full">
                {"You can read "}
                <span className="font-mono">{counts.readableAllSubscriptions}</span>
                {/* The total holds the delegated ones: the brackets split the total, not what you can read */}
                {counts.delegatedSubscriptions > 0 ? (
                    <>
                        {" of the "}
                        <span className="font-mono">{counts.subscriptions}</span>
                        {" subscriptions ("}
                        <span className="font-mono">{counts.homeSubscriptions}</span>
                        {` in ${tenantName}, `}
                        <span className="font-mono">{counts.delegatedSubscriptions}</span>
                        {" delegated)"}
                    </>
                ) : (
                    <>
                        {" of "}
                        <span className="font-mono">{counts.subscriptions}</span>
                        {` subscriptions in ${tenantName}`}
                    </>
                )}
                {"."}
            </p>}
            <Dialog isOpen={isSheetOpen} onClose={() => setIsSheetOpen(false)} title="Scope" width={400}>
                <button
                    type="button"
                    aria-current={isTopScope ? "true" : undefined}
                    onClick={() => select(null)}
                    className={`mb-1 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm leading-5 hover:bg-page max-sm:min-h-11 ${isTopScope ? "bg-accent-tint font-medium text-accent" : "text-body"}`}
                >
                    <Icon name="scope" size={16} />
                    All you can read
                </button>
                <ScopeTree rows={rows} selectedId={chosenScopeId} onSelect={select} homeTenantId={homeTenantId} />
            </Dialog>
        </div>
    );
}
