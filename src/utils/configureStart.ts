/**
 * The start page of Configure as data (spec 3.4, 4, 14.3, 15; NG-62): the access row in its states, the details table,
 * the lock of the entry cards, and the Last applies lines. Pure; the view in `app/configure/components` draws it.
 */
import type { Change } from "@/types/configure.types";
import type { ChangeResult } from "@/utils/applyPlan";
import type { HistoryEntry } from "@/utils/configureHistory";
import type { AccessVia, ActivateTarget, AreaAccess, WriteAccess } from "@/utils/writeAccess";

export const ENTRA_MY_ROLES_URL = "https://entra.microsoft.com/#view/Microsoft_Azure_PIMCommon/ActivationMenuBlade/~/aadmigratedroles";
export const ENTRA_MY_GROUPS_URL = "https://entra.microsoft.com/#view/Microsoft_Azure_PIMCommon/ActivationMenuBlade/~/aadgroup";

export type AccessCheckStatus = "waiting" | "checking" | "ready" | "failed";

export interface AccessDetailRow {
    what: string;
    role: string;
    permission: string;
    status: string;
}

export type AccessRow =
    | { kind: "checking"; title: string }
    | { kind: "failed"; title: string }
    | { kind: "open"; title: string; chips: string[]; via: string }
    | { kind: "activate"; title: string; text: string; link: { label: string; href: string } }
    | { kind: "closed"; title: string; text: string; subline: string }
    | { kind: "consent"; title: string; text: string; workloads: ("directoryRoles" | "pimGroups")[] };

export type EntryLock = { kind: "none" } | { kind: "checking" } | { kind: "closed"; text: string } | { kind: "consent"; text: string };

export interface AccessView {
    row: AccessRow;
    details: AccessDetailRow[];
    /** "Read from your active role assignments ... at {time} ..." */
    detailsLine: string | null;
    entries: EntryLock;
}

export const DETAILS_LINE = (time: string) =>
    `Read from your active role assignments and the groups you own, at ${time}, and checked again before apply. Eligible roles count once you activate them. Custom roles count when they hold the same permissions.`;

/** "14:20" today, otherwise "5 Oct 14:20" (24 hour clock, as the rest of the app) */
export function formatTime(iso: string | Date, now: Date): string {
    const d = typeof iso === "string" ? new Date(iso) : iso;
    const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    if (d.toDateString() === now.toDateString()) return hhmm;
    return `${d.getDate()} ${d.toLocaleString("en-GB", { month: "short" })} ${hhmm}`;
}

function viaText(via: AccessVia | null, now: Date): string {
    if (!via) return "None";
    if (via.kind === "ownership") return "Owner of the group";
    const { role } = via;
    const through = role.viaGroup ? " through a group" : "";
    return role.end ? `${role.name}${through}, active until ${formatTime(role.end, now)}` : `${role.name}${through}, active`;
}

function activateText(target: ActivateTarget): { name: string; link: { label: string; href: string } } {
    if (target.kind === "ownership") return { name: `your ownership of ${target.groupName}`, link: { label: "My groups in Entra", href: ENTRA_MY_GROUPS_URL } };
    if (target.role.throughGroup) return { name: `your membership of ${target.role.throughGroup.groupName}`, link: { label: "My groups in Entra", href: ENTRA_MY_GROUPS_URL } };
    return { name: target.role.name, link: { label: "My roles in Entra", href: ENTRA_MY_ROLES_URL } };
}

function areaStatus(area: AreaAccess): string {
    if (area.state === "activate-first") return "Activate first";
    if (area.state === "closed") return "Closed";
    if (area.reach === "some" && area.total !== undefined && area.openCount !== undefined) return `${area.openCount} of ${area.total}`;
    return "Open";
}

/** The open areas as the green chips of the row: "Entra roles", "Groups under PIM", or "{n} groups" */
function chipsOf(access: WriteAccess): string[] {
    const chips: string[] = [];
    if (access.roles.state === "open") chips.push("Entra roles");
    const groupAreas = [access.roleAssignableGroups, access.otherGroups].filter((a) => a.state === "open");
    if (groupAreas.some((a) => a.reach === "all")) chips.push("Groups under PIM");
    else if (groupAreas.length > 0) {
        const n = groupAreas.reduce((sum, a) => sum + (a.openCount ?? 0), 0);
        chips.push(`${n} ${n === 1 ? "group" : "groups"}`);
    }
    return chips;
}

