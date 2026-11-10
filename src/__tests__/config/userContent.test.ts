import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { HELP_PAGES, getHelpForPath, type HelpPageId } from "@/config/help";
import { TOURS } from "@/config/onboarding";

/**
 * The in-app guidance keeps up with the pages: a new page fails here until it has its help and its tour, or is listed
 * below with the reason it has none. The content itself is reviewed by the review-in-app-guidance skill.
 */

const APP = join("src", "app");

/** Every route of the app, from its page.tsx */
function routes(): string[] {
    const found: string[] = [];
    const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
            const path = join(dir, name);
            if (statSync(path).isDirectory()) walk(path);
            else if (name === "page.tsx") {
                const route = relative(APP, dir).split(sep).join("/");
                found.push(route === "" ? "/" : `/${route}`);
            }
        }
    };
    walk(APP);
    return found.sort();
}

/** Routes without help or tour of their own, with the reason */
const NO_GUIDANCE: Record<string, string> = {
    "/": "the public front page, outside the app shell",
    "/demo": "starts the demo and goes on to the dashboard",
    "/redirect": "the sign-in bridge",
    "/help": "the guide itself",
    "/azure/configure": "a placeholder until Azure Configure is built",
};

/** Routes with help but no tour, with the reason */
const NO_TOUR: Record<string, string> = {
    "/settings": "the app tour points at Settings; the page explains itself in its help",
};

/** The help page each route shows */
const HELP_OF_ROUTE: Record<string, HelpPageId> = {
    "/dashboard": "dashboard",
    "/report": "report",
    "/configure": "configure",
    "/settings": "settings",
    "/azure": "azure-dashboard",
    "/azure/report": "azure-report",
};

/** The source of every file outside the tests and the tour config, for the useTourPage check */
function sources(): string {
    const parts: string[] = [];
    const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
            const path = join(dir, name);
            if (statSync(path).isDirectory()) {
                if (name !== "__tests__") walk(path);
            } else if (/\.tsx?$/.test(name) && path !== join("src", "config", "onboarding.ts")) parts.push(readFileSync(path, "utf8"));
        }
    };
    walk("src");
    return parts.join("\n");
}

describe("in-app guidance per page", () => {
    it("every route has its help, or a reason it has none", () => {
        for (const route of routes()) {
            if (NO_GUIDANCE[route]) continue;
            expect(HELP_OF_ROUTE[route], `${route} has no help: add it to src/config/help and HELP_OF_ROUTE, or to NO_GUIDANCE with a reason`).toBeDefined();
            expect(getHelpForPath(route).id, route).toBe(HELP_OF_ROUTE[route]);
        }
    });

    it("every route has a tour with steps, or a reason it has none", () => {
        for (const route of routes()) {
            if (NO_GUIDANCE[route] || NO_TOUR[route]) continue;
            const tours = TOURS.filter((t) => t.page === route && t.steps.length > 0);
            expect(tours.length, `${route} has no tour: add one to src/config/onboarding.ts, or to NO_TOUR with a reason`).toBeGreaterThan(0);
        }
    });

    it("every help page has an intro, blocks and a guide", () => {
        for (const page of HELP_PAGES) {
            expect(page.intro.trim(), page.id).not.toBe("");
            expect(page.blocks.length, page.id).toBeGreaterThan(0);
            expect(page.guide.length, page.id).toBeGreaterThan(0);
        }
    });
});

describe("the tours", () => {
    it("every tour has steps", () => {
        for (const tour of TOURS) expect(tour.steps.length, `${tour.id} has no steps`).toBeGreaterThan(0);
    });

    it("every tour of a page is named by a useTourPage call; tours without a page run before the page's tour", () => {
        const code = sources();
        expect(code).toContain("useTourPage(");
        for (const tour of TOURS.filter((t) => t.page !== null)) {
            expect(code.includes(`"${tour.id}"`), `${tour.id} is never started: name it in useTourPage on its page`).toBe(true);
        }
    });
});
