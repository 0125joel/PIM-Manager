import { describe, expect, it } from "vitest";
import type { PimGroupData } from "@/types/pimGroup.types";
import { buildExportChartData } from "@/utils/exportChartData";
import { groupEntry } from "@/utils/settingValues";
import { buildGroupRow, groupLock, type TargetListContext } from "@/utils/configureTargets";
import { EMPTY_BASKET } from "@/utils/configureBasket";
import { buildStatsView, buildViewFilterSentence, type CountingState } from "@/utils/dashboardView";
import type { DashboardFilter } from "@/types/dashboardFilter.types";
import { POLICY_NOT_READABLE } from "@/utils/policyReadAccess";
import { isForbiddenRead } from "@/utils/policyReadAccess";
import { buildOverviewGroupSettingsRows } from "@/utils/exportRows";
import { buildReportRoles } from "@/__tests__/fixtures/reportFixture";

const group = (id: string, extra: Partial<PimGroupData> = {}): PimGroupData => ({
    group: { id, displayName: `Group ${id}`, groupType: "security", isAssignableToRole: true } as unknown as PimGroupData["group"],
    assignments: [],
    linkedWorkloads: [],
    isManaged: true,
    ...extra,
} as PimGroupData);

const readable = group("readable", { settings: { memberRequiresMfa: true, memberRequiresApproval: true } });
const refused = group("refused", { policiesForbidden: true });

describe("a group whose policies are not readable", () => {
    it("is not counted as 'no MFA' or 'no approval' in the export charts, and is counted as not readable", () => {
        const data = buildExportChartData({ rolesData: [], groupsData: [readable, refused], isDirectoryRolesCounted: false, isPimGroupsCounted: true, authenticationContexts: [] });
        expect(data.groupSettingsNotReadable).toBe(1);
        expect(data.mfaData.find((i) => i.name === "None")?.value).toBe(1);
        expect(data.approvalData.find((i) => i.name === "No Approval")?.value).toBe(1);
        expect(data.approvalData.find((i) => i.name === "Approval Required")?.value).toBe(1);
    });

    it("says 'Not readable' in the overview settings rows, not 'Not configured'", () => {
        const rows = buildOverviewGroupSettingsRows([refused], { authenticationContexts: [], customExtensions: [] } as never);
        expect(rows.map((r) => r.settings)).toEqual(["Not readable", "Not readable"]);
    });

    it("locks the row in Configure with the shared sentence, so nothing is offered that could not be read", () => {
        expect(groupLock(null, refused)).toBe(POLICY_NOT_READABLE);
        expect(groupLock(null, readable)).toBeNull();
    });

    it("reads as 'Not readable' in the settings of a several-target choice, never as loading", () => {
        const entry = groupEntry(refused, "member", { isRolesLoading: false, isGroupsLoading: false });
        expect(entry).toMatchObject({ settings: null, missing: "notReadable" });
    });

    it("is summarised as 'Settings not readable' in the target list", () => {
        const ctx: TargetListContext = { access: null, basket: EMPTY_BASKET, authenticationContexts: [], isPoliciesLoading: false };
        expect(buildGroupRow(refused, ctx).summary).toBe("Settings not readable");
    });
});

describe("the dashboard's policy filter and a group whose policy is not readable", () => {
    const counting: CountingState = { directoryRoles: false, pimGroups: true, unmanagedGroups: false, agents: true };
    const view = (effective: DashboardFilter) => buildStatsView({ rolesData: [], groupsData: [readable, refused], counting, effective, policiesLoading: false, emergencyAccountIds: new Set(), scope: "all" });

    it("a policy filter is roles only: it shows no group at all, so it blames none on the access", () => {
        const effective = { approval: "required" } as DashboardFilter;
        expect(view(effective)).toMatchObject({ groups: [], notReadableGroupCount: 0 });
        expect(buildViewFilterSentence(view(effective), [], effective, true, false)).not.toContain("not readable");
    });

    it("says nothing about unreadable groups without a policy filter", () => {
        const effective = { privileged: true } as DashboardFilter;
        expect(buildViewFilterSentence(view(effective), [], effective, true, false)).not.toContain("not readable");
    });

    it("counts roles too, and only those the other keys of the filter keep", () => {
        const base = buildReportRoles()[0];
        const roleOf = (id: string, isPrivileged: boolean) => ({ ...base, definition: { ...base.definition, id, isPrivileged }, policy: null, policiesForbidden: true });
        const rolesData = [roleOf("r-priv", true), roleOf("r-other", false)];
        const roleView = (effective: DashboardFilter) => buildStatsView({ rolesData, groupsData: [readable, refused], counting: { ...counting, directoryRoles: true }, effective, policiesLoading: false, emergencyAccountIds: new Set(), scope: "all" });
        expect(roleView({ mfa: "neither" } as DashboardFilter)).toMatchObject({ notReadableRoleCount: 2, notReadableGroupCount: 0 });
        const privilegedMfa = { mfa: "neither", privileged: true } as DashboardFilter;
        expect(roleView(privilegedMfa).notReadableRoleCount).toBe(1);
        expect(buildViewFilterSentence(roleView({ mfa: "neither" } as DashboardFilter), rolesData, { mfa: "neither" } as DashboardFilter, true, false)).toContain("2 roles with settings not readable with your access are not counted.");
    });
});

describe("isForbiddenRead", () => {
    it("recognises a 403 and nothing else", () => {
        expect(isForbiddenRead({ statusCode: 403 })).toBe(true);
        expect(isForbiddenRead({ statusCode: 429 })).toBe(false);
        expect(isForbiddenRead(new Error("boom"))).toBe(false);
    });
});