export function describeAccess(status: AccessCheckStatus, access: WriteAccess | null, checkedAt: Date | null, now: Date): AccessView {
    // A recheck keeps the last decision on screen (U-01): only the first check, with nothing decided yet, shows
    // "Checking" and locks the modes, so a Refresh or entering the review never unmounts the admin's work
    if (status === "waiting" || (status === "checking" && !access)) return { row: { kind: "checking", title: "Checking what you can change…" }, details: [], detailsLine: null, entries: { kind: "checking" } };
    if (status === "failed" || !access) return { row: { kind: "failed", title: "Could not check your roles. Try again." }, details: [], detailsLine: null, entries: { kind: "closed", text: "Closed until your roles are checked" } };

    const permission = (w: "directoryRoles" | "pimGroups") => (access.appPermission[w] === "granted" ? "Granted" : "Not granted");
    const details: AccessDetailRow[] = [
        { what: "Entra roles", role: access.roles.via ? viaText(access.roles.via, now) : access.roles.activate ? `Activate ${activateText(access.roles.activate).name}` : "None", permission: permission("directoryRoles"), status: areaStatus(access.roles) },
        { what: "Role-assignable groups", role: access.roleAssignableGroups.via ? viaText(access.roleAssignableGroups.via, now) : "None", permission: permission("pimGroups"), status: areaStatus(access.roleAssignableGroups) },
        { what: "Other groups", role: access.otherGroups.via ? viaText(access.otherGroups.via, now) : "None", permission: permission("pimGroups"), status: areaStatus(access.otherGroups) },
    ];
    const detailsLine = DETAILS_LINE(formatTime(checkedAt ?? now, now));
    const closedText = "Closed until you can change something";

    switch (access.overall) {
        case "open": {
            const via = access.headline?.kind === "open" ? viaText(access.headline.via, now) : "";
            return { row: { kind: "open", title: "You can change", chips: chipsOf(access), via }, details, detailsLine, entries: { kind: "none" } };
        }
        case "consent": {
            const workloads = (["directoryRoles", "pimGroups"] as const).filter((w) => {
                const open = w === "directoryRoles" ? access.roles.state === "open" : access.roleAssignableGroups.state === "open" || access.otherGroups.state === "open";
                return open && access.appPermission[w] !== "granted";
            });
            return {
                row: { kind: "consent", title: "Give PIM Manager permission to write first.", text: "Your role allows changes; the app cannot write yet.", workloads },
                details, detailsLine,
                entries: { kind: "consent", text: "Opens once PIM Manager may write" },
            };
        }
        case "activate-first": {
            const target = access.headline?.kind === "activate" ? access.headline.target : null;
            const { name, link } = target ? activateText(target) : { name: "a fitting role", link: { label: "My roles in Entra", href: ENTRA_MY_ROLES_URL } };
            return { row: { kind: "activate", title: `Activate ${name} first`, text: `Activate ${name} to use Configure.`, link }, details, detailsLine, entries: { kind: "closed", text: closedText } };
        }
        default:
            return {
                row: {
                    kind: "closed",
                    title: "Configure is closed for you.",
                    text: "Changing PIM settings or assignments needs Privileged Role Administrator, a group role such as Groups Administrator, or ownership of the group.",
                    subline: "Open the Report to see the current settings.",
                },
                details, detailsLine,
                entries: { kind: "closed", text: closedText },
            };
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Last applies (spec 14.3)

export interface LastApplyLine {
    runId: string;
    title: string;
    subline: string;
    status: "done" | "problems" | "unfinished";
}

function targetNoun(changes: readonly Change[], count: number): string {
    const kinds = new Set(changes.map((c) => c.target.kind));
    const noun = kinds.size === 1 ? (kinds.has("role") ? "role" : "group") : "target";
    return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function dayAndTime(iso: string, now: Date): string {
    const d = new Date(iso);
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const hhmm = formatTime(d, d);
    if (d.toDateString() === now.toDateString()) return `Today ${hhmm}`;
    if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${hhmm}`;
    return formatTime(d, now);
}

export function describeLastApplies(entries: readonly HistoryEntry[], me: readonly string[], now: Date): LastApplyLine[] {
    const mine = new Set(me.filter(Boolean).map((m) => m.toLowerCase()));
    return entries.map((entry) => {
        const results = Object.values(entry.results) as ChangeResult[];
        const status: LastApplyLine["status"] = results.length === 0 ? "unfinished" : results.every((r) => r.status === "done" || r.status === "skipped") ? "done" : "problems";
        const n = entry.changes.length;
        const who = mine.has(entry.by.toLowerCase()) ? "you" : entry.by;
        const tail = status === "unfinished" ? "not finished" : "snapshot saved";
        return {
            runId: entry.runId,
            title: `${n} ${n === 1 ? "change" : "changes"} on ${targetNoun(entry.changes, entry.targetCount)}`,
            subline: `${dayAndTime(entry.at, now)} by ${who} · ${tail}`,
            status,
        };
    });
}
