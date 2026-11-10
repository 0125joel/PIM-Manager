import { describe, expect, it } from "vitest";
import {
    DETAILS_PAGES,
    clearPageDetails,
    detailsPageKey,
    parseDetailsPreference,
    readDetailsPreference,
    readPageDetails,
    resolveDetails,
    writeDetailsPreference,
    writePageDetails,
} from "@/utils/detailsPreference";

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

describe("parseDetailsPreference", () => {
    it("accepts fewer and more", () => {
        expect(parseDetailsPreference("fewer")).toBe("fewer");
        expect(parseDetailsPreference("more")).toBe("more");
    });

    it("rejects other values, null and undefined", () => {
        expect(parseDetailsPreference("less")).toBeNull();
        expect(parseDetailsPreference(null)).toBeNull();
        expect(parseDetailsPreference(undefined)).toBeNull();
    });
});

describe("readDetailsPreference", () => {
    it("reads fewer on empty storage", () => {
        expect(readDetailsPreference(fakeStorage())).toBe("fewer");
    });

    it("reads fewer with null storage and with throwing storage", () => {
        expect(readDetailsPreference(null)).toBe("fewer");
        expect(readDetailsPreference(throwingStorage())).toBe("fewer");
    });
});

describe("writeDetailsPreference", () => {
    it("returns true, stores the setting and reads it back", () => {
        const storage = fakeStorage();
        expect(writeDetailsPreference("more", storage)).toBe(true);
        expect(storage.map.get("details-preference")).toBe("more");
        expect(readDetailsPreference(storage)).toBe("more");
    });

    it("clears the page choices and keeps the setting", () => {
        const storage = fakeStorage();
        writePageDetails("entra-report", true, storage);
        writePageDetails("azure-dashboard-basic", true, storage);
        writeDetailsPreference("fewer", storage);
        const keys = [...storage.map.keys()].filter((key) => key.startsWith("details-"));
        expect(keys).toEqual(["details-preference"]);
    });

    it("returns false and does not throw with throwing storage", () => {
        expect(writeDetailsPreference("more", throwingStorage())).toBe(false);
    });
});

describe("detailsPageKey and DETAILS_PAGES", () => {
    it("has six pages and prefixes each key with details-", () => {
        expect(DETAILS_PAGES).toHaveLength(6);
        for (const page of DETAILS_PAGES) {
            expect(detailsPageKey(page)).toBe("details-" + page);
        }
    });
});

describe("readPageDetails", () => {
    it("is false when missing, true after writing true, false after writing false", () => {
        const storage = fakeStorage();
        expect(readPageDetails("entra-report", storage)).toBe(false);
        writePageDetails("entra-report", true, storage);
        expect(readPageDetails("entra-report", storage)).toBe(true);
        writePageDetails("entra-report", false, storage);
        expect(readPageDetails("entra-report", storage)).toBe(false);
    });

    it("is false when the stored value is not 1", () => {
        const storage = fakeStorage();
        storage.setItem("details-entra-report", "yes");
        expect(readPageDetails("entra-report", storage)).toBe(false);
    });

    it("is false with throwing storage", () => {
        expect(readPageDetails("entra-report", throwingStorage())).toBe(false);
    });
});

describe("writePageDetails", () => {
    it("stores 1 and 0", () => {
        const storage = fakeStorage();
        writePageDetails("azure-report", true, storage);
        expect(storage.map.get("details-azure-report")).toBe("1");
        writePageDetails("azure-report", false, storage);
        expect(storage.map.get("details-azure-report")).toBe("0");
    });

    it("returns false with null storage", () => {
        expect(writePageDetails("azure-report", true, null)).toBe(false);
    });
});

describe("clearPageDetails", () => {
    it("removes the six page keys and keeps the setting and unrelated keys", () => {
        const storage = fakeStorage();
        writeDetailsPreference("more", storage);
        for (const page of DETAILS_PAGES) writePageDetails(page, true, storage);
        storage.setItem("dashboard-view-mode", "advanced");
        clearPageDetails(storage);
        for (const page of DETAILS_PAGES) {
            expect(storage.map.has(detailsPageKey(page))).toBe(false);
        }
        expect(storage.map.get("details-preference")).toBe("more");
        expect(storage.map.get("dashboard-view-mode")).toBe("advanced");
    });
});

describe("resolveDetails", () => {
    it("shows everything without a checkbox with more", () => {
        expect(resolveDetails("more", false)).toEqual({ isDetailed: true, canToggle: false });
        expect(resolveDetails("more", true)).toEqual({ isDetailed: true, canToggle: false });
    });

    it("follows the page choice with fewer", () => {
        expect(resolveDetails("fewer", true)).toEqual({ isDetailed: true, canToggle: true });
        expect(resolveDetails("fewer", false)).toEqual({ isDetailed: false, canToggle: true });
    });
});
