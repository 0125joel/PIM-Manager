import type { DashboardFilter, DashboardFilterKey, FilterView } from "@/types/dashboardFilter.types";

/**
 * The controls of the Report filter panel (spec 6.2) as data: one control writes exactly one key of `f`. The panel renders this
 * list, so "every control sets and clears its key" is a property of the data and is tested without the component. A control
 * whose options depend on the tenant (Role, Custom extension) has no fixed options here; the panel adds them.
 */

export interface FilterControlOption {
    value: string;
    label: string;
}

export type FilterControlGroup = "Role properties" | "Group properties" | "Assignments" | "PIM configuration";

export interface FilterControl {
    /** The key of `f` this control writes */
    key: DashboardFilterKey;
    label: string;
    group: FilterControlGroup;
    /** The first option is the neutral one (no key) unless `neutral` says otherwise */
    options: FilterControlOption[];
    /** Options that come from the data (roles by name, the tenant's extensions): the panel supplies them */
    dynamic?: "roleTemplates" | "customExtensions";
    /** Needs the loaded policy of the role or group: disabled while policies load (spec 7.2) */
    needsPolicy?: boolean;
    /** Value shown when the key is not in `f` */
    neutral: string;
}

const ALL = { value: "all", label: "All" };

const policyControls = (view: FilterView): FilterControl[] => {
    const control = (key: keyof typeof POLICY_CONTROL): FilterControl => POLICY_CONTROL[key];
    return view === "groups"
        ? [APPLIES_TO, control("mfa"), control("approval"), control("maxDuration"), control("justification"), control("customExtension"), control("activationNotification")]
        : [control("mfa"), control("approval"), control("justification"), control("maxDuration"), control("customExtension"), control("activationNotification")];
};

const APPLIES_TO: FilterControl = { key: "appliesTo", label: "Applies to", group: "PIM configuration", neutral: "member", options: [{ value: "member", label: "Member" }, { value: "owner", label: "Owner" }] };

const POLICY_CONTROL: Record<"mfa" | "approval" | "justification" | "maxDuration" | "customExtension" | "activationNotification", FilterControl> = {
    mfa: { key: "mfa", label: "On activation, require", group: "PIM configuration", neutral: "all", needsPolicy: true, options: [ALL, { value: "entraMfa", label: "Entra MFA" }, { value: "authContext", label: "Auth context" }, { value: "neither", label: "Neither" }] },
    approval: { key: "approval", label: "Approval", group: "PIM configuration", neutral: "all", needsPolicy: true, options: [ALL, { value: "required", label: "Required" }, { value: "notRequired", label: "Not required" }] },
    justification: { key: "justification", label: "Justification", group: "PIM configuration", neutral: "all", needsPolicy: true, options: [ALL, { value: "required", label: "Required" }, { value: "notRequired", label: "Not required" }] },
    maxDuration: { key: "maxDuration", label: "Max activation duration", group: "PIM configuration", neutral: "all", needsPolicy: true, options: [ALL, { value: "upTo1h", label: "Up to 1 h" }, { value: "upTo4h", label: "Up to 4 h" }, { value: "upTo8h", label: "Up to 8 h" }, { value: "upTo12h", label: "Up to 12 h" }, { value: "over12h", label: "Over 12 h" }] },
    customExtension: { key: "customExtension", label: "Custom extension", group: "PIM configuration", neutral: "all", needsPolicy: true, dynamic: "customExtensions", options: [ALL] },
    activationNotification: { key: "activationNotification", label: "Activation notification", group: "PIM configuration", neutral: "all", needsPolicy: true, options: [ALL, { value: "none", label: "Nobody notified" }] },
};

const STATE: FilterControl = { key: "assignment", label: "State", group: "Assignments", neutral: "all", options: [ALL, { value: "eligible", label: "Eligible" }, { value: "activated", label: "Active after activation" }, { value: "assigned", label: "Active assigned" }, { value: "permanent", label: "Permanent" }] };
const NO_END: FilterControl = { key: "noEndDate", label: "No end date", group: "Assignments", neutral: "all", options: [ALL, { value: "true", label: "Only without end date" }] };
const EMERGENCY: FilterControl = { key: "excludeEmergency", label: "Emergency access", group: "Assignments", neutral: "include", options: [{ value: "include", label: "Include" }, { value: "exclude", label: "Exclude" }] };
const via = (label: string): FilterControl => ({ key: "via", label, group: "Assignments", neutral: "all", options: [ALL, { value: "direct", label: "Direct" }, { value: "group", label: "Via group" }] });
const who = (view: FilterView): FilterControl => ({
    key: "principalType", label: "Who", group: "Assignments", neutral: "all",
    options: [ALL, { value: "user", label: "Users" }, { value: "guest", label: "Guests" }, ...(view === "roles" ? [{ value: "servicePrincipal", label: "Apps" }] : []), { value: "agent", label: "Agents" }, { value: "group", label: "Groups" }],
});

