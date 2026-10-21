import { describe, it, expect } from "vitest";
import { MAX_DURATION_PANEL_LABELS, getMaxDurationBucket, getUnscheduledRoleAssignments, hasNoEnd, isActivated, isActivatedGroupAssignment, isEligibleWithoutEnd, isPermanentActive, isTimeBoundActive } from "@/utils/assignmentKinds";

const noExpiration = { scheduleInfo: { expiration: { type: "noExpiration" } } };
const afterDateTime = { scheduleInfo: { expiration: { type: "afterDateTime", endDateTime: "2026-12-31T00:00:00Z" } } };
const afterDuration = { scheduleInfo: { expiration: { type: "afterDuration", duration: "PT8H" } } };

describe("hasNoEnd", () => {
    it("is true for noExpiration and for a schedule without any end information", () => {
        expect(hasNoEnd(noExpiration)).toBe(true);
        expect(hasNoEnd({})).toBe(true);
        expect(hasNoEnd({ scheduleInfo: { expiration: { endDateTime: null } } })).toBe(true);
    });
    it("is false when there is an end date", () => {
        expect(hasNoEnd(afterDateTime)).toBe(false);
        expect(hasNoEnd({ scheduleInfo: { expiration: { endDateTime: "2026-12-31T00:00:00Z" } } })).toBe(false);
    });
    it("is false for afterDuration even without a resolved end date", () => {
        expect(hasNoEnd(afterDuration)).toBe(false);
    });
});

describe("assignment kinds", () => {
    it("permanent is Assigned without an end, in any letter case", () => {
        expect(isPermanentActive({ assignmentType: "Assigned", ...noExpiration })).toBe(true);
        expect(isPermanentActive({ assignmentType: "assigned", ...noExpiration })).toBe(true);
        expect(isPermanentActive({ assignmentType: "Assigned", ...afterDateTime })).toBe(false);
        expect(isPermanentActive({ assignmentType: "Activated", ...noExpiration })).toBe(false);
        expect(isPermanentActive({ ...noExpiration })).toBe(false);
    });
    it("activated is the Activated type in any letter case", () => {
        expect(isActivated({ assignmentType: "Activated" })).toBe(true);
        expect(isActivated({ assignmentType: "activated" })).toBe(true);
        expect(isActivated({ assignmentType: "Assigned" })).toBe(false);
    });
    it("time-bound is any active schedule with an end, assigned or activated", () => {
        expect(isTimeBoundActive({ assignmentType: "Assigned", ...afterDateTime })).toBe(true);
        expect(isTimeBoundActive({ assignmentType: "Activated", ...afterDuration })).toBe(true);
        expect(isTimeBoundActive({ assignmentType: "Assigned", ...noExpiration })).toBe(false);
    });
    it("eligible without an end follows hasNoEnd", () => {
        expect(isEligibleWithoutEnd(noExpiration)).toBe(true);
        expect(isEligibleWithoutEnd(afterDateTime)).toBe(false);
    });
});

describe("getMaxDurationBucket", () => {
    it("puts the bucket edges in the lower bucket", () => {
        expect(getMaxDurationBucket(1)).toBe("upTo1h");
        expect(getMaxDurationBucket(4)).toBe("upTo4h");
        expect(getMaxDurationBucket(8)).toBe("upTo8h");
        expect(getMaxDurationBucket(12)).toBe("upTo12h");
        expect(getMaxDurationBucket(12.5)).toBe("over12h");
    });
    it("leaves no gap for half hours", () => {
        expect(getMaxDurationBucket(0.5)).toBe("upTo1h");
        expect(getMaxDurationBucket(1.5)).toBe("upTo4h");
        expect(getMaxDurationBucket(4.5)).toBe("upTo8h");
        expect(getMaxDurationBucket(8.5)).toBe("upTo12h");
    });
    it("returns null for an unknown duration instead of the smallest bucket", () => {
        expect(getMaxDurationBucket(null)).toBeNull();
        expect(getMaxDurationBucket(undefined)).toBeNull();
        expect(getMaxDurationBucket(Number.NaN)).toBeNull();
    });
    it("has a panel label for every bucket", () => {
        expect(MAX_DURATION_PANEL_LABELS).toEqual({ upTo1h: "<1h", upTo4h: "2-4h", upTo8h: "5-8h", upTo12h: "9-12h", over12h: ">12h" });
    });
});

describe("isActivatedGroupAssignment", () => {
    it("is true only for an active instance that Graph reports as activated", () => {
        expect(isActivatedGroupAssignment({ assignmentType: "active", assignmentOrigin: "activated" })).toBe(true);
        expect(isActivatedGroupAssignment({ assignmentType: "active", assignmentOrigin: "assigned" })).toBe(false);
        expect(isActivatedGroupAssignment({ assignmentType: "active" })).toBe(false);
        expect(isActivatedGroupAssignment({ assignmentType: "eligible" })).toBe(false);
    });
});

describe("getUnscheduledRoleAssignments", () => {
    it("keeps a role assignment only when no active schedule has its principal and scope", () => {
        const permanent = [
            { principalId: "U1", directoryScopeId: "/" },
            { principalId: "u2", directoryScopeId: "/" },
            { principalId: "u1", directoryScopeId: "/administrativeUnits/a" },
        ];
        // An activation covers its own role assignment as well; a schedule without a scope is tenant-wide
        const active = [{ principalId: "u1", directoryScopeId: "/", assignmentType: "Activated" }, { principalId: "u3" }];
        expect(getUnscheduledRoleAssignments({ permanent, active })).toEqual([permanent[1], permanent[2]]);
        expect(getUnscheduledRoleAssignments({ permanent: [{ principalId: "u3", directoryScopeId: "/" }], active })).toEqual([]);
    });
});
