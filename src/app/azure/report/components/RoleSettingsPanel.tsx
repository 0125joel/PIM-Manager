"use client";

import { useMemo, useState } from "react";
import { ConfigTabs } from "@/app/report/components/ConfigTabs";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatusBox } from "@/components/ui/StatusBox";
import type { AzureRolePolicyState } from "@/hooks/useAzureRolePolicy";
import type { AzureAssignment, AzureScope } from "@/types/azureResource.types";
import { AZURE_PRIVILEGED_ROLE_IDS } from "@/utils/azureReport";
import { panelScopeLine } from "@/utils/azurePolicyRows";
import { buildPolicyView, type PolicyTabId } from "@/utils/policyView";

interface RoleSettingsPanelProps {
    assignment: AzureAssignment | null;
    scopes: AzureScope[];
    state: AzureRolePolicyState;
    onRetry: () => void;
    onClose: () => void;
}

/** The dialog with one role's settings at the scope of an assignment, read only. */
export function RoleSettingsPanel({ assignment, scopes, state, onRetry, onClose }: RoleSettingsPanelProps) {
    return (
        <Dialog isOpen={assignment !== null} onClose={onClose} title={assignment?.roleName ?? ""} width={720}>
            {assignment && (
                // The key resets the chosen tab to Activation each time another assignment opens
                <div key={assignment.id}>
                    <PanelContent assignment={assignment} scopes={scopes} state={state} onRetry={onRetry} />
                </div>
            )}
        </Dialog>
    );
}

interface PanelContentProps {
    assignment: AzureAssignment;
    scopes: AzureScope[];
    state: AzureRolePolicyState;
    onRetry: () => void;
}

function PanelContent({ assignment, scopes, state, onRetry }: PanelContentProps) {
    const [tab, setTab] = useState<PolicyTabId>("activation");
    const view = useMemo(() => {
        if (state.status !== "loaded") return null;
        return buildPolicyView(state.rules, { isPrivileged: AZURE_PRIVILEGED_ROLE_IDS.has(assignment.roleDefinitionId.toLowerCase()) });
    }, [assignment, state]);

    return (
        <>
            <p className="text-[13px] leading-[18px] text-body">{panelScopeLine(scopes, assignment.scopeId)}</p>
            {(state.status === "idle" || state.status === "loading") && (
                <div className="mt-4 flex flex-col gap-3" aria-busy="true">
                    <Skeleton className="block" width="100%" height={44} />
                    <Skeleton className="block" width="100%" height={44} />
                    <Skeleton className="block" width="100%" height={44} />
                    <Skeleton className="block" width="100%" height={44} />
                    <Skeleton className="block" width="100%" height={44} />
                </div>
            )}
            {state.status === "loaded" && (
                <div className="mt-4">
                    <ConfigTabs view={view} state={view ? "ready" : "failed"} tab={tab} onTabChange={setTab} />
                </div>
            )}
            {state.status === "missing" && <p className="mt-4 text-sm leading-5 text-body">No role settings for this role at this scope.</p>}
            {state.status === "noAccess" && <p className="mt-4 text-sm leading-5 text-body">No access to this scope. Your Azure role at this scope does not allow reading its role settings.</p>}
            {state.status === "unavailable" && <p className="mt-4 text-sm leading-5 text-body">PIM settings are not available at the root scope. Choose a management group, subscription, resource group or resource.</p>}
            {state.status === "failed" && (
                <StatusBox variant="error" title={state.title} action={<Button onClick={onRetry}>Try again</Button>} className="mt-4">
                    {state.detail}
                </StatusBox>
            )}
            <p className="mt-4 rounded bg-band px-3.5 py-3 text-xs leading-4 text-body">Read only. Changes are made in Configure.</p>
        </>
    );
}
