import type { PolicySettings } from '@/types/wizard.types';
import { isoToApproxDays } from '@/utils/durationUtils';

/**
 * Built-in role names that carry tenant-wide privileged access. Matched
 * case-insensitively as a substring (so "Global Administrator (Custom)" still
 * trips the check).
 */
export const HIGH_RISK_ROLE_NAMES = [
    "Global Administrator",
    "Privileged Role Administrator",
    "Security Administrator",
    "User Administrator",
    "Exchange Administrator",
    "SharePoint Administrator",
    "Conditional Access Administrator",
    "Application Administrator",
    "Cloud Application Administrator",
    "Authentication Administrator"
] as const;

export function isHighRiskRoleName(name: string | undefined): boolean {
    if (!name) return false;
    const lower = name.toLowerCase();
    return HIGH_RISK_ROLE_NAMES.some(hr => lower.includes(hr.toLowerCase()));
}

export interface PolicyExtensionOffense {
    name: string;
    field: "eligible" | "active";
    current: string;
    pending: string;
}

/**
 * Detect policy-maximum extensions that Microsoft will reject. For many
 * built-in privileged roles Graph enforces a hard upper bound on
 * `maximumDuration` and rejects extensions with `InvalidPolicyRule`.
 *
 * Skips the check when current OR pending allows permanent for that field:
 *   - Current permanent → max is unbounded (Graph stores PT0S meaning
 *     "no expiration", not "0 seconds"), so any numeric pending falsely
 *     appears larger.
 *   - Pending permanent → the duration becomes a non-binding default.
 */
export function detectPolicyExtensions(
    name: string,
    current: PolicySettings | undefined,
    pending: PolicySettings | undefined
): PolicyExtensionOffense[] {
    if (!current || !pending) return [];
    const out: PolicyExtensionOffense[] = [];
    if (!current.allowPermanentEligible && !pending.allowPermanentEligible
        && current.eligibleExpiration && pending.eligibleExpiration
        && isoToApproxDays(pending.eligibleExpiration) > isoToApproxDays(current.eligibleExpiration)) {
        out.push({ name, field: "eligible", current: current.eligibleExpiration, pending: pending.eligibleExpiration });
    }
    if (!current.allowPermanentActive && !pending.allowPermanentActive
        && current.activeExpiration && pending.activeExpiration
        && isoToApproxDays(pending.activeExpiration) > isoToApproxDays(current.activeExpiration)) {
        out.push({ name, field: "active", current: current.activeExpiration, pending: pending.activeExpiration });
    }
    return out;
}

/**
 * "From scratch" PolicySettings default to allowPermanentEligible/Active=true.
 * Microsoft rejects that combo on built-in privileged roles with InvalidPolicy.
 */
export function isScratchPermanentRiskyOnPrivileged(args: {
    configSource: "defaults" | "loaded" | "cloned" | undefined;
    policies: PolicySettings | undefined;
    hasHighRiskTargets: boolean;
}): boolean {
    return args.configSource === "defaults"
        && !!args.policies
        && (args.policies.allowPermanentEligible || args.policies.allowPermanentActive)
        && args.hasHighRiskTargets;
}

export function formatExtensionLine(o: PolicyExtensionOffense): string {
    return `${o.name}: ${o.field} ${o.current} → ${o.pending}`;
}
