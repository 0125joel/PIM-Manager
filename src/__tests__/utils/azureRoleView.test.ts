import { describe, expect, it } from "vitest";
import type { AzureAssignment, AzureScope } from "@/types/azureResource.types";
import { DEFAULT_AZURE_FILTERS, type AzureAssignmentRow } from "@/utils/azureReport";
import { baseFiltersOf, buildAzureRoleDetail, buildAzureRoleList, hasAssignmentMarking, isAzureListView, sortAzureRoles } from "@/utils/azureRoleView";

/** The role view of the Azure Report (Azure spec 15.2), with literal rows */

const OWNER = "8e3af657-a8ff-443c-a75c-2fe8c4bcb635";
const READER = "acdd72a7-3385-48ef-bd42-f606fba81ae7";
const CUSTOM = "11111111-2222-3333-4444-555555555555";

const SUB: AzureScope = { id: "/subscriptions/s1", name: "Production", level: "subscription", parentId: null };
const RG: AzureScope = { id: "/subscriptions/s1/resourceGroups/rg-web", name: "rg-web", level: "resourceGroup", parentId: SUB.id };

function row(id: string, roleId: string, roleName: string, state: "active" | "eligible", extra: Partial<AzureAssignment> = {}, scope: AzureScope = SUB): AzureAssignmentRow {
    return {
        assignment: { id, scopeId: scope.id, principalId: `p-${id}`, principalName: `Person ${id}`, principalType: "User", roleDefinitionId: roleId, roleName, state, memberType: "direct", endDateTime: null, ...extra },
        scope,
        isInherited: false,
        originText: "This scope",
        endText: "Permanent",
        principalTypeLabel: "User",
    };
}

const base = [
    row("o1", OWNER, "Owner", "active"),
    row("o2", OWNER, "Owner", "eligible", { endDateTime: "2026-12-01T00:00:00Z" }),
    row("o3", OWNER, "Owner", "active", { isActivated: true, endDateTime: "2026-10-20T00:00:00Z" }),
    row("r1", READER, "Reader", "active", {}, RG),
    row("r2", READER, "Reader", "active", { endDateTime: "2026-11-01T00:00:00Z" }),
    row("c1", CUSTOM, "Contoso Deployer", "eligible", { isCustomRole: true }),
];

describe("buildAzureRoleList", () => {
    it("counts every base row of a role shown by the filtered rows", () => {
        const list = buildAzureRoleList([base[1], base[3]], base);
        expect(list.map((r) => r.id)).toEqual([OWNER, READER]);
        expect(list[0]).toEqual({ id: OWNER, name: "Owner", isPrivileged: true, isCustom: false, eligible: 1, active: 2, permanent: 1, hasPermanentActive: true, hasNoMfaSignal: null });
        expect(list[1]).toMatchObject({ isPrivileged: false, eligible: 0, active: 2, permanent: 1 });
    });

    it("does not count an activated or time-bound active row as permanent, and marks a custom role", () => {
        const list = buildAzureRoleList(base, [base[2], base[4], base[5]]);
        expect(list.find((r) => r.id === OWNER)).toMatchObject({ permanent: 0, hasPermanentActive: false });
        expect(list.find((r) => r.id === CUSTOM)).toMatchObject({ isCustom: true, eligible: 1 });
    });

    it("compares role ids without case", () => {
        const upper = row("u1", OWNER.toUpperCase(), "Owner", "eligible");
        expect(buildAzureRoleList([upper], [base[0], upper])).toHaveLength(1);
    });
});

describe("sortAzureRoles", () => {
    const list = buildAzureRoleList(base, base);

    it("puts most assignments first, ties by name", () => {
        expect(sortAzureRoles(list, "assignments").map((r) => r.name)).toEqual(["Owner", "Reader", "Contoso Deployer"]);
    });

    it("sorts by name", () => {
        expect(sortAzureRoles(list, "name").map((r) => r.name)).toEqual(["Contoso Deployer", "Owner", "Reader"]);
    });

    it("puts most permanent first, ties by name", () => {
        expect(sortAzureRoles(list, "permanent").map((r) => r.name)).toEqual(["Owner", "Reader", "Contoso Deployer"]);
    });
});

describe("buildAzureRoleDetail", () => {
    it("groups the role's base rows, marks the filtered ones and flags rows of another scope", () => {
        const detail = buildAzureRoleDetail(READER, [base[3]], base, SUB.id, { ...DEFAULT_AZURE_FILTERS, query: "Person r1" });
        expect(detail).not.toBeNull();
        expect(detail).toMatchObject({ id: READER, name: "Reader", isPrivileged: false, isCustom: false, total: 2, isMarking: true });
        expect(detail?.eligible).toEqual([]);
        expect(detail?.active.map((i) => [i.row.assignment.id, i.isMarked, i.isOtherScope])).toEqual([["r1", true, true], ["r2", false, false]]);
    });

    it("does not mark with only the start filters", () => {
        expect(buildAzureRoleDetail(OWNER, base, base, SUB.id, DEFAULT_AZURE_FILTERS)?.isMarking).toBe(false);
    });

    it("gives null for a role without rows", () => {
        expect(buildAzureRoleDetail("00000000-0000-0000-0000-000000000000", base, base, SUB.id, DEFAULT_AZURE_FILTERS)).toBeNull();
    });
});

describe("filters of the role view", () => {
    it("keeps only Origin as the base filter", () => {
        expect(baseFiltersOf({ ...DEFAULT_AZURE_FILTERS, origin: "all", status: "eligible", query: "x" })).toEqual({ ...DEFAULT_AZURE_FILTERS, origin: "all", status: "all", privileged: false, query: "" });
    });

    it("marks on a search or a filter other than Origin", () => {
        expect(hasAssignmentMarking(DEFAULT_AZURE_FILTERS)).toBe(false);
        expect(hasAssignmentMarking({ ...DEFAULT_AZURE_FILTERS, origin: "all" })).toBe(false);
        expect(hasAssignmentMarking({ ...DEFAULT_AZURE_FILTERS, query: "  " })).toBe(false);
        expect(hasAssignmentMarking({ ...DEFAULT_AZURE_FILTERS, query: "anna" })).toBe(true);
        expect(hasAssignmentMarking({ ...DEFAULT_AZURE_FILTERS, privileged: true })).toBe(true);
    });

    it("knows the two views", () => {
        expect(isAzureListView("roles")).toBe(true);
        expect(isAzureListView("assignments")).toBe(true);
        expect(isAzureListView("groups")).toBe(false);
        expect(isAzureListView(null)).toBe(false);
    });
});
