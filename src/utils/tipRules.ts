import type { DashboardFilter } from "@/types/dashboardFilter.types";
import { GENERAL_TIPS } from "@/config/tips";

/** What the tenant tips need; null means not known yet, so that tip is left out (spec 4.7: never act on an unknown number). */
export interface TenantTipInput {
    permanentOutsideEmergency: number | null;
    privilegedWithoutMfa: number | null;
    privilegedWithoutJustification: number | null;
    groupsOutsidePim: number | null;
    nobodyNotified: number | null;
}

export type TipAction = { kind: "filter"; label: string; filter: DashboardFilter } | { kind: "anchor"; label: string; href: string } | { kind: "link"; label: string; href: string };

export interface Tip {
    id: string;
    source: "tenant" | "general";
    title: string;
    text: string;
    action: TipAction;
}

function plural(n: number, one: string, many: string): string {
    return `${n} ${n === 1 ? one : many}`;
}

function isPositive(n: number | null): n is number {
    return n !== null && n > 0;
}

/**
 * Tenant tips first, in the order of spec 4.8 (permanent outside emergency access, privileged roles without MFA, without
 * justification, groups outside PIM, nobody notified), each only when its number is above 0; then the general tips.
 */
export function buildTips(input: TenantTipInput): Tip[] {
    const tips: Tip[] = [];

    if (isPositive(input.permanentOutsideEmergency)) {
        const n = input.permanentOutsideEmergency;
        tips.push({
            id: "permanent",
            source: "tenant",
            title: `${plural(n, "permanent assignment is", "permanent assignments are")} not emergency access`,
            text: "Permanent access is always on and never needs an activation. Make it eligible so that it is only used when it is needed.",
            action: { kind: "filter", label: `Show ${n === 1 ? "this assignment" : `these ${n} assignments`}`, filter: { assignment: "permanent", excludeEmergency: true } },
        });
    }
    if (isPositive(input.privilegedWithoutMfa)) {
        const n = input.privilegedWithoutMfa;
        tips.push({
            id: "mfa",
            source: "tenant",
            title: `${plural(n, "privileged role activates", "privileged roles activate")} without MFA`,
            text: "Anyone eligible for these roles can activate them with a password alone. Require Entra MFA on activation, or link an authentication context so Conditional Access decides.",
            action: { kind: "filter", label: `Show ${n === 1 ? "this role" : `these ${n} roles`}`, filter: { mfa: "neither" } },
        });
    }
    if (isPositive(input.privilegedWithoutJustification)) {
        const n = input.privilegedWithoutJustification;
        tips.push({
            id: "justification",
            source: "tenant",
            title: `${plural(n, "privileged role does", "privileged roles do")} not ask for a justification`,
            text: "Without a reason there is no trail of why access was activated. Require a justification on activation.",
            action: { kind: "filter", label: `Show ${n === 1 ? "this role" : `these ${n} roles`}`, filter: { justification: "notRequired" } },
        });
    }
    if (isPositive(input.groupsOutsidePim)) {
        const n = input.groupsOutsidePim;
        tips.push({
            id: "groups",
            source: "tenant",
            title: `${plural(n, "role-assignable group is", "role-assignable groups are")} outside PIM`,
            text: "Members of these groups hold the group's roles permanently, without activation. Bring the groups under PIM.",
            action: { kind: "anchor", label: `See ${n === 1 ? "this group" : `these ${n} groups`}`, href: "#gaps-heading" },
        });
    }
    if (isPositive(input.nobodyNotified)) {
        const n = input.nobodyNotified;
        tips.push({
            id: "notified",
            source: "tenant",
            title: `${plural(n, "privileged role is", "privileged roles are")} activated without anyone being told`,
            text: "Add a recipient so that an activation of these roles does not go unnoticed.",
            action: { kind: "filter", label: `Show ${n === 1 ? "this role" : `these ${n} roles`}`, filter: { activationNotification: "none" } },
        });
    }

    for (const [i, tip] of GENERAL_TIPS.entries()) {
        tips.push({ id: `general-${i}`, source: "general", title: tip.title, text: tip.description, action: { kind: "link", label: "Learn more", href: tip.link } });
    }
    return tips;
}
