import { describe, expect, it } from "vitest";
import { splitEmphasis } from "@/utils/emphasis";

describe("splitEmphasis", () => {
    it("sets names of the UI in bold and values in italic", () => {
        expect(splitEmphasis("Watch _Permanent_, then click *Refresh*")).toEqual([
            { text: "Watch ", emphasis: null },
            { text: "Permanent", emphasis: "italic" },
            { text: ", then click ", emphasis: null },
            { text: "Refresh", emphasis: "bold" },
        ]);
    });

    it("keeps a text without marks whole", () => {
        expect(splitEmphasis("Every row is a filter")).toEqual([{ text: "Every row is a filter", emphasis: null }]);
    });

    it("keeps a mark without a partner", () => {
        expect(splitEmphasis("5 * 2 is 10")).toEqual([{ text: "5 * 2 is 10", emphasis: null }]);
        expect(splitEmphasis("snake_case")).toEqual([{ text: "snake_case", emphasis: null }]);
    });

    it("handles a mark at the start and at the end", () => {
        expect(splitEmphasis("*Advanced* goes deeper than _Basic_").map((p) => p.emphasis)).toEqual(["bold", null, "italic"]);
    });
});
