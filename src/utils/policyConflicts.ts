/**
 * policyConflicts — pure detection of existing PIM assignments that violate a
 * pending PolicySettings change.
 *
 * Shared by:
 *  - hooks/usePolicyConflicts.ts (wizard ReviewStep + ApplyStep)
 *  - components/configure/modes/ManualMode.tsx (per-target apply)
 *  - components/configure/modes/BulkMode.tsx (CSV apply)
 *
 * Microsoft PIM policy PATCHes are NOT retroactive — see
 * docs/Assets/configure-policy-to-assignment-coherence-2026-05-16.md.
 */

import { Client } from "@microsoft/microsoft-graph-client";
import { withRetry } from "@/utils/retryUtils";
import { addIsoDurationToDate } from "@/utils/durationUtils";
import { PolicySettings } from "@/types/wizard.types";

export type ConflictReason =
    | "permanent-no-longer-allowed"
    | "end-date-exceeds-new-max";

export interface PolicyConflict {
    targetId: string;
    targetName: string;
    assignmentId: string;
    principalId: string;
    principalDisplayName: string;
    assignmentType: "eligible" | "active";
    currentEndDateTime: string | null;
    roleDefinitionId?: string;
    directoryScopeId?: string;
    groupId?: string;
    accessType?: "member" | "owner";
    reason: ConflictReason;
    detail: string;
}

export interface DetectConflictsParams {
    workload: "directoryRoles" | "pimGroups";
    selectedIds: string[];
    nameMap: Map<string, string>;
    pendingPolicy: PolicySettings;
    pendingOwnerPolicy?: PolicySettings;
}

interface ScheduleInstance {
    id?: string;
    principalId?: string;
    roleDefinitionId?: string;
    directoryScopeId?: string;
    accessId?: string;
    endDateTime?: string | null;
    scheduleInfo?: { expiration?: { endDateTime?: string } };
    principal?: { displayName?: string };
}

function compareInstancesToPolicy(
    instances: ScheduleInstance[],
    targetId: string,
    targetName: string,
    assignmentType: "eligible" | "active",
    policy: PolicySettings,
    workload: "directoryRoles" | "pimGroups",
    accessType?: "member" | "owner",
): PolicyConflict[] {
    const allowPermanent = assignmentType === "active"
        ? policy.allowPermanentActive
        : policy.allowPermanentEligible;
    const newMaxIso = assignmentType === "active"
        ? policy.activeExpiration
        : policy.eligibleExpiration;

    const out: PolicyConflict[] = [];
    const now = new Date();
    const newMaxEnd = newMaxIso ? addIsoDurationToDate(now, newMaxIso) : null;

    for (const inst of instances) {
        const end = inst.endDateTime ?? inst.scheduleInfo?.expiration?.endDateTime ?? null;
        const principalId = inst.principalId ?? "";
        const principalDisplayName = inst.principal?.displayName ?? principalId;
        const assignmentId = inst.id ?? "";

        const base = {
            targetId,
            targetName,
            assignmentId,
            principalId,
            principalDisplayName,
            assignmentType,
            currentEndDateTime: end ?? null,
            ...(workload === "directoryRoles"
                ? {
                    roleDefinitionId: inst.roleDefinitionId ?? targetId,
                    directoryScopeId: inst.directoryScopeId ?? "/",
                }
                : {
                    groupId: targetId,
                    accessType: accessType ?? (inst.accessId === "owner" ? "owner" : "member") as "member" | "owner",
                }),
        };

        if (!end) {
            if (!allowPermanent) {
                out.push({
                    ...base,
                    reason: "permanent-no-longer-allowed",
                    detail: `Permanent ${assignmentType} assignment, but the new policy no longer permits permanent ${assignmentType} assignments.`,
                });
            }
            continue;
        }
        // When permanent is allowed, there is no effective maximum — any end
        // date is within policy bounds. Skip the duration check entirely so
        // we don't falsely flag assignments against the stored expiration
        // field (which is irrelevant when allowPermanent is true).
        if (!allowPermanent && newMaxEnd && new Date(end) > newMaxEnd) {
            out.push({
                ...base,
                reason: "end-date-exceeds-new-max",
                detail: `Ends ${new Date(end).toLocaleDateString()}, beyond the new policy maximum (${newMaxIso}).`,
            });
        }
    }
    return out;
}

