import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { ICON_DATA } from "@/components/icons/iconData";

const ICON_DIR = join(process.cwd(), "docs/Assets/next-gen/icons");
const files = readdirSync(ICON_DIR).filter((f) => f.endsWith(".svg")).map((f) => f.slice(0, -4));

describe("icon data", () => {
    it("has data for every SVG in the icon set and nothing else", () => {
        expect(Object.keys(ICON_DATA).sort()).toEqual([...files].sort());
        expect(files).toHaveLength(87);
    });

    it("gives every icon at least one element", () => {
        for (const [name, elements] of Object.entries(ICON_DATA)) {
            expect(elements.length, name).toBeGreaterThan(0);
        }
    });

    it("keeps accent styles on the CSS variables of the icon set", () => {
        for (const [name, elements] of Object.entries(ICON_DATA)) {
            for (const [, attrs] of elements) {
                const style = (attrs as Record<string, unknown>).style;
                if (style && typeof style === "object") {
                    for (const value of Object.values(style)) {
                        expect(value, name).toMatch(/^var\(--pim-icon-(accent|warn), #[0-9a-f]{6}\)$/);
                    }
                }
            }
        }
    });
});
