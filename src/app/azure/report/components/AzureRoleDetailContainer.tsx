"use client";

import { AzureRoleDetail } from "./AzureRoleDetail";
import { useAzureRoleDefinition } from "@/hooks/useAzureRoleDefinition";
import { useAzureRolePolicy } from "@/hooks/useAzureRolePolicy";
import type { AzureAssignment, AzureScope } from "@/types/azureResource.types";
import type { AzureRoleDetailModel } from "@/utils/azureRoleView";
import type { PolicyTabId } from "@/utils/policyView";

interface AzureRoleDetailContainerProps {
    detail: AzureRoleDetailModel;
    /** The selected scope: the role's description and settings are read at it */
    scope: AzureScope;
    isHiddenByFilter: boolean;
    getShareUrl: () => string;
    tab: PolicyTabId;
    onTabChange: (tab: PolicyTabId) => void;
    onOpenSettings: (assignment: AzureAssignment) => void;
    emergencyAccountIds: ReadonlySet<string>;
    /** Graph servicePrincipalType by lowercase object id, for the managed identity tag */
    spTypes?: ReadonlyMap<string, string> | null;
}

/** Reads the description and the role settings at the selected scope, then renders the role detail (Azure spec 15.2). */
export function AzureRoleDetailContainer({ detail, scope, isHiddenByFilter, getShareUrl, tab, onTabChange, onOpenSettings, emergencyAccountIds, spTypes }: AzureRoleDetailContainerProps) {
    const { description } = useAzureRoleDefinition({ scopeId: scope.id, roleDefinitionId: detail.id });
    const { state: policyState, retry } = useAzureRolePolicy({ scopeId: scope.id, roleDefinitionId: detail.id });
    return (
        <AzureRoleDetail
            detail={detail}
            scopeName={scope.name}
            description={description}
            policyState={policyState}
            onRetryPolicy={retry}
            tab={tab}
            onTabChange={onTabChange}
            emergencyAccountIds={emergencyAccountIds}
            isHiddenByFilter={isHiddenByFilter}
            getShareUrl={getShareUrl}
            onOpenSettings={onOpenSettings}
            spTypes={spTypes}
        />
    );
}
