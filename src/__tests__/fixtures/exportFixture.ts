import type { RoleDetailData, PimPolicyRule } from "@/types/directoryRole.types";
import type { GroupPimAssignment, GroupPimPolicy, PimGroupData } from "@/types/pimGroup.types";
import { buildReportRules, PEOPLE, REPORT_AUTH_CONTEXTS, REPORT_EXTENSIONS } from "./reportFixture";

/** The fixture tenant of Report spec 10.6: every kind of assignment and every policy field the export has to carry */

export const EXPORT_NOW = new Date("2026-10-02T12:00:00Z");
export const EXPORT_AUTH_CONTEXTS = REPORT_AUTH_CONTEXTS;
export const EXPORT_EXTENSIONS = REPORT_EXTENSIONS;
export const NASTY_GROUP_NAME = "=HYPERLINK(\"http://example.com\")";
export const COMMA_GROUP_NAME = "Ops, \"East\" team";

const tenantScope = { directoryScopeId: "/", scopeInfo: { type: "tenant-wide", displayName: "Tenant-wide" } };
const auScope = { directoryScopeId: "/administrativeUnits/au-1", scopeInfo: { type: "administrative-unit", displayName: "Sales AU", id: "au-1" } };
const appScope = { directoryScopeId: "/app-deploy", appScopeId: "/app-deploy", scopeInfo: { type: "app-scoped", displayName: "Deploy", id: "app-deploy" } };
const endsAt = (iso: string) => ({ scheduleInfo: { startDateTime: "2026-01-01T00:00:00Z", expiration: { type: "afterDateTime", endDateTime: iso } } });
const noEnd = { scheduleInfo: { startDateTime: "2026-01-01T00:00:00Z", expiration: { type: "noExpiration" } } };

let counter = 0;
const id = (prefix: string) => `${prefix}-${++counter}`;
const base = (roleId: string, principal: (typeof PEOPLE)[keyof typeof PEOPLE]) => ({ id: id("s"), principalId: principal.id, principal, roleDefinitionId: roleId, status: "Provisioned" });

/** Every notification rule differs from the default (recipients, critical only, default recipients off) */
export function withNonDefaultNotifications(rules: PimPolicyRule[]): PimPolicyRule[] {
    let n = 0;
    return rules.map((rule) => {
        if (!rule["@odata.type"].endsWith("NotificationRule")) return rule;
        const i = n++;
        return { ...rule, isDefaultRecipientsEnabled: i % 2 === 1, notificationLevel: i % 3 === 0 ? "Critical" : "All", notificationRecipients: [`n${i}@contoso.com`, "audit@contoso.com"] } as unknown as PimPolicyRule;
    });
}

/** The before approval extension slot linked to the audit hook but switched off */
export function withDisabledPreExtension(rules: PimPolicyRule[]): PimPolicyRule[] {
    return rules.map((rule) => rule.id === "CustomExtension_PreApproval_EndUser_Assignment"
        ? ({ ...rule, isEnabled: false, customExtensionId: "ext-audit", displayName: "Audit trail hook" } as unknown as PimPolicyRule)
        : rule);
}

const fullRules = (): PimPolicyRule[] => withNonDefaultNotifications(buildReportRules({
    duration: "PT4H",
    authContext: "c1",
    ticket: true,
    approvers: [{ kind: "user", id: "u-erik", name: "Erik van Dam" }, { kind: "group", id: "g-secleads", name: "Security Leads" }],
    extensionBefore: { id: "ext-servicenow", name: "ServiceNow ticket check" },
    extensionAfter: { id: "ext-audit", name: "Audit trail hook" },
    permanentActive: true,
}));

function role(spec: { id: string; name: string; privileged?: boolean; rules?: PimPolicyRule[] | null; eligible?: object[]; active?: object[]; permanent?: object[]; configError?: string; description?: string }): RoleDetailData {
    return {
        definition: { id: spec.id, displayName: spec.name, description: spec.description ?? `Role ${spec.name}`, isBuiltIn: true, isPrivileged: spec.privileged === true },
        assignments: { permanent: spec.permanent ?? [], eligible: spec.eligible ?? [], active: spec.active ?? [] },
        policy: spec.rules === null ? null : { assignment: { id: `pa-${spec.id}` }, details: { id: `pol-${spec.id}`, rules: spec.rules ?? buildReportRules() }, approvers: spec.rules === undefined ? [] : [{ id: "u-erik", displayName: "Erik van Dam", type: "user" }, { id: "g-secleads", displayName: "Security Leads", type: "group" }] },
        configError: spec.configError,
    } as unknown as RoleDetailData;
}

