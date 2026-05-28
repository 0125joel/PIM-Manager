/**
 * Graph API error mapper.
 *
 * Translates raw Microsoft Graph errors (code + message) into:
 *  - a `friendlyMessage` written for end users (no GUIDs, no jargon),
 *  - an optional `remediation` hint telling them what to do next,
 *  - a `classification` so callers can decide whether to treat the
 *    error as a real failure, a success-equivalent (e.g. "already
 *    exists"), or a transient issue worth retrying.
 *
 * The original Graph code/message is preserved in `rawCode` / `rawMessage`
 * for diagnostics; the result `__user-action` / `__transient` classification
 * is what the UI should branch on.
 */
export type GraphErrorClassification =
    | "success-equivalent" // semantically already done (e.g., assignment already exists)
    | "permission"         // user is missing a Graph permission/scope
    | "policy-rejected"    // payload conflicts with Microsoft policy enforcement
    | "duration-limit"     // duration exceeds the policy maximum
    | "stale-state"        // referenced object is gone or pending
    | "transient"          // throttling or 5xx — Graph will likely succeed on retry
    | "not-found"          // object doesn't exist
    | "unknown";

export interface MappedGraphError {
    friendlyMessage: string;
    remediation?: string;
    classification: GraphErrorClassification;
    rawCode?: string;
    rawMessage?: string;
}

interface GraphLikeError {
    body?: {
        error?: {
            code?: string;
            message?: string;
        };
    };
    statusCode?: number;
    message?: string;
}

/**
 * Try to dig the actual Graph error code + message out of an unknown thrown value.
 * The Graph JS SDK rethrows errors with `body`, `statusCode`, `message`, but
 * the shape isn't strictly typed.
 */
function extract(rawError: unknown): { code?: string; message: string; statusCode?: number } {
    if (rawError && typeof rawError === "object") {
        const e = rawError as GraphLikeError;
        const code = e.body?.error?.code;
        const message = e.body?.error?.message || e.message || String(rawError);
        return { code, message, statusCode: e.statusCode };
    }
    return { message: String(rawError) };
}

const ALREADY_EXISTS_CODES = new Set<string>([
    "RoleAssignmentAlreadyExists",
    "RoleAssignmentExists",
    "RoleEligibilityScheduleAlreadyExists",
    "RoleAssignmentScheduleAlreadyExists",
    "PrivilegedAccessAssignmentExists",
]);

const NOT_FOUND_CODES = new Set<string>([
    "ResourceNotFound",
    "Request_ResourceNotFound",
    "ItemNotFound",
    "RoleAssignmentDoesNotExist",
    "RoleAssignmentScheduleDoesNotExist",
    "RoleEligibilityScheduleDoesNotExist",
]);

/**
 * Map a raw Graph error to its user-facing equivalent.
 * `context` lets callers nudge the wording (e.g. "policy update", "assignment").
 */
