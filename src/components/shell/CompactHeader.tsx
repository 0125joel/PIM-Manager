"use client";

import Link from "next/link";
import { Icon } from "@/components/icons/Icon";

interface CompactHeaderProps {
    tenantName: string | null;
    isRefreshing: boolean;
    onRefresh: () => void;
}

/** Header below 640 (spec 3.2): wordmark, a mono line with the tenant, and the global Refresh. */
export function CompactHeader({ tenantName, isRefreshing, onRefresh }: CompactHeaderProps) {
    return (
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-surface pl-4 pr-1 sm:hidden">
            <div className="min-w-0">
                <Link href="/dashboard" data-tour="app-title" className="block text-base leading-5 font-semibold text-ink">
                    PIM Manager
                </Link>
                <p className="truncate font-mono text-[11px] leading-4 text-muted">{tenantName ? `${tenantName.toLowerCase()} · entra id` : "entra id"}</p>
            </div>
            <button
                type="button"
                onClick={onRefresh}
                disabled={isRefreshing}
                aria-label="Refresh data"
                className="inline-flex h-11 w-11 items-center justify-center rounded text-ink transition-colors duration-150 hover:bg-page disabled:opacity-50"
            >
                <Icon name="refresh" size={20} />
            </button>
        </header>
    );
}
