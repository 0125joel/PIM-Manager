import { describe, expect, it } from "vitest";
import type { TourDefinition, TourId, TourStep } from "@/config/onboarding";
import {
    buildRun,
    initTourProgress,
    markToursSeen,
    nextShownStep,
    parseSeenTours,
    planAllRun,
    planAutoRun,
    readDemoTourAnswer,
    readSeenTours,
    readTourSetting,
    shownPosition,
    tourSections,
    toursToMarkSeen,
    writeDemoTourAnswer,
    writeTourSetting,
} from "@/utils/tourProgress";

function fakeStorage() {
    const map = new Map<string, string>();
    return {
        map,
        getItem: (key: string) => map.get(key) ?? null,
        setItem: (key: string, value: string) => {
            map.set(key, value);
        },
        removeItem: (key: string) => map.delete(key),
    };
}

function throwingStorage() {
    return {
        getItem: () => {
            throw new Error("blocked");
        },
        setItem: () => {
            throw new Error("blocked");
        },
        removeItem: () => {
            throw new Error("blocked");
        },
    };
}

const s = (id: string): TourStep => ({ id, target: id, title: id, description: id, icon: "shield", guides: [] });

const tours: TourDefinition[] = [
    { id: "app", product: "app", section: "The app", label: "The app", page: null, steps: [s("welcome")] },
    { id: "entra-dashboard-basic", product: "entra", section: "Dashboard", label: "Basic", page: "/dashboard", view: "basic", steps: [s("cards"), s("export")] },
    { id: "entra-dashboard-advanced", product: "entra", section: "Dashboard", label: "Advanced", page: "/dashboard", view: "advanced", steps: [] },
    { id: "entra-report", product: "entra", section: "Report", label: "Report", page: "/report", steps: [s("filters")] },
    { id: "entra-configure-edit", product: "entra", section: "Configure", label: "Edit", page: "/configure", onlyInPlace: true, steps: [s("list")] },
    { id: "azure-scope", product: "azure", section: "Scopes", label: "Scopes", page: null, steps: [s("bar")] },
    { id: "azure-dashboard-basic", product: "azure", section: "Dashboard", label: "Basic", page: "/azure", view: "basic", steps: [s("cards")] },
    { id: "azure-report", product: "azure", section: "Report", label: "Report", page: "/azure/report", steps: [] },
];

describe("parseSeenTours", () => {
    it("keeps the tour ids of a list", () => {
        expect(parseSeenTours('["app","entra-report"]')).toEqual(["app", "entra-report"]);
    });

    it("drops entries that are not tour ids", () => {
        expect(parseSeenTours('["app", 3, "Bad Id", "x-y"]')).toEqual(["app", "x-y"]);
    });

    it("gives an empty list for an object, bad JSON, null and undefined", () => {
        expect(parseSeenTours("{}")).toEqual([]);
        expect(parseSeenTours("not json")).toEqual([]);
        expect(parseSeenTours(null)).toEqual([]);
        expect(parseSeenTours(undefined)).toEqual([]);
    });
});

describe("readSeenTours", () => {
    it("is empty on empty storage, on null storage and with throwing storage", () => {
        expect(readSeenTours(fakeStorage()).size).toBe(0);
        expect(readSeenTours(null).size).toBe(0);
        expect(readSeenTours(throwingStorage()).size).toBe(0);
    });
});

describe("markToursSeen", () => {
    it("adds the ids to the seen set without duplicates", () => {
        const storage = fakeStorage();
        markToursSeen(["app"], storage);
        markToursSeen(["entra-report", "app"], storage);
        expect([...readSeenTours(storage)].sort()).toEqual(["app", "entra-report"]);
    });

    it("returns false with throwing storage", () => {
        expect(markToursSeen(["app"], throwingStorage())).toBe(false);
    });
});

