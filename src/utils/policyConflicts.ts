/**
 * policyConflicts: what changes for people who activate when a policy changes (`detectActivationChanges`), used by the
 * review's pre-flight (utils/configurePreflight.ts). The old detection of existing assignments against a new policy,
 * with its own Graph reads, is gone: the pre-flight judges the assignments as read (N-017).
 */

import { addIsoDurationToDate } from "@/utils/durationUtils";
import { PolicySettings } from "@/types/wizard.types";

export type ActivationChangeReason =
    | "approval-added"
    | "approval-removed"
    | "approvers-changed"
    | "mfa-added"
    | "mfa-removed"
    | "auth-context-changed"
    | "justification-added"
    | "ticket-added"
    | "max-duration-shortened";

export interface ActivationChange {
    reason: ActivationChangeReason;
    severity: "warning" | "info";
    message: string;
}

export function detectActivationChanges(
    current: PolicySettings | undefined,
    pending: PolicySettings | undefined,
): ActivationChange[] {
    if (!current || !pending) return [];

    const out: ActivationChange[] = [];

    // Approval added
    if (!current.requireApproval && pending.requireApproval) {
        out.push({
            reason: "approval-added",
            severity: "warning",
            message: "Activation now requires approval. Existing eligible users' activations will queue for approvers instead of being granted instantly.",
        });
    }
    if (current.requireApproval && !pending.requireApproval) {
        out.push({
            reason: "approval-removed",
            severity: "info",
            message: "Activation no longer requires approval. Existing eligible users will activate instantly.",
        });
    }
    // Approver list changed (both still require approval)
    if (current.requireApproval && pending.requireApproval) {
        const currentIds = (current.approvers ?? []).map(a => a.id).sort().join(",");
        const pendingIds = (pending.approvers ?? []).map(a => a.id).sort().join(",");
        if (currentIds !== pendingIds) {
            out.push({
                reason: "approvers-changed",
                severity: "info",
                message: "Approver list changed. Future activation requests will be routed to the new approvers.",
            });
        }
    }
    // MFA added
    if (current.activationRequirement !== "mfa" && pending.activationRequirement === "mfa") {
        out.push({
            reason: "mfa-added",
            severity: "warning",
            message: "Activation now requires Azure MFA. Existing eligible users without registered MFA may fail to activate.",
        });
    }
    if (current.activationRequirement === "mfa" && pending.activationRequirement === "none") {
        out.push({
            reason: "mfa-removed",
            severity: "info",
            message: "Activation no longer requires MFA.",
        });
    }
    // Conditional Access authentication context, added or claim changed
    const currentIsCa = current.activationRequirement === "authenticationContext";
    const pendingIsCa = pending.activationRequirement === "authenticationContext";
    if (!currentIsCa && pendingIsCa) {
        out.push({
            reason: "auth-context-changed",
            severity: "warning",
            message: "Activation now requires a Conditional Access authentication context. Existing eligible users without a matching credential (e.g. phish-resistant MFA) cannot activate until they enroll.",
        });
    } else if (currentIsCa && pendingIsCa && current.authenticationContextId !== pending.authenticationContextId) {
        out.push({
            reason: "auth-context-changed",
            severity: "warning",
            message: "Conditional Access authentication context changed. Existing eligible users meeting the old context may not meet the new one.",
        });
    }
    // Justification added
    if (!current.requireJustificationOnActivation && pending.requireJustificationOnActivation) {
        out.push({
            reason: "justification-added",
            severity: "info",
            message: "Activation now requires a justification.",
        });
    }
    // Ticket info added
    if (!current.requireTicketInfo && pending.requireTicketInfo) {
        out.push({
            reason: "ticket-added",
            severity: "info",
            message: "Activation now requires ticket information.",
        });
    }
    // Max activation duration shortened
    if (current.maxActivationDuration && pending.maxActivationDuration
        && current.maxActivationDuration !== pending.maxActivationDuration) {
        const currentEnd = addIsoDurationToDate(new Date(0), current.maxActivationDuration);
        const pendingEnd = addIsoDurationToDate(new Date(0), pending.maxActivationDuration);
        if (currentEnd && pendingEnd && pendingEnd < currentEnd) {
            out.push({
                reason: "max-duration-shortened",
                severity: "info",
                message: `Maximum activation duration shortened from ${current.maxActivationDuration} to ${pending.maxActivationDuration}.`,
            });
        }
    }

    return out;
}
