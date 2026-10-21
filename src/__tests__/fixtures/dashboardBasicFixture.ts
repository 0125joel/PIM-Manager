import type { PimGroupData } from "@/types/pimGroup.types";
import type { RoleDetailData } from "@/types/directoryRole.types";
import { app, endsLater, group, groupPrincipal, noEnd, policy, role, user } from "./dashboardFilterFixtures";

/**
 * Raw data from which `dashboardStats` reproduces the numbers of `docs/Assets/next-gen/dashboard/basic-light.png`:
 * 154 roles and groups (130 roles, 24 groups), 17 active now (11 and 6), 17 permanent (13 and 4), 138 eligible
 * (86 and 52), 33 privileged roles, 5 that require approval, 4 custom roles (2 with assignments), 89 percent of the
 * role-assignable groups under PIM (24 of 27). Terms: 19 Entra MFA, 7 authentication context, 7 neither, 31 with
 * justification, 3 over 8 hours. Two of the 17 permanent assignments belong to emergency access accounts.
 */

export const GLOBAL_ADMIN_TEMPLATE_ID = "62e90394-69f5-4237-9190-012177145e10";
export const EMERGENCY_ACCOUNT_IDS = ["00000000-0000-4000-8000-0000000000e1", "00000000-0000-4000-8000-0000000000e2"] as const;

const userId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const PEOPLE = ["Alex Wilber", "Lee Gu", "Diego Siciliani", "Pradeep Gupta", "Lidia Holloway", "Nestor Wilke", "Joni Sherman", "Isaiah Langer", "Patti Fernandez", "Grady Archie"];
const person = (id: string, displayName?: string) => ({ ...user(id), displayName: displayName ?? PEOPLE[Number(id.slice(-4)) % PEOPLE.length] });

const activatedItem = (principalId: string) => ({ principalId, principal: person(principalId), assignmentType: "Activated", ...endsLater });
const assignedItem = (principalId: string, displayName?: string) => ({ principalId, principal: person(principalId, displayName), assignmentType: "Assigned", ...noEnd });
const appId = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const eligibleItem = (principalId: string) => ({ principalId, principal: person(principalId), ...endsLater });

/** The three role-assignable groups outside PIM; the first two hold a role (see `buildFixtureRoles`) */
export const UNMANAGED_GROUP_IDS = ["GRP-Helpdesk-Admins", "GRP-Exchange-Operators", "GRP-Legacy-Admins"] as const;

const OTHER_ROLE_GROUP_IDS = ["GRP-Tier0-Admins", "GRP-Security-Ops", "GRP-Intune-Admins", "GRP-Teams-Admins"] as const;

export const KNOWN_EXTENSION_ID = "ext-servicenow";

const PRIVILEGED_COUNT = 33;
const ROLE_COUNT = 130;

function privilegedPolicy(index: number) {
    // 19 Entra MFA (0..18), 7 authentication context (19..25), 7 neither (26..32)
    const mfa = index < 19;
    const authContext = index >= 19 && index < 26 ? "c1" : undefined;
    return policy({
        mfa,
        authContext,
        approval: index < 5,
        justification: index !== 7 && index !== 20, // 31 of 33
        // Maximum durations: 4 up to 1 h, 9 up to 4 h, 17 up to 8 h, 2 up to 12 h, 1 over 12 h (3 over 8 h)
        maxDuration: index < 4 ? "PT1H" : index < 13 ? "PT4H" : index < 30 ? "PT8H" : index < 32 ? "PT12H" : "PT24H",
        // 6 privileged roles (20..25) have nobody notified on activation
        notification: { defaults: index < 20 || index > 25, recipients: [] },
    });
}

