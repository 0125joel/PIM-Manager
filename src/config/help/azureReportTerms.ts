import { REPORT_TERMS, type ReportTerm } from "./reportTerms";

/**
 * The explanation of every tag of the Azure Report, in one place: the tooltip of a tag and the term in the help panel read
 * the same string, as `reportTerms.ts` does for the Entra Report. Terms that mean the same in Azure reuse the Entra text.
 */

export type AzureTermKey =
    | "user" | "group" | "app" | "foreignGroup" | "guest" | "agent" | "managedIdentity" | "deleted"
    | "eligible" | "active" | "activated" | "assigned"
    | "thisScope" | "inherited"
    | "expires" | "noEndDate" | "permanent"
    | "emergency" | "privileged" | "delegated" | "partial" | "scopeLoading" | "scopeFailed"
    | "custom" | "belowScope";

export const AZURE_TERMS: Record<AzureTermKey, ReportTerm> = {
    user: REPORT_TERMS.user,
    group: REPORT_TERMS.group,
    app: REPORT_TERMS.app,
    foreignGroup: { label: "Foreign group", text: "A group from another tenant, for example one that manages this tenant through Azure Lighthouse." },
    guest: REPORT_TERMS.guest,
    agent: { label: "Agent", text: "The account an AI agent runs as (Microsoft Entra Agent ID). In Azure it can hold a role only as an active assignment: an eligible assignment is refused." },
    managedIdentity: { label: "Managed identity", text: "An identity Azure manages for a resource, such as a virtual machine or an app. In Azure it can hold a role only as an active assignment." },
    deleted: { label: "Deleted", text: "Not found in Microsoft Entra ID. The role stays until it is removed." },
    eligible: { label: "Eligible", text: "Can activate the role when needed, for a limited time." },
    active: { label: "Active", text: "Holds the role now." },
    activated: REPORT_TERMS.activated,
    assigned: REPORT_TERMS.assigned,
    thisScope: { label: "This scope", text: "Assigned on the selected scope or on a scope below it, not inherited from above." },
    inherited: { label: "Inherited", text: "Assigned on a scope above and valid here too. Change it where it is assigned." },
    expires: REPORT_TERMS.expires,
    noEndDate: REPORT_TERMS.noEndDate,
    permanent: REPORT_TERMS.permanent,
    emergency: REPORT_TERMS.emergency,
    privileged: { label: "Privileged", text: "One of the five Azure roles Microsoft lists as privileged administrator roles: Owner, Contributor, Role Based Access Control Administrator, User Access Administrator and Reservations Administrator." },
    delegated: { label: "Delegated", text: "This subscription belongs to another tenant and is managed from here through Azure Lighthouse." },
    custom: { label: "Custom", text: "A role made in this tenant, not one of the Azure built-in roles." },
    belowScope: { label: "Below this scope", text: "Assigned on a scope below the selected one. Its PIM settings are those of that scope." },
    partial: { label: "Partial", text: "You cannot read this subscription as a whole. It shows the resource groups and resources you can read, and what is inherited onto them. A Reader role on a resource group loads faster than one on each resource." },
    scopeLoading: { label: "Loading", text: "The resource groups and resources you can read in this subscription are still being read." },
    scopeFailed: { label: "Not loaded", text: "The resource groups and resources in this subscription could not be read. Refresh to try again." },
};

/** The terms the help panel lists, in order */
export const AZURE_HELP_TERM_KEYS: readonly AzureTermKey[] = [
    "eligible", "active", "activated", "assigned", "thisScope", "inherited", "permanent", "noEndDate", "foreignGroup", "guest", "agent", "managedIdentity", "deleted", "privileged", "custom", "delegated", "partial", "scopeLoading", "scopeFailed", "emergency",
];
