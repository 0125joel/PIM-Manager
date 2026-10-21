"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useRolesLoading } from "@/hooks/usePimData";
import { usePimGroupsLoading, useUnifiedActions } from "@/hooks/usePimSelectors";
import type { WorkloadType } from "@/types/workload.types";

interface RefreshButtonViewProps {
    isDisabled: boolean;
    /** The spinner shows inside the button while the run that this button started is going */
    isLoading?: boolean;
    onRefresh: () => void;
    className?: string;
}

/** The look of the shared Refresh button without any context, for fixture routes and tests. */
export function RefreshButtonView({ isDisabled, isLoading = false, onRefresh, className = "" }: RefreshButtonViewProps) {
    return (
        // The icon keeps the button readable where the label is hidden (640 to 1023; N-045, spec 2.1 of the Report)
        <Button icon="refresh" onClick={onRefresh} disabled={isDisabled} isLoading={isLoading} className={className}>
            <span className="max-lg:sr-only">Refresh</span>
        </Button>
    );
}

interface RefreshButtonProps {
    /** The workloads to read again; without it every workload with consent. Always a smart refresh (`force` false). */
    workloads?: WorkloadType[];
    className?: string;
}

/**
 * The Refresh button of every page (Report spec 2.1): icon `refresh`, label hidden below 1024, a smart refresh of the loaded
 * workloads, disabled while a run is busy. Below 640 the compact header carries Refresh, so pages hide this one there.
 */
export function RefreshButton({ workloads, className }: RefreshButtonProps) {
    const { loading, policiesLoading } = useRolesLoading();
    const groupsPhase = usePimGroupsLoading().phase;
    const { refreshAllWorkloads, refreshWorkload } = useUnifiedActions();
    const isBusy = loading || policiesLoading || groupsPhase === "fetching" || groupsPhase === "processing" || groupsPhase === "consent";

    // The spinner belongs to the button that was pressed (spec 4.7): a run started elsewhere only disables it
    const [isPressed, setIsPressed] = useState(false);
    if (!isBusy && isPressed) setIsPressed(false);

    const handleRefresh = () => {
        setIsPressed(true);
        if (workloads) {
            void Promise.all(workloads.map((workload) => refreshWorkload(workload, false)));
        } else {
            void refreshAllWorkloads(false);
        }
    };

    return <RefreshButtonView isDisabled={isBusy} isLoading={isBusy && isPressed} onRefresh={handleRefresh} className={className} />;
}
