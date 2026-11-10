import { describe, expect, it } from "vitest";
import { filterNeedsDetails } from "@/utils/detailsFilter";
import { EASY_TO_MISS_FILTERS } from "@/utils/dashboardStats";
import type { DashboardFilter } from "@/types/dashboardFilter.types";

describe("filterNeedsDetails", () => {
    it.each(Object.entries(EASY_TO_MISS_FILTERS))("is true for the Easy to miss filter %s in the basic view", (_id, filter) => {
        expect(filterNeedsDetails(filter as DashboardFilter, "basic")).toBe(true);
    });

    it("is false for a card filter in the basic view", () => {
        expect(filterNeedsDetails({ assignment: "permanent" }, "basic")).toBe(false);
    });

    it("is false for an empty filter in both views", () => {
        expect(filterNeedsDetails({}, "basic")).toBe(false);
        expect(filterNeedsDetails({}, "advanced")).toBe(false);
    });

    it("is true for a custom extension filter in the advanced view", () => {
        expect(filterNeedsDetails({ customExtension: "x" }, "advanced")).toBe(true);
    });

    it("is false for a filter without a hidden block in the advanced view", () => {
        expect(filterNeedsDetails({ noEndDate: true }, "advanced")).toBe(false);
    });
});
