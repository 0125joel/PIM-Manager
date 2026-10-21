import { describe, expect, it } from "vitest";
import { buildConfigureSearch, enterMode, parseConfigureUrlState } from "@/utils/configureUrlState";

describe("configureUrlState (spec 2)", () => {
    it("round-trips every parameter of Edit and Guided, defaults not written", () => {
        const edit = "mode=edit&view=groups&group=g1&access=owner&tab=who&select=several";
        expect(buildConfigureSearch(parseConfigureUrlState(edit))).toBe(edit);
        expect(buildConfigureSearch(parseConfigureUrlState("mode=edit&role=r1&tab=assignment&step=review"))).toBe("mode=edit&step=review&role=r1&tab=assignment");
        expect(buildConfigureSearch(parseConfigureUrlState("mode=guided&gstep=3"))).toBe("mode=guided&gstep=3");
        // Defaults are not written: roles view, member access, no select
        expect(buildConfigureSearch(parseConfigureUrlState("mode=edit&view=roles&access=member&select=no"))).toBe("mode=edit");
        // Select several keeps the side of the groups without a group open (NG-65); without either the side is dropped
        expect(buildConfigureSearch(parseConfigureUrlState("mode=edit&view=groups&access=owner&select=several"))).toBe("mode=edit&view=groups&access=owner&select=several");
        expect(buildConfigureSearch(parseConfigureUrlState("mode=edit&view=groups&access=owner"))).toBe("mode=edit&view=groups");
    });

    it("drops what does not belong to the mode and keeps parameters that are not the page's own", () => {
        const guided = parseConfigureUrlState("mode=guided&tab=who&role=r1&gstep=9");
        expect(guided.mode).toBe("guided");
        expect([guided.tab, guided.roleId, guided.gstep]).toEqual([undefined, undefined, undefined]);
        expect(parseConfigureUrlState("mode=model&step=review").step).toBeNull();
        expect(parseConfigureUrlState("mode=nonsense&tab=who")).toEqual({ mode: null, step: null, view: "roles", access: "member", select: false });
        // A group in the roles view, or a role in the groups view, is not a selection
        const edit = parseConfigureUrlState("mode=edit&group=g1");
        expect([edit.view, edit.groupId]).toEqual(["roles", undefined]);
        expect(buildConfigureSearch(parseConfigureUrlState("mode=import"), "classic=1&mode=edit&tab=who")).toBe("classic=1&mode=import");
        expect(buildConfigureSearch(enterMode(null), "mode=edit&role=r1&screen=start")).toBe("screen=start");
    });
});

describe("Back to Configure from a result (bug 15, C3-04)", () => {
    it("leaves the mode and its step: the start page, not the result again", () => {
        const result = parseConfigureUrlState("mode=edit&step=result&role=role-ga&tab=who");
        expect(result.step).toBe("result");
        expect(buildConfigureSearch(enterMode(null), "mode=edit&step=result&role=role-ga&tab=who")).toBe("");
    });
});
