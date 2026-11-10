/**
 * Azure Report states: which view the page shows, the loading percentage, whether filters are set and the row of the
 * user's own roles. Pure logic, no React.
 */
import type { ArmRoleScheduleInstance, AzureScope } from "@/types/azureResource.types";
import type { LoadingPhase } from "@/types/workload.types";
import { EMPTY_AZURE_FILTERS, endTextFor, type AzureReportFilters } from "@/utils/azureReport";
import { toAssignment } from "@/utils/azureScopes";
import { formatSyncedAgo } from "@/utils/loadingStatus";

/** The user's own active and eligible roles (Azure spec 15.5): null while they are read, "failed" when a read failed */
export type MyAzureRolesState = { active: MyAzureRoleRow[]; eligible: MyAzureRoleRow[] } | "failed" | null;

export type AzureReportView = "loading" | "empty" | "failed" | "report";

export interface MyAzureRoleRow {
    id: string;
    roleName: string;
    scopeName: string;
    /** "Permanent" or the end date, as the table */
    endText: string;
    isPermanent: boolean;
}

/** The first rule that holds wins: data shows the report, then error, then complete (nothing readable), else loading */
export function azureReportView(input: { phase: LoadingPhase; scopeCount: number }): AzureReportView {
    if (input.scopeCount > 0) return "report";
    if (input.phase === "error") return "failed";
    if (input.phase === "complete") return "empty";
    return "loading";
}

/** Null when the total is not known */
export function loadingPercent(progress: { current: number; total: number }): number | null {
    if (progress.total <= 0) return null;
    return Math.min(100, Math.round((progress.current / progress.total) * 100));
}

/** Whether the user narrowed the rows: a search, Origin Inherited or any other filter. Origin This scope is the default, All hides nothing */
export function isFiltered(filters: AzureReportFilters): boolean {
    return (
        filters.query.trim() !== ""
        || filters.origin === "inherited"
        || filters.status !== EMPTY_AZURE_FILTERS.status
        || filters.privileged !== EMPTY_AZURE_FILTERS.privileged
        || filters.principalType !== EMPTY_AZURE_FILTERS.principalType
        || filters.ends !== EMPTY_AZURE_FILTERS.ends
        || filters.level !== EMPTY_AZURE_FILTERS.level
        || filters.resourceType !== EMPTY_AZURE_FILTERS.resourceType
        || filters.customRole !== EMPTY_AZURE_FILTERS.customRole
        || filters.approval !== EMPTY_AZURE_FILTERS.approval
        || filters.justification !== EMPTY_AZURE_FILTERS.justification
        || filters.mfa !== EMPTY_AZURE_FILTERS.mfa
        || filters.maxDuration !== EMPTY_AZURE_FILTERS.maxDuration
        || filters.notified !== EMPTY_AZURE_FILTERS.notified
        || filters.via !== EMPTY_AZURE_FILTERS.via
        || filters.noEligible !== EMPTY_AZURE_FILTERS.noEligible
        || filters.excludeEmergency !== EMPTY_AZURE_FILTERS.excludeEmergency
        || filters.role !== EMPTY_AZURE_FILTERS.role
    );
}

export function toMyRoleRow(instance: ArmRoleScheduleInstance): MyAzureRoleRow {
    const a = toAssignment(instance);
    return {
        id: a.id,
        roleName: a.roleName,
        scopeName: instance.properties.expandedProperties?.scope?.displayName ?? a.scopeId,
        endText: endTextFor(a.endDateTime),
        isPermanent: a.endDateTime === null,
    };
}

/** "synced 3 min ago" while nothing loads; undefined without a load time or while loading */
export function azureSyncedText(lastFetched: string | undefined, phase: LoadingPhase, now: Date): string | undefined {
    if (lastFetched === undefined) return undefined;
    const syncedAt = Date.parse(lastFetched);
    if (Number.isNaN(syncedAt)) return undefined;
    if (phase === "fetching" || phase === "processing") return undefined;
    return formatSyncedAgo(new Date(lastFetched), now);
}

export { isDelegatedScope } from "@/utils/azureScopes";

/** The subscriptions whose resource groups and resources are still being read (Azure spec 15.5): export of all scopes waits for them */
export function loadingSubscriptionCount(scopes: readonly Pick<AzureScope, "level" | "access">[]): number {
    return scopes.filter((s) => s.level === "subscription" && s.access === "loading").length;
}
