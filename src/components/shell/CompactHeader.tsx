"use client";

import Link from "next/link";
import { Icon } from "@/components/icons/Icon";
import { homePathFor, type Environment } from "@/utils/shellNavigation";

interface CompactHeaderProps {
    tenantName: string | null;
    /** The environment of the route, named in the mono line (Azure spec 1) */
    environment: Environment;
    isRefreshing: boolean;
    onRefresh: () => void;
}

const ENVIRONMENT_LABEL: Record<Environment, string> = { entra: "entra id", azure: "azure" };

/** Header below 640 (spec 3.2): wordmark, a mono line with the tenant and the environment, and the global Refresh. */
export function CompactHeader({ tenantName, environment, isRefreshing, onRefresh }: CompactHeaderProps) {
    const label = ENVIRONMENT_LABEL[environment];
    return (
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-surface pl-4 pr-1 sm:hidden">
            <div className="min-w-0">
                <Link href={homePathFor(environment)} data-tour="app-title" className="block text-base leading-5 font-semibold text-ink">
                    PIM Manager
                </Link>
                <p className="truncate font-mono text-[11px] leading-4 text-muted">{tenantName ? `${tenantName.toLowerCase()} · ${label}` : label}</p>
            </div>
            <button
                type="button"
                data-tour="refresh"
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
