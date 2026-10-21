/**
 * "Change in Configure" (spec 16, NG-74): the link from the Report and the dashboard into Edit, and whether it shows.
 * It shows only when the app may write the workload and the access check says the target is open. Pure.
 */
import type { ConfigureTab, GroupAccess } from "@/types/configure.types";
import { roleLock } from "@/utils/configureTargets";
import { buildConfigureSearch, EMPTY_CONFIGURE_URL_STATE } from "@/utils/configureUrlState";
import type { WriteAccess } from "@/utils/writeAccess";

export type ConfigureLinkTarget = { kind: "role"; id: string; tab?: ConfigureTab } | { kind: "group"; id: string; access?: GroupAccess; tab?: ConfigureTab };

/** `/configure?mode=edit&role={id}&tab={tab}`, or `view=groups&group={id}` with `access=owner` for the Owner side */
export function configureHref(target: ConfigureLinkTarget, tab?: ConfigureTab): string {
    const state = target.kind === "role"
        ? { ...EMPTY_CONFIGURE_URL_STATE, mode: "edit" as const, view: "roles" as const, roleId: target.id, tab: target.tab ?? tab }
        : { ...EMPTY_CONFIGURE_URL_STATE, mode: "edit" as const, view: "groups" as const, groupId: target.id, access: target.access ?? "member", tab: target.tab ?? tab };
    return `/configure?${buildConfigureSearch(state)}`;
}

/** The button shows only when the app may write and the target is open for the admin (spec 16) */
export function canChangeInConfigure(access: WriteAccess | null, target: ConfigureLinkTarget): boolean {
    if (!access) return false;
    if (target.kind === "role") return roleLock(access) === null;
    return access.groups[target.id]?.state === "open" && access.appPermission.pimGroups === "granted";
}

/** The link when the button shows, else null: what a Report or dashboard container passes to the view */
export function changeInConfigureHref(access: WriteAccess | null, target: ConfigureLinkTarget, tab?: ConfigureTab): string | null {
    return canChangeInConfigure(access, target) ? configureHref(target, tab) : null;
}
