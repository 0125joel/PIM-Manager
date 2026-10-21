import { describe, it, expect } from "vitest";
import { USER_ID_CHUNK_SIZE, applyUserTypes, buildUserIdFilter, chunkArray, collectKnownUserTypes, collectUserCandidateIds, isGuestUserType } from "@/utils/userTypeUtils";

describe("chunkArray", () => {
    it("splits into chunks of at most 15 ids per request", () => {
        const ids = Array.from({ length: 31 }, (_, i) => `id${i}`);
        const chunks = chunkArray(ids, USER_ID_CHUNK_SIZE);
        expect(USER_ID_CHUNK_SIZE).toBe(15);
        expect(chunks.map((c) => c.length)).toEqual([15, 15, 1]);
        expect(chunks.flat()).toEqual(ids);
    });
    it("returns no chunks for an empty list and one chunk for an exact multiple", () => {
        expect(chunkArray([], 15)).toEqual([]);
        expect(chunkArray(Array.from({ length: 15 }, (_, i) => i), 15)).toHaveLength(1);
    });
    it("rejects a chunk size below 1", () => {
        expect(() => chunkArray([1], 0)).toThrow();
    });
});

describe("buildUserIdFilter", () => {
    it("quotes and joins the ids", () => {
        expect(buildUserIdFilter(["a", "b"])).toBe("id in ('a','b')");
    });
    it("escapes single quotes", () => {
        expect(buildUserIdFilter(["o'brien"])).toBe("id in ('o''brien')");
    });
});

describe("collectUserCandidateIds", () => {
    it("deduplicates across lists and keeps ids without an expanded principal", () => {
        const ids = collectUserCandidateIds([
            [{ principalId: "u1", principal: { "@odata.type": "#microsoft.graph.user" } }, { principalId: "u2" }],
            [{ principalId: "u1" }, { principalId: "u3", principal: undefined }],
        ]);
        expect(ids).toEqual(["u1", "u2", "u3"]);
    });
    it("leaves out groups, service principals and agent identities but includes agent user accounts", () => {
        const ids = collectUserCandidateIds([
            [
                { principalId: "g", principal: { "@odata.type": "#microsoft.graph.group" } },
                { principalId: "s", principal: { "@odata.type": "#microsoft.graph.servicePrincipal" } },
                { principalId: "ai", principal: { "@odata.type": "#microsoft.graph.agentIdentity" } },
                { principalId: "base-ai", principal: { "@odata.type": "#microsoft.graph.servicePrincipal", servicePrincipalType: "ServiceIdentity" } },
                { principalId: "bp", principal: { "@odata.type": "#microsoft.graph.agentIdentityBlueprintPrincipal" } },
                { principalId: "au", principal: { "@odata.type": "#microsoft.graph.agentUser" } },
                { principalId: "u", principal: { "@odata.type": "#microsoft.graph.user" } },
            ],
        ]);
        expect(ids).toEqual(["au", "u"]);
    });
});

describe("applyUserTypes", () => {
    it("sets principalUserType on matching items only, without mutating the input", () => {
        const input = [{ principalId: "u1" }, { principalId: "g1" }];
        const out = applyUserTypes(input, new Map([["u1", "Guest"]]));
        expect(out[0]).toEqual({ principalId: "u1", principalUserType: "Guest" });
        expect(out[1]).toBe(input[1]);
        expect(input[0]).toEqual({ principalId: "u1" });
    });
});

describe("collectKnownUserTypes", () => {
    it("collects the types read earlier from every assignment list", () => {
        const known = collectKnownUserTypes([
            { assignments: { permanent: [{ principalId: "a", principalUserType: "Member" }], eligible: [{ principalId: "b", principalUserType: "Guest" }], active: [{ principalId: "c" }] } },
            { assignments: { permanent: [], eligible: [], active: [{ principalId: "d", principalUserType: "Member" }] } },
        ]);
        expect(Object.fromEntries(known)).toEqual({ a: "Member", b: "Guest", d: "Member" });
    });
});

describe("isGuestUserType", () => {
    it("matches Guest case-insensitively", () => {
        expect(isGuestUserType("Guest")).toBe(true);
        expect(isGuestUserType("guest")).toBe(true);
        expect(isGuestUserType("Member")).toBe(false);
        expect(isGuestUserType(undefined)).toBe(false);
    });
});
