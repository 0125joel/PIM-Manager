import type { AzureTermKey } from "@/config/help/azureReportTerms";
import type { AzureAssignment } from "@/types/azureResource.types";
import { principalKindOf } from "@/utils/azureDashboard";

export interface AzureAssignmentTag {
    /** The term that explains it; null for a principal type the app does not know (the tag then has no tip) */
    term: AzureTermKey | null;
    /** The text on the tag */
    label: string;
    variant?: "warn" | "band";
    icon?: "emergency-access";
}

/** The tag of a principal kind; a foreign group keeps its own, a device and an unknown type have no tip */
function principalTag(assignment: AzureAssignment, spTypes: ReadonlyMap<string, string> | null): Pick<AzureAssignmentTag, "term" | "label" | "variant"> {
    switch (principalKindOf(assignment, spTypes)) {
        case "user": return { term: "user", label: "User" };
        case "guest": return { term: "guest", label: "Guest" };
        case "group": return assignment.principalType === "ForeignGroup" ? { term: "foreignGroup", label: "Foreign group" } : { term: "group", label: "Group" };
        case "app":
        case "servicePrincipal": return { term: "app", label: "App" };
        case "managedIdentity": return { term: "managedIdentity", label: "Managed identity" };
        case "agent": return { term: "agent", label: "Agent" };
        case "deleted": return { term: "deleted", label: "Deleted", variant: "warn" };
        default: return { term: null, label: assignment.principalType === "Device" ? "Device" : "Unknown" };
    }
}

/**
 * The tags of one Azure assignment in the order of the Entra Report: principal type, state, end, activation and
 * emergency access. The table and the cards both read this list, so they show the same tags.
 */
export function azureAssignmentTags(assignment: AzureAssignment, emergencyAccountIds: ReadonlySet<string>, formatEnd: (iso: string) => string, spTypes?: ReadonlyMap<string, string> | null): AzureAssignmentTag[] {
    const tags: AzureAssignmentTag[] = [];

    tags.push(principalTag(assignment, spTypes ?? null));

    const isActive = assignment.state === "active";
    tags.push({ term: isActive ? "active" : "eligible", label: isActive ? "Active" : "Eligible" });

    if (assignment.endDateTime === null) {
        tags.push(isActive
            ? { term: "permanent", label: "Permanent", variant: "warn" }
            : { term: "noEndDate", label: "No end date" });
    } else {
        tags.push({ term: "expires", label: `Expires ${formatEnd(assignment.endDateTime)}` });
    }

    if (isActive) {
        tags.push(assignment.isActivated === true
            ? { term: "activated", label: "Activated" }
            : { term: "assigned", label: "Assigned" });
    }

    if (emergencyAccountIds.has(assignment.principalId.toLowerCase())) {
        tags.push({ term: "emergency", label: "Emergency access", variant: "band", icon: "emergency-access" });
    }

    return tags;
}
