import { describe, expect, it } from "vitest";
import { DASHBOARD_FILTER_VALUES } from "@/types/dashboardFilter.types";
import { AUDIT_WHO_CHOICES } from "@/utils/auditUrlState";
import { getAzureFilterControls } from "@/utils/azureReportFilter";
import { parseDashboardFilter, serializeDashboardFilter } from "@/utils/dashboardFilter";
import { EASY_TO_MISS_FILTERS } from "@/utils/dashboardStats";
import { getFilterControls } from "@/utils/reportFilterControls";

describe("filter model alignment", () => {
    const EXPECTED_ENTRA_WHO = ["user", "guest", "app", "agent", "group"] as const;

    it("uses one Entra Who vocabulary across Dashboard, Report and Audit", () => {
        const reportRolesWho = getFilterControls("roles").find((control) => control.key === "principalType")!.options.map((option) => option.value);
        const reportGroupsWho = getFilterControls("groups").find((control) => control.key === "principalType")!.options.map((option) => option.value);
        expect(reportRolesWho).toEqual(["all", ...EXPECTED_ENTRA_WHO]);
        expect(reportGroupsWho).toEqual(["all", ...EXPECTED_ENTRA_WHO]);
        expect(DASHBOARD_FILTER_VALUES.principalType).toEqual(EXPECTED_ENTRA_WHO);
        expect(AUDIT_WHO_CHOICES).toEqual(EXPECTED_ENTRA_WHO);
        expect(EASY_TO_MISS_FILTERS.apps.principalType).toBe("app");
    });

    it("keeps Azure Who as the same base set plus Azure-only kinds", () => {
        const azureWho = getAzureFilterControls([]).find((control) => control.key === "principalType")!.options.map((option) => option.value);
        expect(azureWho).toEqual(["all", "user", "group", "app", "guest", "agent", "managedIdentity", "foreignGroup", "deleted"]);
        expect(AUDIT_WHO_CHOICES.every((choice) => azureWho.includes(choice))).toBe(true);
    });

    it("accepts legacy Entra links and writes the canonical app value", () => {
        const parsed = parseDashboardFilter("principalType:servicePrincipal");
        expect(parsed).toEqual({ principalType: "app" });
        expect(serializeDashboardFilter(parsed)).toBe("principalType:app");
    });
});
