/**
 * Which assignment tags show with details off (calm details spec 2.6): only what deviates from the usual. Shared by the Entra
 * and the Azure Report. With details on every tag shows.
 */
export type RowTagKind =
    | "type"
    | "relationMember"
    | "relationOwner"
    | "direct"
    | "viaGroup"
    | "scopeTenantWide"
    | "scopeOther"
    | "originHere"
    | "originInherited"
    | "alwaysOn"
    | "expires"
    | "permanent"
    | "noEndDate"
    | "activated"
    | "assigned"
    | "emergency"
    | "eligible"
    | "active";

const SHOWN_WHEN_CALM: ReadonlySet<RowTagKind> = new Set<RowTagKind>(["relationOwner", "viaGroup", "scopeOther", "originInherited", "alwaysOn", "permanent", "emergency"]);

/**
 * `keepAssignmentState`: Eligible and Active stay where no heading says them (the roles a group holds, the Azure table).
 */
export function isTagShown(kind: RowTagKind, isDetailed: boolean, options: { keepAssignmentState?: boolean } = {}): boolean {
    if (isDetailed) return true;
    if (kind === "eligible" || kind === "active") return options.keepAssignmentState === true;
    return SHOWN_WHEN_CALM.has(kind);
}

/**
 * The Azure tags by their help term (`azureAssignmentTags`): the type is hidden like the Entra type; Deleted always shows,
 * it is a warning. Without details, Eligible and Active stay only where `keepAssignmentState` is set (the table and cards).
 */
export function isAzureTagShown(term: string | null, isDetailed: boolean, options: { keepAssignmentState?: boolean } = {}): boolean {
    if (term === "deleted") return true;
    const kinds: Record<string, RowTagKind> = { active: "active", eligible: "eligible", permanent: "permanent", noEndDate: "noEndDate", expires: "expires", activated: "activated", assigned: "assigned", emergency: "emergency" };
    return isTagShown(kinds[term ?? ""] ?? "type", isDetailed, options);
}