describe("readTourSetting and writeTourSetting", () => {
    it("is on when missing, when the value is unknown, and with throwing storage", () => {
        expect(readTourSetting(fakeStorage())).toBe("on");
        const storage = fakeStorage();
        storage.setItem("tours-setting", "maybe");
        expect(readTourSetting(storage)).toBe("on");
        expect(readTourSetting(throwingStorage())).toBe("on");
    });

    it("is off after writing off", () => {
        const storage = fakeStorage();
        writeTourSetting("off", storage);
        expect(readTourSetting(storage)).toBe("off");
    });
});

describe("readDemoTourAnswer and writeDemoTourAnswer", () => {
    it("is null when missing and for an unknown value", () => {
        const storage = fakeStorage();
        expect(readDemoTourAnswer("entra", storage)).toBeNull();
        storage.setItem("tours-demo-entra", "maybe");
        expect(readDemoTourAnswer("entra", storage)).toBeNull();
    });

    it("is no after writing no for one product, and the other product stays null", () => {
        const storage = fakeStorage();
        writeDemoTourAnswer("entra", "no", storage);
        expect(readDemoTourAnswer("entra", storage)).toBe("no");
        expect(readDemoTourAnswer("azure", storage)).toBeNull();
    });
});

describe("initTourProgress", () => {
    it("for a new reader, marks nothing seen and removes the 3.0 key", () => {
        const storage = fakeStorage();
        storage.setItem("pim_highlights_seen_version", "3.0");
        initTourProgress(storage);
        expect(storage.map.get("tours-seen")).toBe("[]");
        expect(storage.map.has("pim_highlights_seen_version")).toBe(false);
    });

    it("for a reader who used the app before, also marks nothing seen: the zero point", () => {
        const storage = fakeStorage();
        storage.setItem("dashboard-view-mode", "basic");
        storage.setItem("pim_onboarding_completed", "true");
        storage.setItem("tours-setting", "off");
        initTourProgress(storage);
        expect([...readSeenTours(storage)]).toEqual([]);
        expect(storage.map.has("pim_onboarding_completed")).toBe(false);
        expect(storage.map.get("dashboard-view-mode")).toBe("basic");
        expect(storage.map.get("tours-setting")).toBe("off");
    });

    it("runs once: with tours-seen already set nothing changes", () => {
        const storage = fakeStorage();
        storage.setItem("tours-seen", '["app"]');
        storage.setItem("pim_onboarding_completed", "true");
        initTourProgress(storage);
        expect(storage.map.get("tours-seen")).toBe('["app"]');
        expect(storage.map.get("pim_onboarding_completed")).toBe("true");
    });

    it("does not throw with throwing storage or null storage", () => {
        expect(() => initTourProgress(throwingStorage())).not.toThrow();
        expect(() => initTourProgress(null)).not.toThrow();
    });
});

describe("planAutoRun", () => {
    it("starts the app tour and the page tour on Entra when nothing is seen", () => {
        expect(planAutoRun({ pageTour: "entra-dashboard-basic", tours, seen: new Set(), setting: "on" })).toEqual(["app", "entra-dashboard-basic"]);
    });

    it("starts a tour that starts only in place by itself, when its page opens", () => {
        expect(planAutoRun({ pageTour: "entra-configure-edit", tours, seen: new Set(["app"]), setting: "on" })).toEqual(["entra-configure-edit"]);
    });

    it("leaves out a seen tour", () => {
        expect(planAutoRun({ pageTour: "entra-dashboard-basic", tours, seen: new Set(["app"]), setting: "on" })).toEqual(["entra-dashboard-basic"]);
    });

    it("starts nothing with the setting off", () => {
        expect(planAutoRun({ pageTour: "entra-dashboard-basic", tours, seen: new Set(), setting: "off" })).toEqual([]);
    });

    it("skips a page tour without steps, and runs only the app tour", () => {
        expect(planAutoRun({ pageTour: "entra-dashboard-advanced", tours, seen: new Set(), setting: "on" })).toEqual(["app"]);
        expect(planAutoRun({ pageTour: "entra-dashboard-advanced", tours, seen: new Set(["app"]), setting: "on" })).toEqual([]);
    });

    it("runs the scope tour before the page tour on Azure", () => {
        expect(planAutoRun({ pageTour: "azure-dashboard-basic", tours, seen: new Set(), setting: "on" })).toEqual(["app", "azure-scope", "azure-dashboard-basic"]);
        expect(planAutoRun({ pageTour: "azure-report", tours, seen: new Set(["app"]), setting: "on" })).toEqual(["azure-scope"]);
    });

    it("starts nothing for the app tour or an unknown tour", () => {
        expect(planAutoRun({ pageTour: "app", tours, seen: new Set(), setting: "on" })).toEqual([]);
        expect(planAutoRun({ pageTour: "entra-configure", tours, seen: new Set(), setting: "on" })).toEqual([]);
    });
});

