/** The five gap-free buckets of the maximum activation duration (spec 4.3). */
export type MaxDurationBucket = "upTo1h" | "upTo4h" | "upTo8h" | "upTo12h" | "over12h";

/** One filter model for the dashboard and the report (spec 4.6). It lives in the URL as `f`, for example `f=mfa:neither`. */
export interface DashboardFilter {
    /** `activated` and `assigned` are the exact Report forms of an active assignment; `active` keeps its dashboard meaning (spec 6.2) */
    assignment?: "permanent" | "eligible" | "active" | "activeTimeBound" | "activated" | "assigned";
    privileged?: boolean;
    approval?: "required" | "notRequired";
    mfa?: "entraMfa" | "authContext" | "neither";
    justification?: "required" | "notRequired";
    /** A bucket, or `over8h` (more than 8 hours: the "over 8 h" figure of the Terms block) */
    maxDuration?: MaxDurationBucket | "over8h";
    /** "agent" is any of the three Agent ID kinds; "user" is a person only, never an agent's user account */
    principalType?: "user" | "guest" | "servicePrincipal" | "group" | "agent";
    /** How a role is held: directly (a user or an app) or through a group that is the principal ("Direct or through a group") */
    via?: "direct" | "group";
    /** Only the positive form exists: eligible without an end date. */
    noEndDate?: true;
    activationNotification?: "none";
    hasEligible?: false;
    roleTemplateId?: string;
    /** Roles whose policy links this custom extension (id), in either slot */
    customExtension?: string;
    customRole?: boolean;
    excludeEmergency?: boolean;
    /** Report, roles: at least one eligible or active assignment */
    hasAssignments?: true;
    /** Report, groups: under PIM (`isManaged`) or outside it */
    groupPim?: "under" | "outside";
    /** Report, groups: holds Entra roles, is role-assignable but holds none, or is not role-assignable */
    entraRoles?: "holds" | "assignableNone" | "notAssignable";
    /** Report, groups: holds a privileged role */
    givesPrivileged?: true;
    /** Report, groups: the assignment is a membership or an ownership */
    accessType?: "member" | "owner";
    /** Report, groups: the policy the policy keys read; Member is the default and is not written */
    appliesTo?: "owner";
}

export type DashboardFilterKey = keyof DashboardFilter;

/** Key order of the serialised form, the order of the interface above. */
export const DASHBOARD_FILTER_KEYS: readonly DashboardFilterKey[] = [
    "assignment",
    "privileged",
    "approval",
    "mfa",
    "justification",
    "maxDuration",
    "principalType",
    "via",
    "noEndDate",
    "activationNotification",
    "hasEligible",
    "roleTemplateId",
    "customExtension",
    "customRole",
    "excludeEmergency",
    "hasAssignments",
    "groupPim",
    "entraRoles",
    "givesPrivileged",
    "accessType",
    "appliesTo",
];

export type FilterView = "roles" | "groups";

/** The view a key applies to; a key of the other view is kept in `f` but not applied (Report spec 6.2). */
export const FILTER_KEY_VIEW: Record<DashboardFilterKey, FilterView | "both"> = {
    assignment: "both",
    privileged: "roles",
    approval: "both",
    mfa: "both",
    justification: "both",
    maxDuration: "both",
    principalType: "both",
    via: "both",
    noEndDate: "both",
    activationNotification: "both",
    hasEligible: "roles",
    roleTemplateId: "roles",
    customExtension: "both",
    customRole: "roles",
    excludeEmergency: "both",
    hasAssignments: "roles",
    groupPim: "groups",
    entraRoles: "groups",
    givesPrivileged: "groups",
    accessType: "groups",
    appliesTo: "groups",
};

export const DASHBOARD_FILTER_VALUES = {
    assignment: ["permanent", "eligible", "active", "activeTimeBound", "activated", "assigned"],
    approval: ["required", "notRequired"],
    mfa: ["entraMfa", "authContext", "neither"],
    justification: ["required", "notRequired"],
    maxDuration: ["upTo1h", "upTo4h", "upTo8h", "upTo12h", "over12h", "over8h"],
    principalType: ["user", "guest", "servicePrincipal", "group", "agent"],
    via: ["direct", "group"],
    activationNotification: ["none"],
    groupPim: ["under", "outside"],
    entraRoles: ["holds", "assignableNone", "notAssignable"],
    accessType: ["member", "owner"],
    appliesTo: ["owner"],
} as const;
