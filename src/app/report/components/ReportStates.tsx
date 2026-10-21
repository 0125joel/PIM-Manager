"use client";

import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatusBox } from "@/components/ui/StatusBox";
import type { FailedRolesSummary } from "@/utils/reportStates";

/** Rows of skeleton for a list that has not arrived (spec 7.1). No spinner. */
export function ListSkeleton() {
    return <div aria-busy="true" className="flex flex-col gap-3 rounded border border-line bg-surface p-3">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} width="100%" height={44} />)}</div>;
}

/** The detail while the fast phase runs: a head and two blocks of skeleton (spec 7.1). */
export function DetailSkeleton() {
    return (
        <div aria-busy="true" className="rounded border border-line bg-surface p-5 sm:p-6">
            <Skeleton className="block" width={240} height={28} />
            <Skeleton className="mt-3 block" width="70%" height={16} />
            <div className="mt-8 flex flex-col gap-3">{[0, 1, 2].map((i) => <Skeleton key={i} width="100%" height={56} />)}</div>
        </div>
    );
}

/** "No roles match" in the list column, naming the search and the filters, with Clear filters (spec 7.4). */
export function NoMatch({ title, detail, onClear }: { title: string; detail: string; onClear: () => void }) {
    return (
        <div className="rounded border border-line bg-surface p-4">
            <p className="text-sm font-medium text-ink">{title}</p>
            {detail && <p className="mt-1 text-[13px] text-muted">{detail}</p>}
            <Button className="mt-3" size="sm" onClick={onClear}>Clear filters</Button>
        </div>
    );
}

/** The settings of some roles could not be read: one box above the list with a retry for those roles only (spec 7.6). */
export function FailedRolesBox({ summary, onRetry, isRetrying = false }: { summary: FailedRolesSummary; onRetry: () => void; isRetrying?: boolean }) {
    return (
        <StatusBox variant="error" title={summary.title} action={<Button size="sm" isLoading={isRetrying} onClick={onRetry}>Try again</Button>}>
            {summary.cause}
        </StatusBox>
    );
}

/** Everything failed: the list and detail area is replaced by one box (spec 7.7). */
export function AllFailedBox({ what = "roles", cause, onRetry }: { what?: "roles" | "groups"; cause: string; onRetry: () => void }) {
    return (
        <StatusBox variant="error" title={`The ${what} could not be loaded`} action={<Button onClick={onRetry}>Try again</Button>}>
            {`${cause} ${what === "roles" ? "Check that the account may read role management, then try again." : "Check that the account may read PIM for Groups, then try again."}`}
        </StatusBox>
    );
}

/** Graph did not report which roles are privileged: a one-line warning under the toolbar (spec 7). */
export function PrivilegedStatusWarning() {
    return (
        <StatusBox variant="warn" title="Privileged status is missing for some roles">
            Microsoft Graph did not report it for every role, so those roles show no Privileged tag.
        </StatusBox>
    );
}