/** The order of the renders: the roles view as spec 6.2 lists it, the groups view as `groups-filters-open.png` */
const assignmentControls = (view: FilterView): FilterControl[] =>
    view === "roles"
        ? [{ key: "hasAssignments", label: "Has assignments", group: "Assignments", neutral: "all", options: [ALL, { value: "true", label: "Yes" }] }, STATE, who("roles"), via("Direct or via group"), NO_END, EMERGENCY]
        : [{ key: "accessType", label: "Member or owner", group: "Assignments", neutral: "all", options: [{ value: "all", label: "Both" }, { value: "member", label: "Member" }, { value: "owner", label: "Owner" }] }, via("Direct or via a group"), NO_END, STATE, who("groups"), EMERGENCY];

const ROLE_CONTROLS: FilterControl[] = [
    { key: "privileged", label: "Privileged", group: "Role properties", neutral: "all", options: [ALL, { value: "true", label: "Privileged only" }] },
    { key: "customRole", label: "Built-in or custom", group: "Role properties", neutral: "all", options: [ALL, { value: "false", label: "Built-in" }, { value: "true", label: "Custom" }] },
    { key: "roleTemplateId", label: "Role", group: "Role properties", neutral: "all", dynamic: "roleTemplates", options: [{ value: "all", label: "All roles" }] },
    ...assignmentControls("roles"),
    ...policyControls("roles"),
];

const GROUP_CONTROLS: FilterControl[] = [
    { key: "groupPim", label: "PIM", group: "Group properties", neutral: "all", options: [ALL, { value: "under", label: "Under PIM" }, { value: "outside", label: "Outside PIM" }] },
    { key: "entraRoles", label: "Entra roles", group: "Group properties", neutral: "all", options: [ALL, { value: "holds", label: "Holds roles" }, { value: "assignableNone", label: "Role-assignable, no roles" }, { value: "notAssignable", label: "Not role-assignable" }] },
    { key: "givesPrivileged", label: "Gives a privileged role", group: "Group properties", neutral: "all", options: [ALL, { value: "true", label: "Yes" }] },
    ...assignmentControls("groups"),
    ...policyControls("groups"),
];

export function getFilterControls(view: FilterView): FilterControl[] {
    return view === "roles" ? ROLE_CONTROLS : GROUP_CONTROLS;
}

/** The value a control shows for the current filter */
export function readControlValue(control: FilterControl, filter: DashboardFilter): string {
    const raw = filter[control.key];
    if (raw === undefined) return control.neutral;
    if (control.key === "excludeEmergency") return raw === true ? "exclude" : "include";
    return String(raw);
}

/**
 * The filter after the user picked `value` on a control: the neutral value removes the key; everything else sets it. Keys of
 * the other view and every other key are kept untouched.
 */
export function writeControlValue(control: FilterControl, filter: DashboardFilter, value: string): DashboardFilter {
    const next: Record<string, unknown> = { ...filter };
    if (value === control.neutral) {
        delete next[control.key];
        return next as DashboardFilter;
    }
    switch (control.key) {
        case "privileged":
        case "customRole":
            next[control.key] = value === "true";
            break;
        case "excludeEmergency":
            next.excludeEmergency = true;
            break;
        case "hasAssignments":
        case "givesPrivileged":
        case "noEndDate":
            next[control.key] = true;
            break;
        default:
            next[control.key] = value;
    }
    return next as DashboardFilter;
}

/** Group the controls for the three columns of the panel, in order. */
export function groupControls(controls: FilterControl[]): Array<{ group: FilterControlGroup; controls: FilterControl[] }> {
    const groups: Array<{ group: FilterControlGroup; controls: FilterControl[] }> = [];
    for (const control of controls) {
        const existing = groups.find((g) => g.group === control.group);
        if (existing) existing.controls.push(control);
        else groups.push({ group: control.group, controls: [control] });
    }
    return groups;
}
