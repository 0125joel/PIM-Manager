"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuditUrlState, type AuditUrlActions } from "@/hooks/useAuditUrlState";

/** The longest period of the Azure Audit page, and what it opens on */
export const AZURE_AUDIT_MAX_DAYS = 90;
export const AZURE_AUDIT_DEFAULT_DAYS = 30;
/** With a workspace that reaches further the page opens on this period, as on Entra, never more than the source keeps */
const AZURE_AUDIT_WORKSPACE_DEFAULT_DAYS = 180;

/** The period without a `days` parameter: 30 days, or 180 when a workspace reaches beyond the 90 days of the native log */
export function azureAuditDefaultDays(maxDays: number = AZURE_AUDIT_MAX_DAYS): number {
    return maxDays > AZURE_AUDIT_MAX_DAYS ? Math.min(AZURE_AUDIT_WORKSPACE_DEFAULT_DAYS, maxDays) : AZURE_AUDIT_DEFAULT_DAYS;
}

export interface AzureAuditUrlActions extends AuditUrlActions {
    /** The chosen scope id; null is All you can read */
    scopeId: string | null;
    /** `delegated=0` turns the delegated subscriptions off, as on the Azure dashboard */
    includeDelegated: boolean;
    /** `inherited=1` turns Include inherited on */
    includeInherited: boolean;
    setScope: (id: string | null) => void;
    setIncludeDelegated: (isOn: boolean) => void;
    setIncludeInherited: (isOn: boolean) => void;
}

/**
 * The URL state of the Azure Audit page: the Audit page's own (`days` 1 to 90, 30 by default) and the scope bar's `scope`,
 * `delegated=0` and `inherited=1`. Azure has no Environment, so `state` always has `env: "both"`, whatever the URL says. The scope bar writes with `router.push`, keeping every other parameter.
 */
export function useAzureAuditUrlState(maxDays: number = AZURE_AUDIT_MAX_DAYS): AzureAuditUrlActions {
    const base = useAuditUrlState(maxDays, azureAuditDefaultDays(maxDays));
    const router = useRouter();
    const pathname = usePathname() ?? "/azure/audit";
    const searchParams = useSearchParams();
    const search = searchParams?.toString() ?? "";
    const params = useMemo(() => new URLSearchParams(search), [search]);
    const scopeId = params.get("scope")?.trim() || null;
    const includeDelegated = params.get("delegated") !== "0";
    const includeInherited = params.get("inherited") === "1";

    const state = useMemo(() => ({ ...base.state, env: "both" as const }), [base.state]);

    const write = useCallback((change: (next: URLSearchParams) => void) => {
        const next = new URLSearchParams(search);
        change(next);
        const query = next.toString();
        router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }, [router, pathname, search]);

    const setScope = useCallback((id: string | null) => write((next) => {
        if (id === null) next.delete("scope");
        else next.set("scope", id);
    }), [write]);
    const setIncludeDelegated = useCallback((isOn: boolean) => write((next) => {
        if (isOn) next.delete("delegated");
        else next.set("delegated", "0");
    }), [write]);
    const setIncludeInherited = useCallback((isOn: boolean) => write((next) => {
        if (isOn) next.set("inherited", "1");
        else next.delete("inherited");
    }), [write]);

    return { ...base, state, scopeId, includeDelegated, includeInherited, setScope, setIncludeDelegated, setIncludeInherited };
}
