import { describe, expect, it } from "vitest";
import { buildTips } from "@/utils/tipRules";
import { GENERAL_TIPS } from "@/config/tips";

const none = { permanentOutsideEmergency: 0, privilegedWithoutMfa: 0, privilegedWithoutJustification: 0, groupsOutsidePim: 0, nobodyNotified: 0 };

describe("buildTips", () => {
    it("puts tenant tips first in the order of the spec, with the numbers filled in", () => {
        const tips = buildTips({ permanentOutsideEmergency: 15, privilegedWithoutMfa: 7, privilegedWithoutJustification: 2, groupsOutsidePim: 3, nobodyNotified: 6 });
        expect(tips.slice(0, 5).map((t) => t.id)).toEqual(["permanent", "mfa", "justification", "groups", "notified"]);
        expect(tips[1].title).toBe("7 privileged roles activate without MFA");
        expect(tips[1].action).toMatchObject({ kind: "filter", label: "Show these 7 roles", filter: { mfa: "neither" } });
        expect(tips.slice(5).every((t) => t.source === "general")).toBe(true);
        expect(tips).toHaveLength(5 + GENERAL_TIPS.length);
    });

    it("leaves out tips for 0 and for unknown numbers", () => {
        expect(buildTips(none).every((t) => t.source === "general")).toBe(true);
        const partial = buildTips({ ...none, privilegedWithoutMfa: null, groupsOutsidePim: 1 });
        expect(partial.filter((t) => t.source === "tenant").map((t) => t.id)).toEqual(["groups"]);
        expect(partial[0].title).toBe("1 role-assignable group is outside PIM");
    });

    it("uses singular wording for one role", () => {
        const [tip] = buildTips({ ...none, privilegedWithoutJustification: 1 });
        expect(tip.title).toBe("1 privileged role does not ask for a justification");
        expect(tip.action).toMatchObject({ label: "Show this role" });
    });
});
