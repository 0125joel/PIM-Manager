import { describe, expect, it } from "vitest";
import { REPORT_HELP_TERM_KEYS, REPORT_TERMS, type ReportTermKey } from "@/config/help/reportTerms";
import { REPORT_HELP } from "@/config/help/report";
import { OPEN_HELP_EVENT, requestOpenHelp } from "@/utils/helpEvents";

describe("report terms", () => {
    it("every term has a label and a text, and no text uses an EM dash", () => {
        for (const [key, term] of Object.entries(REPORT_TERMS)) {
            expect(term.label, key).not.toBe("");
            expect(term.text.length, key).toBeGreaterThan(10);
            expect(`${term.label}${term.text}`, key).not.toContain(String.fromCharCode(0x2014));
        }
    });

    it("the help lists the terms of spec 8 with the same strings as the tag tips", () => {
        const labels = ["Direct", "Via group", "Tenant-wide", "Administrative unit", "Permanent", "No end date", "Activated", "Assigned", "Always on", "Outside PIM", "Emergency access", "Preview", "Agent identity", "Agent's user account", "Agent identity blueprint principal"];
        expect(REPORT_HELP.terms.map((t) => t.term)).toEqual(labels);
        for (const key of REPORT_HELP_TERM_KEYS as readonly ReportTermKey[]) {
            expect(REPORT_HELP.terms.find((t) => t.term === REPORT_TERMS[key].label)?.text).toBe(REPORT_TERMS[key].text);
        }
    });

    it("the help has the six blocks", () => {
        expect(REPORT_HELP.blocks.map((b) => b.title)).toEqual(["Head", "Roles and groups", "Filters", "Detail", "Configuration", "Export"]);
    });
});

describe("requestOpenHelp", () => {
    it("dispatches a window event with the term", () => {
        const received: unknown[] = [];
        const listener = (event: Event) => received.push((event as CustomEvent).detail);
        const target = new EventTarget();
        const previous = (globalThis as { window?: unknown }).window;
        (globalThis as { window?: unknown }).window = Object.assign(target, { dispatchEvent: target.dispatchEvent.bind(target) });
        target.addEventListener(OPEN_HELP_EVENT, listener);
        requestOpenHelp({ term: "Preview" });
        (globalThis as { window?: unknown }).window = previous;
        expect(received).toEqual([{ term: "Preview" }]);
    });
});