describe("planAllRun", () => {
    it("runs every Entra tour with steps, without the app tour", () => {
        expect(planAllRun("entra", tours)).toEqual(["entra-dashboard-basic", "entra-report"]);
    });

    it("runs every Azure tour with steps, without the app tour", () => {
        expect(planAllRun("azure", tours)).toEqual(["azure-scope", "azure-dashboard-basic"]);
    });
});

describe("tourSections", () => {
    it("groups the Entra tours with steps per page, without the Advanced tour", () => {
        const sections = tourSections("entra", tours);
        expect(sections.map((x) => x.section)).toEqual(["Dashboard", "Report"]);
        expect(sections.map((x) => x.tours.map((t) => t.id))).toEqual([["entra-dashboard-basic"], ["entra-report"]]);
    });

    it("has the Scopes and Dashboard sections for Azure, and the app tour in neither", () => {
        const sections = tourSections("azure", tours);
        expect(sections.map((x) => x.section)).toEqual(["Scopes", "Dashboard"]);
        expect(sections.flatMap((x) => x.tours.map((t) => t.id))).not.toContain("app");
    });
});

describe("buildRun", () => {
    it("gives the steps with key, page and view; the app step has no view", () => {
        const run = buildRun(["app", "entra-dashboard-basic"], tours, "/help");
        expect(run.map((step) => step.key)).toEqual(["app:welcome", "entra-dashboard-basic:cards", "entra-dashboard-basic:export"]);
        expect(run.every((step) => step.page === "/dashboard")).toBe(true);
        expect(run[1].view).toBe("basic");
        expect(run[2].view).toBe("basic");
        expect(run[0].view).toBeUndefined();
    });

    it("runs a tour without a route on the current path when no later tour has one, and leaves out unknown ids", () => {
        const run = buildRun(["app", "azure-scope", "not-a-tour" as TourId], tours, "/azure/report");
        expect(run).toHaveLength(2);
        expect(run.every((step) => step.page === "/azure/report")).toBe(true);
    });
});

describe("nextShownStep", () => {
    it("skips steps that were not found", () => {
        expect(nextShownStep(0, 1, new Set([1]), 4)).toBe(2);
        expect(nextShownStep(2, -1, new Set([1]), 4)).toBe(0);
    });

    it("returns null past either end", () => {
        expect(nextShownStep(3, 1, new Set(), 4)).toBeNull();
        expect(nextShownStep(0, -1, new Set(), 4)).toBeNull();
        expect(nextShownStep(0, 1, new Set([1, 2, 3]), 4)).toBeNull();
    });
});

describe("shownPosition", () => {
    it("counts only the steps that are shown", () => {
        expect(shownPosition(2, new Set([1]), 4)).toEqual({ position: 2, total: 3 });
        expect(shownPosition(0, new Set(), 3)).toEqual({ position: 1, total: 3 });
    });
});

describe("toursToMarkSeen", () => {
    const run = buildRun(["app", "entra-dashboard-basic"], tours, "/help");

    it("marks every tour of the run on a stop", () => {
        expect(toursToMarkSeen(run, new Set(), "stop")).toEqual(["app", "entra-dashboard-basic"]);
    });

    it("marks only the tours that showed a step on complete", () => {
        expect(toursToMarkSeen(run, new Set(["entra-dashboard-basic:export"]), "complete")).toEqual(["entra-dashboard-basic"]);
    });
});