export function buildExportRoles(): RoleDetailData[] {
    counter = 0;
    const ga = "role-ga";
    return [
        role({
            id: ga, name: "Global Administrator", privileged: true, rules: fullRules(),
            eligible: [
                { ...base(ga, PEOPLE.anna), memberType: "Direct", ...tenantScope, ...noEnd },
                { ...base(ga, PEOPLE.bram), memberType: "Direct", ...auScope, ...endsAt("2027-06-30T00:00:00Z") },
                { ...base(ga, PEOPLE.guest), memberType: "Direct", principalUserType: "Guest", ...tenantScope, ...endsAt("2027-01-15T08:00:00Z") },
                { ...base(ga, PEOPLE.app), memberType: "Direct", ...appScope, ...noEnd },
                { ...base(ga, PEOPLE.lotte), memberType: "Group", ...tenantScope, ...noEnd },
            ],
            active: [
                { ...base(ga, PEOPLE.lotte), memberType: "Direct", assignmentType: "Assigned", ...tenantScope, ...noEnd },
                { ...base(ga, PEOPLE.mo), memberType: "Direct", assignmentType: "Assigned", ...tenantScope, ...endsAt("2026-12-01T12:00:00Z") },
                { ...base(ga, PEOPLE.ravi), memberType: "Direct", assignmentType: "Activated", ...tenantScope, ...endsAt("2026-10-02T20:00:00Z") },
                { ...base(ga, PEOPLE.mo), memberType: "Group", viaGroup: true, assignmentType: "Activated", ...tenantScope, ...endsAt("2026-10-02T18:00:00Z") },
                { ...base(ga, PEOPLE.bg1), memberType: "Direct", viaGroup: true, assignmentType: "Assigned", ...tenantScope, ...noEnd },
            ],
            permanent: [
                { id: id("ra"), principalId: PEOPLE.lotte.id, principal: PEOPLE.lotte, roleDefinitionId: ga, ...tenantScope },
                { id: id("ra"), principalId: PEOPLE.erik.id, principal: PEOPLE.erik, roleDefinitionId: ga, ...tenantScope },
                // The role assignment an activation leaves behind: not standing access
                { id: id("ra"), principalId: PEOPLE.ravi.id, principal: PEOPLE.ravi, roleDefinitionId: ga, ...tenantScope },
            ],
        }),
        role({
            id: "role-helpdesk", name: "Helpdesk Administrator", rules: buildReportRules({ mfa: false, justification: false }),
            eligible: [{ ...base("role-helpdesk", PEOPLE.mo), memberType: "Direct", ...tenantScope, ...endsAt("2027-03-01T00:00:00Z") }],
        }),
        role({ id: "role-reader", name: "Reports Reader", rules: null }),
        role({ id: "role-failed", name: "Security Reader", rules: null, configError: "Forbidden" }),
    ];
}

const gAssignment = (groupId: string, principal: (typeof PEOPLE)[keyof typeof PEOPLE], accessType: "member" | "owner", kind: "eligible" | "active" | "permanent", extra: Partial<GroupPimAssignment> = {}): GroupPimAssignment => ({
    id: id("g"), groupId, principalId: principal.id, principal: principal as never, accessType, assignmentType: kind,
    ...(kind === "eligible" ? {} : { assignmentOrigin: "assigned" as const }),
    memberType: "Direct",
    ...extra,
});

const gPolicy = (groupId: string, side: "member" | "owner", rules: PimPolicyRule[], approvers?: GroupPimPolicy["approvers"]): GroupPimPolicy => ({
    id: `${groupId}-${side}`, groupId, policyType: side, rules: rules as unknown as GroupPimPolicy["rules"], approvers,
});

export function buildExportGroups(): PimGroupData[] {
    counter = 100;
    return [
        {
            group: { id: "g-helpdesk", displayName: "Helpdesk Tier 1", groupType: "security", isAssignableToRole: true },
            isManaged: true,
            stats: { eligibleMembers: 2, eligibleOwners: 0, activeMembers: 2, activeOwners: 1 } as PimGroupData["stats"],
            assignments: [
                gAssignment("g-helpdesk", PEOPLE.lotte, "member", "eligible", { endDateTime: "2027-06-30T00:00:00Z" }),
                gAssignment("g-helpdesk", PEOPLE.mo, "member", "eligible", { scheduleInfo: { expiration: { type: "noExpiration" } } }),
                gAssignment("g-helpdesk", PEOPLE.ravi, "member", "active", { endDateTime: "2026-12-24T10:00:00Z" }),
                gAssignment("g-helpdesk", PEOPLE.anna, "member", "active", { assignmentOrigin: "activated", endDateTime: "2026-10-02T18:00:00Z" }),
                gAssignment("g-helpdesk", PEOPLE.erik, "owner", "permanent"),
                gAssignment("g-helpdesk", PEOPLE.guest, "member", "eligible", { memberType: "Group", principalUserType: "Guest" }),
            ],
            policies: {
                member: gPolicy("g-helpdesk", "member", fullRules(), [{ id: "u-erik", displayName: "Erik van Dam", type: "user" }, { id: "g-secleads", displayName: "Security Leads", type: "group" }] as GroupPimPolicy["approvers"]),
                // Linked but switched off: the slot keeps its extension and the export must say it is off
                owner: gPolicy("g-helpdesk", "owner", withNonDefaultNotifications(withDisabledPreExtension(buildReportRules({ mfa: false }))), []),
            },
        },
        {
            group: { id: "g-nasty", displayName: NASTY_GROUP_NAME, groupType: "m365", isAssignableToRole: false },
            isManaged: true,
            assignments: [gAssignment("g-nasty", PEOPLE.mo, "member", "eligible")],
            policies: { member: gPolicy("g-nasty", "member", buildReportRules(), []), owner: gPolicy("g-nasty", "owner", buildReportRules(), []) },
        },
        {
            group: { id: "g-comma", displayName: COMMA_GROUP_NAME, groupType: "security", isAssignableToRole: false },
            isManaged: true,
            assignments: [gAssignment("g-comma", PEOPLE.bram, "owner", "eligible", { endDateTime: "2027-02-01T00:00:00Z" })],
        },
    ];
}
