import { describe, expect, it } from "vitest";
import { isAzureTagShown, isTagShown, type RowTagKind } from "@/utils/calmTags";

const ALL_KINDS: RowTagKind[] = [
    "type",
    "relationMember",
    "relationOwner",
    "direct",
    "viaGroup",
    "scopeTenantWide",
    "scopeOther",
    "originHere",
    "originInherited",
    "alwaysOn",
    "expires",
    "permanent",
    "noEndDate",
    "activated",
    "assigned",
    "emergency",
    "eligible",
    "active",
];

describe("isTagShown", () => {
    it("shows every kind when details are on", () => {
        for (const kind of ALL_KINDS) {
            expect(isTagShown(kind, true)).toBe(true);
        }
    });

    it("shows what deviates from the usual when details are off", () => {
        for (const kind of ["relationOwner", "viaGroup", "scopeOther", "originInherited", "alwaysOn", "permanent", "emergency"] as const) {
            expect(isTagShown(kind, false)).toBe(true);
        }
    });

    it("hides the usual tags when details are off", () => {
        for (const kind of ["type", "relationMember", "direct", "scopeTenantWide", "originHere", "expires", "noEndDate", "activated", "assigned"] as const) {
            expect(isTagShown(kind, false)).toBe(false);
        }
    });

    it("hides Eligible and Active when details are off and no option is given", () => {
        expect(isTagShown("eligible", false)).toBe(false);
        expect(isTagShown("active", false)).toBe(false);
    });

    it("keeps Eligible and Active when details are off and keepAssignmentState is set", () => {
        expect(isTagShown("eligible", false, { keepAssignmentState: true })).toBe(true);
        expect(isTagShown("active", false, { keepAssignmentState: true })).toBe(true);
    });
});

describe("isAzureTagShown", () => {
    it("hides the assignment type when details are off", () => {
        for (const term of ["user", "guest", "group", "foreignGroup", "app", "managedIdentity", "agent", null]) {
            expect(isAzureTagShown(term, false)).toBe(false);
        }
    });

    it("always shows Deleted, it is a warning", () => {
        expect(isAzureTagShown("deleted", false)).toBe(true);
    });

    it("shows Permanent and Emergency access when details are off", () => {
        expect(isAzureTagShown("permanent", false)).toBe(true);
        expect(isAzureTagShown("emergency", false)).toBe(true);
    });

    it("hides Expires, No end date, Activated and Assigned when details are off", () => {
        for (const term of ["expires", "noEndDate", "activated", "assigned"]) {
            expect(isAzureTagShown(term, false)).toBe(false);
        }
    });

    it("hides Eligible and Active when details are off, unless keepAssignmentState is set", () => {
        expect(isAzureTagShown("eligible", false)).toBe(false);
        expect(isAzureTagShown("active", false)).toBe(false);
        expect(isAzureTagShown("eligible", false, { keepAssignmentState: true })).toBe(true);
        expect(isAzureTagShown("active", false, { keepAssignmentState: true })).toBe(true);
    });

    it("shows every Azure tag when details are on", () => {
        const terms = ["user", "guest", "group", "foreignGroup", "app", "managedIdentity", "agent", null, "deleted", "permanent", "emergency", "expires", "noEndDate", "activated", "assigned", "eligible", "active"];
        for (const term of terms) {
            expect(isAzureTagShown(term, true)).toBe(true);
        }
    });
});