export function buildFixtureRoles(): RoleDetailData[] {
    const roles: RoleDetailData[] = [];
    for (let i = 0; i < ROLE_COUNT; i++) {
        const privileged = i < PRIVILEGED_COUNT;
        const isCustom = i >= 84 && i < 88; // 4 custom roles, the first two hold an eligible assignment (i < 86)
        // Roles 40 and 41 are held by groups outside PIM instead of a user (the eligible count stays 86)
        const heldByGroup = i === 40 ? UNMANAGED_GROUP_IDS[0] : i === 41 ? UNMANAGED_GROUP_IDS[1] : null;
        // 86 eligible assignments, one per role i < 86 and two on roles 88 and 89 less the two privileged roles that only have permanent members (31, 32)
        let eligible: Record<string, unknown>[] = [];
        if (i < 86 || i === 88 || i === 89) {
            if (heldByGroup) eligible = [{ principalId: heldByGroup, principal: groupPrincipal(heldByGroup), ...endsLater }];
            else if (i >= 10 && i < 13) eligible = [{ principalId: appId(i), principal: app(appId(i)), ...endsLater }]; // 3 apps with a privileged role
            else if (i === 13 || i === 14) eligible = [{ ...eligibleItem(userId(1000 + i)), principalUserType: "Guest" }]; // 2 guests
            else if (i >= 50 && i < 73) eligible = [{ ...eligibleItem(userId(1000 + i)), ...noEnd }]; // 23 without an end date
            else eligible = [eligibleItem(userId(1000 + (i < 33 ? i % 7 : i)))];
        }
        if (i === 31 || i === 32) eligible = [];
        const active: Record<string, unknown>[] = [];
        // 11 activated assignments, on roles 0..10
        if (i < 11) active.push(activatedItem(userId(2000 + (i % 5))));
        // 9 plain permanent assignments on roles 24..32; the Global Administrator holds the other four below
        if (i >= 24 && i < 33) active.push(assignedItem(userId(3000 + i)));
        roles.push(
            role({
                id: `role-${i}`,
                name: i === 0 ? "Global Administrator" : i === 40 ? "Helpdesk Administrator" : i === 41 ? "Exchange Administrator" : `Role ${i}`,
                templateId: i === 0 ? GLOBAL_ADMIN_TEMPLATE_ID : undefined,
                isPrivileged: privileged,
                isBuiltIn: !isCustom,
                policy: privileged ? privilegedPolicy(i) : policy({ maxDuration: "PT8H" }),
                eligible,
                active,
            }),
        );
    }
    // The Global Administrator holds 4 permanent assignments: the 2 emergency access accounts (not counted in Easy to miss)
    // and two people. 9 + 4 = 13 permanent in total.
    const globalAdmin = roles[0];
    globalAdmin.assignments.active = [
        ...globalAdmin.assignments.active,
        ...EMERGENCY_ACCOUNT_IDS.map((id, n) => assignedItem(id, `Break Glass 0${n + 1}`)),
        assignedItem(userId(3900), "Megan Bowen"),
        assignedItem(userId(3901), "Adele Vance"),
    ] as typeof globalAdmin.assignments.active;
    // 39 role assignments are held through 6 groups: roles 40 and 41 (above) and roles 45..81 through four more groups
    for (let i = 45; i <= 81; i++) {
        const groupId = OTHER_ROLE_GROUP_IDS[i % OTHER_ROLE_GROUP_IDS.length];
        const item = roles[i].assignments.eligible[0] as unknown as { principalId: string; principal: unknown };
        item.principalId = groupId;
        item.principal = groupPrincipal(groupId);
    }
    // Approvers of the 5 roles that require approval: Nestor Wilke alone on the Global Administrator
    const approver = (kind: "user" | "group", id: string, name: string) => ({ "@odata.type": kind === "user" ? "#microsoft.graph.singleUser" : "#microsoft.graph.groupMembers", ...(kind === "user" ? { userId: id } : { groupId: id }), name });
    const NESTOR = approver("user", "a1", "Nestor Wilke");
    const SECOPS = approver("group", "g1", "Security Operations");
    const MEGAN = approver("user", "a2", "Megan Bowen");
    const LEE = approver("user", "a3", "Lee Gu");
    const ADELE = approver("user", "a4", "Adele Vance");
    [[NESTOR], [NESTOR, SECOPS], [SECOPS, MEGAN], [SECOPS, LEE], [LEE, ADELE]].forEach((list, i) => {
        const rule = roles[i].policy!.details.rules!.find((r) => r.id === "Approval_EndUser_Assignment")!;
        (rule.setting as unknown as { approvalStages: unknown[] }).approvalStages = [{ primaryApprovers: list.map((a) => ({ "@odata.type": a["@odata.type"], ..."userId" in a ? { userId: a.userId } : { groupId: a.groupId } })) }];
        roles[i].policy!.approvers = list.map((a) => ({ id: "userId" in a ? a.userId : a.groupId, displayName: a.name, type: "userId" in a ? "user" : "group", "@odata.type": a["@odata.type"] })) as never;
    });
    // Custom extensions (preview): four privileged roles call "ServiceNow change check", one calls an extension the tenant does not have
    const extensionRule = (id: string, name: string) => ({ id: "CustomExtension_PreApproval_EndUser_Assignment", "@odata.type": "#microsoft.graph.unifiedRoleManagementPolicyCustomExtensionRule", isEnabled: true, customExtensionId: id, displayName: name, target: { caller: "EndUser", operations: ["All"], level: "Assignment" } });
    [2, 3, 4, 5].forEach((i) => roles[i].policy!.details.rules!.push(extensionRule(KNOWN_EXTENSION_ID, "ServiceNow change check") as never));
    roles[6].definition.displayName = "User Administrator";
    roles[6].policy!.details.rules!.push(extensionRule("ext-missing", "Legacy approval flow") as never);
    // Right now: four activations that end soon, three eligibilities that end within a week
    const soon = (ms: number) => ({ scheduleInfo: { expiration: { type: "afterDateTime", endDateTime: new Date(Date.now() + ms).toISOString() } } });
    [30 * 60000, 60 * 60000, 3 * 3600000, 5 * 3600000].forEach((ms, i) => Object.assign(roles[i].assignments.active[0], soon(ms)));
    [2 * 86400000 - 3600000, 5 * 86400000, 6 * 86400000].forEach((ms, i) => Object.assign(roles[[82, 83, 85][i]].assignments.eligible[0], soon(ms)));
    return roles;
}