export async function detectPolicyConflicts(
    client: Client,
    params: DetectConflictsParams,
): Promise<PolicyConflict[]> {
    const { workload, selectedIds, nameMap, pendingPolicy, pendingOwnerPolicy } = params;
    const all: PolicyConflict[] = [];

    for (const targetId of selectedIds) {
        const targetName = nameMap.get(targetId) ?? targetId;

        if (workload === "directoryRoles") {
            const [eligibleRes, activeRes] = await Promise.all([
                withRetry(
                    () => client.api(`/roleManagement/directory/roleEligibilitySchedules`)
                        .filter(`roleDefinitionId eq '${targetId}'`)
                        .expand('principal')
                        .get(),
                    3, 1000, `detectPolicyConflicts eligible ${targetId}`
                ),
                withRetry(
                    () => client.api(`/roleManagement/directory/roleAssignmentSchedules`)
                        .filter(`roleDefinitionId eq '${targetId}'`)
                        .expand('principal')
                        .get(),
                    3, 1000, `detectPolicyConflicts active ${targetId}`
                ),
            ]);
            const eligibleInstances = (eligibleRes.value as ScheduleInstance[]) ?? [];
            const activeInstances = (activeRes.value as ScheduleInstance[]) ?? [];
            all.push(...compareInstancesToPolicy(eligibleInstances, targetId, targetName, "eligible", pendingPolicy, workload));
            all.push(...compareInstancesToPolicy(activeInstances, targetId, targetName, "active", pendingPolicy, workload));
        } else {
            const [eligibleRes, activeRes] = await Promise.all([
                withRetry(
                    () => client.api(`/identityGovernance/privilegedAccess/group/eligibilityScheduleInstances`)
                        .filter(`groupId eq '${targetId}'`)
                        .expand('principal')
                        .get(),
                    3, 1000, `detectPolicyConflicts group eligible ${targetId}`
                ),
                withRetry(
                    () => client.api(`/identityGovernance/privilegedAccess/group/assignmentScheduleInstances`)
                        .filter(`groupId eq '${targetId}'`)
                        .expand('principal')
                        .get(),
                    3, 1000, `detectPolicyConflicts group active ${targetId}`
                ),
            ]);
            const allEligible = (eligibleRes.value as ScheduleInstance[]) ?? [];
            const allActive = (activeRes.value as ScheduleInstance[]) ?? [];

            const memberEligible = allEligible.filter(i => i.accessId !== "owner");
            const ownerEligible = allEligible.filter(i => i.accessId === "owner");
            const memberActive = allActive.filter(i => i.accessId !== "owner");
            const ownerActive = allActive.filter(i => i.accessId === "owner");

            all.push(...compareInstancesToPolicy(memberEligible, targetId, targetName, "eligible", pendingPolicy, workload, "member"));
            all.push(...compareInstancesToPolicy(memberActive, targetId, targetName, "active", pendingPolicy, workload, "member"));
            if (pendingOwnerPolicy) {
                all.push(...compareInstancesToPolicy(ownerEligible, targetId, targetName, "eligible", pendingOwnerPolicy, workload, "owner"));
                all.push(...compareInstancesToPolicy(ownerActive, targetId, targetName, "active", pendingOwnerPolicy, workload, "owner"));
            }
        }
    }

    return all;
}

// ============================================================================
// Activation-side change detection — compares pending vs current policy and
// returns human-readable warnings about what will change for already-assigned
// users on their next activation attempt.
// ============================================================================

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
    // Conditional Access authentication context — added or claim changed
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