export function mapGraphError(rawError: unknown, context?: "policy" | "assignment" | "removal"): MappedGraphError {
    const { code, message, statusCode } = extract(rawError);
    const lower = message.toLowerCase();

    // ---- Success-equivalents (assignment already in place) ----
    if ((code && ALREADY_EXISTS_CODES.has(code)) || lower.includes("already exists")) {
        return {
            friendlyMessage: "This assignment already exists. No changes needed.",
            classification: "success-equivalent",
            rawCode: code,
            rawMessage: message,
        };
    }

    // ---- Throttling / transient ----
    if (statusCode === 429 || lower.includes("too many requests") || lower.includes("throttle")) {
        return {
            friendlyMessage: "Microsoft Graph throttled this request.",
            remediation: "We already retry automatically. If it keeps failing, wait about a minute and click Retry Failed.",
            classification: "transient",
            rawCode: code,
            rawMessage: message,
        };
    }
    if (typeof statusCode === "number" && statusCode >= 500 && statusCode < 600) {
        return {
            friendlyMessage: "Microsoft Graph had a server-side problem.",
            remediation: "Click Retry Failed. If it persists, check the Microsoft 365 status page.",
            classification: "transient",
            rawCode: code,
            rawMessage: message,
        };
    }

    // ---- Permission / authorization ----
    if (statusCode === 403 || code === "Forbidden" || code === "Authorization_RequestDenied" || lower.includes("insufficient privileges")) {
        return {
            friendlyMessage: "Microsoft denied this operation because of insufficient permissions.",
            remediation: context === "policy"
                ? "PIM policy updates require RoleManagementPolicy.ReadWrite.Directory. Open Settings → Permissions and re-grant write consent."
                : "Open Settings → Permissions and re-grant write consent for this workload.",
            classification: "permission",
            rawCode: code,
            rawMessage: message,
        };
    }

    // ---- "Invalid policy" (most common scratch-path failure) ----
    // InvalidPolicyRule is the per-rule variant returned by individual rule PATCHes
    // (introduced when we started PATCHing rules individually). Same root cause class.
    if (code === "InvalidPolicy" || code === "InvalidPolicyRule"
        || lower.includes("policy is invalid") || lower.includes("policy rule is invalid")) {
        return {
            friendlyMessage: "Microsoft rejected the policy as invalid.",
            remediation:
                "Common causes: (1) you're extending the policy maximum beyond what Microsoft allows for this role (many built-in roles have hard caps), (2) for privileged roles like Global Admin, Microsoft forbids 'Allow permanent eligible/active'. Go to the Policies step and shorten the expiration to the role's current maximum, or disable permanent assignments.",
            classification: "policy-rejected",
            rawCode: code,
            rawMessage: message,
        };
    }

    // ---- MFA + authentication context conflict ----
    // Graph forbids any transient or final state where both MFA (Enablement rule)
    // and an authentication context (AuthenticationContext rule) are simultaneously
    // enabled on the same policy. The wizard prevents this in the UI (mutual-exclusive
    // radio selection), but sequential rule PATCHes can still trigger it if the
    // ordering is wrong. The service sorts rules to avoid this, so seeing this error
    // in production means an ordering regression or a direct API call bypassed the sort.
    if (code === "MfaAndAcrsConflict" || lower.includes("mfa and acrs") || lower.includes("acrs policy settings")) {
        return {
            friendlyMessage: "MFA and authentication context cannot both be enabled on the same policy at once.",
            remediation:
                "The activation requirement must be either MFA or an authentication context, not both. Open the Policies step, confirm only one activation requirement is selected, and try again.",
            classification: "policy-rejected",
            rawCode: code,
            rawMessage: message,
        };
    }

    // ---- "Invalid role assignment id" (stale schedule, pending removal) ----
    // Graph returns this when creating a new assignment and a previous schedule for
    // the same principal+role+scope is still deprovisioning (e.g. a removal that
    // just succeeded but hasn't fully cleared Graph's backend yet). The GUID in the
    // message is the lingering schedule ID. Wait a few minutes and retry.
    if (code === "InvalidRoleAssignmentId" || (lower.includes("role assignment id") && lower.includes("invalid"))) {
        return {
            friendlyMessage: "A pending or expired assignment schedule blocks this request.",
            remediation:
                "A previous assignment for this principal is still deprovisioning. Wait 2-3 minutes, then click Retry Failed.",
            classification: "stale-state",
            rawCode: code,
            rawMessage: message,
        };
    }

    // ---- Duration exceeds policy maximum ----
    // Graph wording varies: "duration in the request is greater than maximum allowed duration",
    // "duration exceeds the policy maximum", "maximumDuration: ...". Match liberally.
    if (lower.includes("maximumduration")
        || lower.includes("maximum duration")
        || lower.includes("maximum allowed duration")
        || lower.includes("duration exceeds")
        || lower.includes("greater than maximum")) {
        return {
            friendlyMessage: "The requested duration exceeds what this role's PIM policy allows.",
            remediation:
                "If you're creating an assignment: the policy doesn't permit this duration. Lower it, or first widen the policy in the Policies step. If you're updating the policy: this role has a hard upper bound from Microsoft that you can't extend further.",
            classification: "duration-limit",
            rawCode: code,
            rawMessage: message,
        };
    }

    // ---- Assignment does not exist (typically on remove) ----
    // Either the schedule was already removed in another tab, the request raced
    // with an apply, or the assignment expired between staging and apply.
    if (lower.includes("does not exist") || lower.includes("role assignment does not exist")) {
        // For removal context this is a no-op success; for create/update it's a real not-found.
        return {
            friendlyMessage: context === "removal"
                ? "Nothing to remove. This assignment is already gone."
                : "The referenced assignment doesn't exist.",
            classification: context === "removal" ? "success-equivalent" : "not-found",
            rawCode: code,
            rawMessage: message,
        };
    }

    // ---- Not found ----
    if ((code && NOT_FOUND_CODES.has(code)) || statusCode === 404) {
        return {
            friendlyMessage: context === "removal"
                ? "Nothing to remove. This assignment is already gone."
                : "Microsoft Graph couldn't find the referenced object.",
            classification: context === "removal" ? "success-equivalent" : "not-found",
            rawCode: code,
            rawMessage: message,
        };
    }

    // ---- Generic invalid request ----
    if (code === "BadRequest" || code === "InvalidRequest" || statusCode === 400) {
        return {
            friendlyMessage: message || "Microsoft Graph rejected the request as invalid.",
            remediation: "Check that all required fields are present and that the policy/assignment combination is supported for this role.",
            classification: "policy-rejected",
            rawCode: code,
            rawMessage: message,
        };
    }

    // ---- Fallback ----
    return {
        friendlyMessage: message || "Unexpected error.",
        classification: "unknown",
        rawCode: code,
        rawMessage: message,
    };
}

/**
 * Human-readable label for a PIM policy rule id.
 * Graph rule ids like "Expiration_Admin_Eligibility" don't mean much to users.
 */
export function describePolicyRuleId(ruleId: string): string {
    const map: Record<string, string> = {
        "Expiration_Admin_Eligibility": "Eligible-assignment expiration",
        "Expiration_Admin_Assignment": "Active-assignment expiration",
        "Expiration_EndUser_Assignment": "Maximum activation duration",
        "Enablement_EndUser_Assignment": "Activation requirements (MFA, justification, ticket)",
        "Enablement_Admin_Assignment": "Active-assignment requirements (MFA, justification)",
        "AuthenticationContext_EndUser_Assignment": "Conditional Access authentication context",
        "Approval_EndUser_Assignment": "Approval workflow & approvers",
        "Notification_Admin_Admin_Eligibility": "Eligible-assignment notification to admins",
        "Notification_Requestor_Admin_Eligibility": "Eligible-assignment notification to assignee",
        "Notification_Approver_Admin_Eligibility": "Eligible-assignment notification to approvers",
        "Notification_Admin_Admin_Assignment": "Active-assignment notification to admins",
        "Notification_Requestor_Admin_Assignment": "Active-assignment notification to assignee",
        "Notification_Approver_Admin_Assignment": "Active-assignment notification to approvers",
        "Notification_Admin_EndUser_Assignment": "Activation notification to admins",
        "Notification_Requestor_EndUser_Assignment": "Activation notification to requestor",
        "Notification_Approver_EndUser_Assignment": "Activation notification to approvers",
    };
    return map[ruleId] || ruleId;
}
