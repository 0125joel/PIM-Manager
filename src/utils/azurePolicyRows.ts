/**
 * Azure role settings panel logic: the rows of one role's settings and the scope line above them.
 *
 * ARM ids are case-insensitive, so the child lookup lowercases. The name of a scope always comes from the stored
 * scope in the tree.
 */
import type { AzureScope } from "@/types/azureResource.types";
import type { PolicySettings } from "@/types/wizard.types";
import { findScope } from "@/utils/azureReport";
import { isRootScope } from "@/utils/azureScopes";
import { formatDuration } from "@/utils/durationUtils";

export interface PolicyRow {
    label: string;
    help: string;
    value: string;
}

export function policyRows(settings: PolicySettings): PolicyRow[] {
    const onActivation: string[] = [];
    if (settings.activationRequirement === "mfa") onActivation.push("MFA");
    if (settings.activationRequirement === "authenticationContext") onActivation.push("Authentication context");
    if (settings.requireJustificationOnActivation) onActivation.push("Justification");
    if (settings.requireTicketInfo) onActivation.push("Ticket");

    let approval = "Not required";
    if (settings.requireApproval) {
        const names = (settings.approvers ?? []).map((a) => a.displayName ?? a.id);
        approval = names.length > 0 ? `Required: ${names.join(", ")}` : "Required";
    }

    return [
        { label: "Maximum activation duration", help: "How long an activation lasts", value: formatDuration(settings.maxActivationDuration) },
        { label: "On activation", help: "What an eligible user must give to activate", value: onActivation.length > 0 ? onActivation.join(", ") : "Nothing" },
        { label: "Approval", help: "Someone must approve each activation", value: approval },
        {
            label: "Eligible assignment valid for",
            help: "How long an eligible assignment lasts",
            value: settings.allowPermanentEligible ? "Permanent allowed" : formatDuration(settings.eligibleExpiration),
        },
        {
            label: "Active assignment valid for",
            help: "How long an active assignment lasts",
            value: settings.allowPermanentActive ? "Permanent allowed" : formatDuration(settings.activeExpiration),
        },
    ];
}

export function panelScopeLine(scopes: AzureScope[], scopeId: string): string {
    // The root scope has no settings to pass down; the panel says why the settings are not read
    if (isRootScope(scopeId)) return "The root scope.";
    const scope = findScope(scopes, scopeId);
    const name = scope?.name ?? scopeId;
    const c = scope ? scopes.filter((s) => s.parentId !== null && s.parentId.toLowerCase() === scope.id.toLowerCase()).map((s) => s.name) : [];
    const base = `${name}. These settings apply to this scope only`;
    if (c.length === 0) return `${base}.`;
    if (c.length === 1) return `${base}; they are not passed down to ${c[0]}.`;
    if (c.length === 2) return `${base}; they are not passed down to ${c[0]} or ${c[1]}.`;
    const n = c.length - 2;
    return `${base}; they are not passed down to ${c[0]}, ${c[1]} or ${n} other ${n === 1 ? "scope" : "scopes"}.`;
}
