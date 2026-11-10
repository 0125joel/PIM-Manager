"use client";

import { useEffect, useMemo, useState } from "react";
import { useAzureActions, useAzureData } from "@/contexts/AzureContext";
import { loadAzureRoleDefinitions, loadAzureServicePrincipalTypes } from "@/hooks/useAzureDashboardReads";
import { readAzureRolePolicyPairs, type AzureRolePolicyPair } from "@/hooks/useAzureRolePolicy";
import { useGraphClient } from "@/hooks/usePimSelectors";
import type { AzureAssignment, AzureScope } from "@/types/azureResource.types";
import { directoryLookupIds } from "@/utils/azureDashboard";
import { buildAssignmentRows, type AzureFilterContext, type AzureReportFilters } from "@/utils/azureReport";
import { azurePolicyKey, isRootScope } from "@/utils/azureScopes";
import { Logger } from "@/utils/logger";

export interface AzureReportFilterContextState {
    context: AzureFilterContext;
    /** Role settings being read for a filter on settings; null when none is needed */
    settingsProgress: { done: number; total: number } | null;
}

type Definitions = NonNullable<AzureFilterContext["definitions"]>;
type SpTypes = NonNullable<AzureFilterContext["spTypes"]>;
type Settings = NonNullable<AzureFilterContext["settings"]>;

/**
 * What the Azure Report filters need beyond the assignments, read only when a filter asks for it: role definitions for
 * Privileged and the role settings for the policy keys. The service principal types, and which principals are deleted,
 * are read once per load whenever something holds a role, for the managed identity and Deleted tags and the Held by filters.
 */
export function useAzureReportFilterContext(filters: AzureReportFilters, assignments: AzureAssignment[], scopes: AzureScope[], selectedId: string | null, emergencyIds: ReadonlySet<string>, homeTenantId: string | undefined): AzureReportFilterContextState {
    const { getArmClient } = useAzureActions();
    const { loadKey } = useAzureData();
    const getGraph = useGraphClient();
    const [definitions, setDefinitions] = useState<Definitions | null>(null);
    const [spTypes, setSpTypes] = useState<SpTypes | null>(null);
    const [settings, setSettings] = useState<Settings | null>(null);
    const [settingsProgress, setSettingsProgress] = useState<{ done: number; total: number } | null>(null);

    const needsDefinitions = filters.privileged;
    // Always read when something holds a role: the tags tell an app from a managed identity and show a deleted principal (Graph reads once per load)
    const needsSpTypes = assignments.length > 0;
    const policyKeys = filters.approval !== "all" || filters.justification !== "all" || filters.mfa !== "all" || filters.maxDuration !== "all" || filters.notified !== "all";

    useEffect(() => {
        if (!needsDefinitions) return;
        const controller = new AbortController();
        loadAzureRoleDefinitions(getArmClient(), scopes, controller.signal)
            .then((state) => {
                if (!controller.signal.aborted && (state.status === "loaded" || state.status === "partial")) setDefinitions(state.byId);
            })
            .catch(() => {
                if (!controller.signal.aborted) Logger.warn("Azure", "The role definitions could not be read for the filter");
            });
        return () => controller.abort();
    }, [needsDefinitions, scopes, getArmClient]);

    useEffect(() => {
        if (!needsSpTypes) return;
        const controller = new AbortController();
        loadAzureServicePrincipalTypes(getGraph, assignments, loadKey, controller.signal, undefined, directoryLookupIds(assignments, scopes, homeTenantId))
            .then((state) => {
                if (!controller.signal.aborted && state.status === "loaded") setSpTypes(state.byId);
            })
            .catch(() => {
                if (!controller.signal.aborted) Logger.warn("Azure", "The service principal types could not be read for the filter");
            });
        return () => controller.abort();
    }, [needsSpTypes, assignments, scopes, homeTenantId, loadKey, getGraph]);

    // The rows the policy keys narrow down: every other filter applied, the policy keys left out
    const pairs = useMemo<AzureRolePolicyPair[]>(() => {
        if (!policyKeys) return [];
        const rows = buildAssignmentRows(
            assignments,
            scopes,
            selectedId,
            { ...filters, approval: "all", justification: "all", mfa: "all", maxDuration: "all", notified: "all" },
            new Date(),
            { definitions, spTypes, emergencyIds },
        );
        const found = new Map<string, AzureRolePolicyPair>();
        for (const { assignment } of rows) {
            if (isRootScope(assignment.scopeId)) continue;
            const key = azurePolicyKey(assignment.scopeId, assignment.roleDefinitionId);
            if (!found.has(key)) found.set(key, { scopeId: assignment.scopeId, roleDefinitionId: assignment.roleDefinitionId });
        }
        return [...found.values()];
    }, [policyKeys, assignments, scopes, selectedId, filters, definitions, spTypes, emergencyIds]);
    const pairsKey = useMemo(() => pairs.map((p) => azurePolicyKey(p.scopeId, p.roleDefinitionId)).sort().join("|"), [pairs]);

    useEffect(() => {
        if (!policyKeys) return;
        const controller = new AbortController();
        setSettingsProgress({ done: 0, total: pairs.length });
        readAzureRolePolicyPairs(getArmClient(), pairs, {
            signal: controller.signal,
            onProgress: (done, total) => {
                if (!controller.signal.aborted) setSettingsProgress({ done, total });
            },
        })
            .then((map) => {
                if (controller.signal.aborted) return;
                setSettings(map);
                setSettingsProgress(null);
            })
            .catch(() => {
                if (controller.signal.aborted) return;
                Logger.warn("Azure", "The role settings could not be read for the filter");
                setSettingsProgress(null);
            });
        return () => controller.abort();
        // The pairs are keyed by their content, so a new array with the same pairs does not read again
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [policyKeys, pairsKey, getArmClient]);

    const context = useMemo<AzureFilterContext>(
        () => ({
            ...(needsDefinitions && definitions ? { definitions } : {}),
            ...(needsSpTypes && spTypes ? { spTypes } : {}),
            ...(policyKeys && settings ? { settings } : {}),
            emergencyIds,
        }),
        [needsDefinitions, definitions, needsSpTypes, spTypes, policyKeys, settings, emergencyIds],
    );
    return { context, settingsProgress: policyKeys ? settingsProgress : null };
}
