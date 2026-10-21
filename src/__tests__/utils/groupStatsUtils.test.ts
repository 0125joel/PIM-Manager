import { describe, it, expect } from "vitest";
import { getRoleAssignableCounts } from "@/utils/groupStatsUtils";
import type { PimGroupData } from "@/types/pimGroup.types";

function group(id: string, isAssignableToRole: boolean | undefined, isManaged: boolean | undefined): PimGroupData {
    return {
        group: { id, displayName: id, groupType: "security", isAssignableToRole },
        assignments: [],
        isManaged,
    };
}

describe("getRoleAssignableCounts", () => {
    it("counts role-assignable groups and the onboarded ones among them", () => {
        const counts = getRoleAssignableCounts([
            group("a", true, true),
            group("b", true, true),
            group("c", true, false),
            group("d", false, true), // onboarded but not role-assignable: not part of either number
            group("e", undefined, true),
        ]);
        expect(counts).toEqual({ roleAssignableCount: 3, onboardedRoleAssignableCount: 2 });
    });

    it("treats a group without the managed flag as onboarded, like the rest of the app", () => {
        expect(getRoleAssignableCounts([group("a", true, undefined)])).toEqual({ roleAssignableCount: 1, onboardedRoleAssignableCount: 1 });
    });

    it("is zero for no groups", () => {
        expect(getRoleAssignableCounts([])).toEqual({ roleAssignableCount: 0, onboardedRoleAssignableCount: 0 });
    });
});
