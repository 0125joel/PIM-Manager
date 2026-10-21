/**
 * The explanation of every tag of the Report, in one place: the tooltip of a tag and the term in the help panel read the same
 * string (Report spec 8). A tag with a tip needs an entry here; the test checks it.
 */

export type ReportTermKey =
    | "user" | "guest" | "app" | "group" | "agentIdentity" | "agentUser" | "agentBlueprint"
    | "direct" | "viaGroup" | "viaGroupUnnamed"
    | "tenantWide" | "administrativeUnit"
    | "expires" | "noEndDate" | "permanent"
    | "activated" | "assigned"
    | "alwaysOn" | "outsidePim" | "underPim"
    | "emergency" | "preview"
    | "member" | "owner" | "privileged" | "custom";

export interface ReportTerm {
    label: string;
    text: string;
}

export const REPORT_TERMS: Record<ReportTermKey, ReportTerm> = {
    user: { label: "User", text: "A person in this tenant." },
    guest: { label: "Guest", text: "An account from another organisation, invited as a guest." },
    app: { label: "App", text: "An application or managed identity (service principal)." },
    group: { label: "Group", text: "A group: every member gets the role." },
    agentIdentity: { label: "Agent identity", text: "The account an AI agent runs as in this tenant. An agent can hold a Microsoft Entra role from Microsoft's list of allowed roles, and custom roles; many highly privileged roles, such as Global Administrator, are blocked. In our tests an eligible assignment was rejected, so expect active assignments." },
    agentUser: { label: "Agent's user account", text: "A user account that belongs to one AI agent, for work that needs a mailbox or Teams. It cannot hold privileged administrator roles." },
    agentBlueprint: { label: "Agent identity blueprint principal", text: "The tenant's copy of the template that AI agents are created from. It is not an agent itself." },
    direct: { label: "Direct", text: "Assigned to this account itself, not through a group." },
    viaGroup: { label: "Via group", text: "Has the role because they are a member of this group. Changing the group changes who has the role." },
    viaGroupUnnamed: { label: "Via group", text: "Activated through membership of a group that is eligible for this role." },
    tenantWide: { label: "Tenant-wide", text: "The assignment applies to the whole directory." },
    administrativeUnit: { label: "Administrative unit", text: "The assignment is limited to the members of one administrative unit." },
    expires: { label: "Expires", text: "The assignment ends on this date." },
    noEndDate: { label: "No end date", text: "Eligible with no end date: never comes up for review by itself." },
    permanent: { label: "Permanent", text: "Always active, with no end date." },
    activated: { label: "Activated", text: "Active because they activated their eligible role. Ends by itself." },
    assigned: { label: "Assigned", text: "Made active directly by an administrator, without activation." },
    alwaysOn: { label: "Always on", text: "Outside PIM: membership is permanent, nobody activates it." },
    outsidePim: { label: "Outside PIM", text: "A role-assignable group that PIM does not manage: its members hold its roles all the time." },
    underPim: { label: "Under PIM", text: "Membership of this group is eligible or time-bound and follows the PIM policy of the group." },
    emergency: { label: "Emergency access", text: "Marked as an emergency access account in Settings." },
    preview: { label: "Preview", text: "Microsoft has released custom extensions for PIM as a preview. They can change before general availability." },
    member: { label: "Member", text: "A member of the group." },
    owner: { label: "Owner", text: "An owner of the group." },
    privileged: { label: "Privileged", text: "Microsoft marks this role as privileged: it can change security settings or grant access." },
    custom: { label: "Custom", text: "A role this organisation defined itself, not a built-in role." },
};

/** The terms the help panel lists (spec 8), in order */
export const REPORT_HELP_TERM_KEYS: readonly ReportTermKey[] = [
    "direct", "viaGroup", "tenantWide", "administrativeUnit", "permanent", "noEndDate", "activated", "assigned", "alwaysOn", "outsidePim", "emergency", "preview",
    "agentIdentity", "agentUser", "agentBlueprint",
];
