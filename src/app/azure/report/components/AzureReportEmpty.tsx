"use client";

import { PANEL_CLASS } from "@/components/ui/SectionHeader";
import type { MyAzureRolesState } from "@/utils/azureReportStates";
import { MyAzureRoles } from "./MyAzureRoles";

interface AzureReportEmptyProps {
    myRoles: MyAzureRolesState;
}

const TEXT_WITH_ROLES = "Your Azure roles in this tenant do not let you read role assignments. Reader on a subscription, resource group or resource is enough.";
const TEXT_NO_ROLES = "Your account has no Azure role in this tenant. An administrator can give you the Reader role.";
const TEXT_UNREADABLE = "Your account cannot read role assignments on any Azure scope in this tenant. Reader on a subscription, resource group or resource is enough.";
/** Always true, also when the cause is not the delay (Learn: role assignment changes can take up to 10 minutes) */
const TEXT_DELAY = "Azure can take up to 10 minutes to apply a role change. Refresh to read it again.";

/** No subscription or resource group is readable, with the user's own Azure roles when they came back, or a line when they could not be read */
export function AzureReportEmpty({ myRoles }: AzureReportEmptyProps) {
    const roles = myRoles !== null && myRoles !== "failed" ? myRoles : null;
    const hasRows = roles !== null && (roles.active.length > 0 || roles.eligible.length > 0);
    let text = TEXT_UNREADABLE;
    if (roles !== null && hasRows) text = TEXT_WITH_ROLES;
    else if (roles !== null) text = TEXT_NO_ROLES;

    return (
        <div data-visual-section="azure-empty" className={PANEL_CLASS}>
            <h2 className="text-lg leading-6 font-semibold text-ink">No Azure scopes to show</h2>
            <p className="mt-1 text-sm leading-5 text-body">{text}</p>
            <p className="mt-1 text-sm leading-5 text-body">{TEXT_DELAY}</p>
            {myRoles === "failed" && <p className="mt-5 border-t border-line pt-4 text-sm leading-5 text-body">Your own Azure roles could not be read.</p>}
            {roles !== null && hasRows && <MyAzureRoles roles={roles} />}
        </div>
    );
}