export function buildFixtureGroups(): PimGroupData[] {
    const groups: PimGroupData[] = [];
    // 24 groups under PIM: 52 eligible instances, 6 activated (with an end date), 4 permanent
    for (let i = 0; i < 24; i++) {
        const assignments = [];
        const memberOf = (n: number) => user(userId(5000 + i * 10 + n));
        // two eligible per group is 48, four groups get a third to reach 52
        const eligibleCount = i < 4 ? 3 : 2;
        for (let n = 0; n < eligibleCount; n++) {
            assignments.push({ assignmentType: "eligible" as const, principalId: memberOf(n).id, principal: memberOf(n), accessType: i < 10 && n === 0 ? ("owner" as const) : ("member" as const), endDateTime: "2027-01-01T00:00:00Z" });
        }
        if (i < 6) assignments.push({ assignmentType: "active" as const, assignmentOrigin: "activated" as const, principalId: memberOf(8).id, principal: memberOf(8), accessType: "member" as const, endDateTime: "2027-01-01T00:00:00Z" });
        if (i >= 6 && i < 10) assignments.push({ assignmentType: "permanent" as const, principalId: memberOf(9).id, principal: memberOf(9), accessType: "owner" as const });
        const data = group(`group-${i}`, assignments);
        data.group.isAssignableToRole = true;
        groups.push(data);
    }
    // 3 role-assignable groups outside PIM
    [9, 4, 12].forEach((memberCount, i) => {
        const data = group(UNMANAGED_GROUP_IDS[i], [], false);
        data.group.isAssignableToRole = true;
        data.memberCount = memberCount;
        groups.push(data);
    });
    return groups;
}
