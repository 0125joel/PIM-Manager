import { describe, expect, it } from "vitest";
import { myGroupPaths } from "@/utils/myGroupPaths";
import type { MyGroupInstance } from "@/utils/writeAccess";

const member = (groupId: string, endDateTime: string | null = null): MyGroupInstance => ({ groupId, accessId: "member", endDateTime });

describe("myGroupPaths", () => {
    it("leaves out an owner eligibility", () => {
        expect(myGroupPaths([{ groupId: "g1", accessId: "owner", endDateTime: null }], [], new Map())).toEqual([]);
    });

    it("leaves out a group whose membership is active now", () => {
        expect(myGroupPaths([member("g1"), member("g2")], [member("G1")], new Map())).toEqual([
            { groupId: "g2", groupName: "g2", endText: "Permanent", isPermanent: true },
        ]);
    });

    it("keeps an eligible group when only the ownership is active", () => {
        expect(myGroupPaths([member("g1")], [{ groupId: "g1", accessId: "owner", endDateTime: null }], new Map())).toHaveLength(1);
    });

    it("gives one entry per group with the later end", () => {
        const result = myGroupPaths([member("g1", "2026-11-20T00:00:00Z"), member("g1", "2026-12-20T00:00:00Z"), member("g1", "2026-11-25T00:00:00Z")], [], new Map());
        expect(result).toHaveLength(1);
        expect(result[0].isPermanent).toBe(false);
        expect(result[0].endText).toBe(myGroupPaths([member("g1", "2026-12-20T00:00:00Z")], [], new Map())[0].endText);
    });

    it("lets a permanent eligibility win, in either order", () => {
        expect(myGroupPaths([member("g1", "2026-11-20T00:00:00Z"), member("g1", null)], [], new Map())[0].isPermanent).toBe(true);
        expect(myGroupPaths([member("g1", null), member("g1", "2026-11-20T00:00:00Z")], [], new Map())[0]).toMatchObject({ isPermanent: true, endText: "Permanent" });
    });

    it("takes the name from the look-up and falls back to the id", () => {
        const result = myGroupPaths([member("g1"), member("g2")], [], new Map([["g1", "Network Operators"]]));
        expect(result.map((r) => r.groupName)).toEqual(["g2", "Network Operators"]);
    });

    it("sorts by name", () => {
        const names = new Map([["g1", "Zeta"], ["g2", "Alpha"], ["g3", "Mid"]]);
        expect(myGroupPaths([member("g1"), member("g2"), member("g3")], [], names).map((r) => r.groupName)).toEqual(["Alpha", "Mid", "Zeta"]);
    });
});
