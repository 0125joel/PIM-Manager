import { describe, expect, it } from "vitest";
import { buildExportChartData } from "@/utils/exportChartData";
import { buildFixtureGroups, buildFixtureRoles } from "../fixtures/dashboardBasicFixture";

const base = { rolesData: buildFixtureRoles(), groupsData: buildFixtureGroups(), isDirectoryRolesCounted: true, isPimGroupsCounted: true };

describe("buildExportChartData", () => {
    it("keeps the meaning of the old export datasets", () => {
        const data = buildExportChartData(base);
        expect(data.assignmentData.find((d) => d.name === "Eligible")?.value).toBe(138);
        expect(data.managedData.map((d) => d.value)).toEqual([24, 3]);
        expect(data.approvalData.find((d) => d.name === "Approval Required")?.value).toBe(5);
        expect(data.mfaData.map((d) => d.name)).toEqual(["Azure MFA", "Conditional Access", "None"]);
        expect(data.durationData.map((d) => d.name)).toEqual(["<1h", "2-4h", "5-8h", "9-12h", ">12h", "N/A"]);
        expect(data.authContextData).toHaveLength(1);
    });

    it("leaves out the workloads that are not counted", () => {
        const onlyGroups = buildExportChartData({ ...base, isDirectoryRolesCounted: false });
        expect(onlyGroups.assignmentData.find((d) => d.name === "Eligible")?.value).toBe(52);
        expect(onlyGroups.approvalData.reduce((s, d) => s + d.value, 0)).toBe(54);
        const onlyRoles = buildExportChartData({ ...base, isPimGroupsCounted: false });
        expect(onlyRoles.mfaData.reduce((s, d) => s + d.value, 0)).toBe(130);
    });

    it("leaves a role whose policy is not readable out of the settings charts (FIX-12)", () => {
        const rolesData = buildFixtureRoles().map((r, i) => (i < 10 ? { ...r, policy: null, policiesForbidden: true } : r));
        const data = buildExportChartData({ ...base, rolesData, isPimGroupsCounted: false });
        expect(data.roleSettingsNotReadable).toBe(10);
        expect(data.mfaData.reduce((s, d) => s + d.value, 0)).toBe(120);
        expect(data.approvalData.reduce((s, d) => s + d.value, 0)).toBe(120);
        expect(data.durationData.reduce((s, d) => s + d.value, 0)).toBe(120);
        expect(data.assignmentData.find((d) => d.name === "Eligible")?.value).toBe(86);
    });
});
