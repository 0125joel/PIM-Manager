import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONFIGURE_BLOCK_TITLES, CONFIGURE_HELP } from "@/config/help/configure";
import { CONFIGURE_HELP_TERM_KEYS, CONFIGURE_TERMS } from "@/config/help/configureTerms";
import { getHelpForPath } from "@/config/help";
import { HIGHLIGHT_STEPS, ONBOARDING_STEPS } from "@/config/onboarding";
import { WHATS_NEW } from "@/config/whatsNew";
import { NAV_ITEMS } from "@/utils/shellNavigation";
import { SCHEDULED_NOTE } from "@/utils/assignmentForm";
import { NOT_UNDER_PIM_LINE } from "@/utils/configureTargets";
import { keepSetNote } from "@/utils/settingValues";

const EM_DASH = String.fromCharCode(0x2014);
const EMOJI = /\p{Extended_Pictographic}/u;

/** Every string of the Configure help, the tour steps of Configure and the What's new entries */
function allTexts(): string[] {
    const help = CONFIGURE_HELP;
    return [
        help.title, help.intro,
        ...help.blocks.flatMap((b) => [b.title, b.text]),
        ...help.terms.flatMap((t) => [t.term, t.text]),
        ...help.guide.flatMap((g) => [g.title, ...(g.paragraphs ?? []), ...(g.items ?? []).flatMap((i) => [i.label, i.text])]),
        ...[...ONBOARDING_STEPS, ...HIGHLIGHT_STEPS].flatMap((s) => [s.title, s.description, ...s.guides.map((x) => x.text)]),
        ...WHATS_NEW.flatMap((w) => [w.title, w.text]),
    ];
}

describe("the Configure terms", () => {
    it("every term has a label and a text", () => {
        for (const [key, term] of Object.entries(CONFIGURE_TERMS)) {
            expect(term.label, key).not.toBe("");
            expect(term.text.length, key).toBeGreaterThan(10);
        }
    });

    it("the help lists the terms in the order of the list, with the strings of the map", () => {
        expect(CONFIGURE_HELP.terms.map((t) => t.term)).toEqual(CONFIGURE_HELP_TERM_KEYS.map((k) => CONFIGURE_TERMS[k].label));
        for (const key of CONFIGURE_HELP_TERM_KEYS) expect(CONFIGURE_HELP.terms.find((t) => t.term === CONFIGURE_TERMS[key].label)?.text).toBe(CONFIGURE_TERMS[key].text);
        expect(new Set(CONFIGURE_HELP_TERM_KEYS).size).toBe(Object.keys(CONFIGURE_TERMS).length);
    });

    it("the terms say what the screens say", () => {
        expect(CONFIGURE_TERMS.scheduled.text).toBe(SCHEDULED_NOTE);
        expect(CONFIGURE_TERMS.comesUnderPim.text.startsWith(NOT_UNDER_PIM_LINE)).toBe(true);
        expect(keepSetNote("roles")).toContain('"Keep"');
        expect(CONFIGURE_TERMS.keep.label).toBe("Keep");
        expect(CONFIGURE_TERMS.setTo.label).toBe("Set to");
        expect(CONFIGURE_TERMS.undo.label).toBe("Undo this apply");
    });
});

describe("the Configure help", () => {
    it("has the seven blocks of spec 18, and a guide section with the same title for each", () => {
        expect(CONFIGURE_HELP.blocks.map((b) => b.title)).toEqual([...CONFIGURE_BLOCK_TITLES]);
        expect(CONFIGURE_HELP.guide.map((g) => g.title)).toEqual([...CONFIGURE_BLOCK_TITLES]);
        expect(getHelpForPath("/configure")?.blocks).toHaveLength(7);
    });

    it("has no EM dash and no emoji anywhere, tour and What's new included", () => {
        for (const text of allTexts()) {
            expect(text).not.toContain(EM_DASH);
            expect(EMOJI.test(text), text).toBe(false);
        }
    });

    it("no longer speaks of the Wizard, Manual mode or Bulk mode", () => {
        for (const text of allTexts()) expect(text, text).not.toMatch(/\bWizard\b|Manual mode|\bBulk mode\b|\bManual:/);
    });
});

/** The `data-tour` ids of the sources: written out, or the `tourId` of the navigation items */
function tourIdsInSources(): Set<string> {
    const ids = new Set<string>(NAV_ITEMS.map((n) => n.tourId));
    const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
            const path = join(dir, name);
            if (statSync(path).isDirectory()) walk(path);
            else if (/\.tsx$/.test(name)) for (const m of readFileSync(path, "utf8").matchAll(/data-tour="([a-z-]+)"/g)) ids.add(m[1]);
        }
    };
    walk("src");
    return ids;
}

describe("the tour", () => {
    it("every step points at a data-tour id that exists", () => {
        const ids = tourIdsInSources();
        for (const step of [...ONBOARDING_STEPS, ...HIGHLIGHT_STEPS]) expect(ids.has(step.target), `${step.id}: ${step.target}`).toBe(true);
    });
    it("the Configure steps point at the navigation link, which is always there", () => {
        for (const step of [...ONBOARDING_STEPS, ...HIGHLIGHT_STEPS].filter((s) => s.page === "/configure")) expect(step.target).toBe("nav-configure");
    });
});
