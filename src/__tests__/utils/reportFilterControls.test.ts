import { describe, expect, it } from "vitest";
import { getFilterControls, groupControls, readControlValue, writeControlValue } from "@/utils/reportFilterControls";
import { FILTER_KEY_VIEW, type DashboardFilter } from "@/types/dashboardFilter.types";
import { parseDashboardFilter, serializeDashboardFilter } from "@/utils/dashboardFilter";

describe("filter controls", () => {
    for (const view of ["roles", "groups"] as const) {
        const controls = getFilterControls(view);

        it(`${view}: every control belongs to the view and its non-neutral options round-trip through the URL`, () => {
            for (const control of controls) {
                expect(["both", view]).toContain(FILTER_KEY_VIEW[control.key]);
                for (const option of control.options.filter((o) => o.value !== control.neutral)) {
                    const filter = writeControlValue(control, {}, option.value);
                    expect(filter[control.key], `${control.key}=${option.value}`).toBeDefined();
                    expect(parseDashboardFilter(serializeDashboardFilter(filter)), `${control.key}=${option.value}`).toEqual(filter);
                    expect(readControlValue(control, filter)).toBe(option.value);
                }
            }
        });

        it(`${view}: the neutral value clears exactly its key and leaves the others alone`, () => {
            for (const control of controls) {
                const other: DashboardFilter = { principalType: "user" };
                const set = writeControlValue(control, other, control.options.find((o) => o.value !== control.neutral)?.value ?? control.neutral);
                const cleared = writeControlValue(control, set, control.neutral);
                expect(cleared[control.key]).toBeUndefined();
                if (control.key !== "principalType") expect(cleared.principalType).toBe("user");
            }
        });

        it(`${view}: has one control per key`, () => {
            const keys = controls.map((c) => c.key);
            expect(new Set(keys).size).toBe(keys.length);
        });
    }

    it("roles and groups views have the three groups of the render", () => {
        expect(groupControls(getFilterControls("roles")).map((g) => g.group)).toEqual(["Role properties", "Assignments", "PIM configuration"]);
        expect(groupControls(getFilterControls("groups")).map((g) => g.group)).toEqual(["Group properties", "Assignments", "PIM configuration"]);
    });

    it("lists the controls in the order of the renders, with the label of each view", () => {
        const labels = (view: "roles" | "groups") => groupControls(getFilterControls(view)).map((g) => g.controls.map((c) => c.label));
        expect(labels("groups")).toEqual([
            ["PIM", "Entra roles", "Gives a privileged role"],
            ["Member or owner", "Direct or via a group", "No end date", "State", "Who", "Emergency access"],
            ["Applies to", "On activation, require", "Approval", "Max activation duration", "Justification", "Custom extension", "Activation notification"],
        ]);
        expect(labels("roles")).toEqual([
            ["Privileged", "Built-in or custom", "Role"],
            ["Has assignments", "State", "Who", "Direct or via group", "No end date", "Emergency access"],
            ["On activation, require", "Approval", "Justification", "Max activation duration", "Custom extension", "Activation notification"],
        ]);
    });

    it("keeps keys of the other view when a control writes", () => {
        const roles = getFilterControls("roles");
        const mfa = roles.find((c) => c.key === "mfa")!;
        expect(writeControlValue(mfa, { groupPim: "outside" }, "neither")).toEqual({ groupPim: "outside", mfa: "neither" });
    });

    it("Emergency access: Include is the neutral value, Exclude sets the key", () => {
        const emergency = getFilterControls("roles").find((c) => c.key === "excludeEmergency")!;
        expect(writeControlValue(emergency, {}, "exclude")).toEqual({ excludeEmergency: true });
        expect(readControlValue(emergency, { excludeEmergency: true })).toBe("exclude");
        expect(readControlValue(emergency, {})).toBe("include");
    });

    it("the Groups view offers no Apps and Applies to defaults to Member without writing it", () => {
        const groups = getFilterControls("groups");
        expect(groups.find((c) => c.key === "principalType")!.options.map((o) => o.value)).not.toContain("servicePrincipal");
        const applies = groups.find((c) => c.key === "appliesTo")!;
        expect(readControlValue(applies, {})).toBe("member");
        expect(writeControlValue(applies, { appliesTo: "owner" }, "member")).toEqual({});
    });

    it("offers Agents after Apps in roles and before Groups in both views", () => {
        const roleOptions = getFilterControls("roles").find((c) => c.key === "principalType")!.options;
        const groupOptions = getFilterControls("groups").find((c) => c.key === "principalType")!.options;
        expect(roleOptions.map((option) => option.value)).toEqual(["all", "user", "guest", "servicePrincipal", "agent", "group"]);
        expect(groupOptions.map((option) => option.value)).toEqual(["all", "user", "guest", "agent", "group"]);
        expect(roleOptions.find((option) => option.value === "agent")?.label).toBe("Agents");
        expect(groupOptions.find((option) => option.value === "agent")?.label).toBe("Agents");
    });

    it("Privileged offers Privileged only and All; customRole maps Built-in to false", () => {
        const roles = getFilterControls("roles");
        expect(writeControlValue(roles.find((c) => c.key === "privileged")!, {}, "true")).toEqual({ privileged: true });
        expect(writeControlValue(roles.find((c) => c.key === "customRole")!, {}, "false")).toEqual({ customRole: false });
        expect(readControlValue(roles.find((c) => c.key === "customRole")!, { customRole: false })).toBe("false");
    });
});
