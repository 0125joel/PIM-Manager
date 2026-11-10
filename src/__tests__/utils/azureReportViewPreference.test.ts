import { describe, expect, it } from "vitest";
import { AZURE_REPORT_VIEW_STORAGE_KEY, parseAzureReportView, readAzureReportView, writeAzureReportView } from "@/utils/azureReportViewPreference";

function fakeStorage() {
    const map = new Map<string, string>();
    return {
        map,
        getItem: (key: string) => map.get(key) ?? null,
        setItem: (key: string, value: string) => {
            map.set(key, value);
        },
    };
}

describe("parseAzureReportView", () => {
    it("accepts roles and assignments", () => {
        expect(parseAzureReportView("roles")).toBe("roles");
        expect(parseAzureReportView("assignments")).toBe("assignments");
    });

    it("rejects other values, null and undefined", () => {
        expect(parseAzureReportView("table")).toBeNull();
        expect(parseAzureReportView(null)).toBeNull();
        expect(parseAzureReportView(undefined)).toBeNull();
    });
});

describe("readAzureReportView and writeAzureReportView", () => {
    it("reads roles when nothing is stored", () => {
        expect(readAzureReportView(fakeStorage())).toBe("roles");
    });

    it("returns true on write and reads back the written view under the storage key", () => {
        const storage = fakeStorage();
        expect(writeAzureReportView("assignments", storage)).toBe(true);
        expect(readAzureReportView(storage)).toBe("assignments");
        expect(storage.map.get("azure-report-view")).toBe("assignments");
        expect(AZURE_REPORT_VIEW_STORAGE_KEY).toBe("azure-report-view");
    });

    it("reads roles when getItem throws", () => {
        const storage = {
            getItem: () => {
                throw new Error("storage blocked");
            },
            setItem: () => undefined,
        };
        expect(readAzureReportView(storage)).toBe("roles");
    });

    it("returns false when there is no storage", () => {
        expect(writeAzureReportView("roles", null)).toBe(false);
    });

    it("returns false when setItem throws", () => {
        const storage = {
            getItem: () => null,
            setItem: () => {
                throw new Error("quota exceeded");
            },
        };
        expect(writeAzureReportView("assignments", storage)).toBe(false);
    });
});
