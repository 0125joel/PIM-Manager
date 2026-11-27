import { describe, expect, it } from "vitest";
import { auditBannerKey, readAuditBannerDismissed, writeAuditBannerDismissed } from "@/utils/auditBannerPreference";

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return {
        data,
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => void data.set(key, value),
    };
}

const throwing: Pick<Storage, "getItem" | "setItem"> = {
    getItem: () => {
        throw new Error("blocked");
    },
    setItem: () => {
        throw new Error("blocked");
    },
};

describe("the dismissed banner of the Audit page", () => {
    it("is not dismissed until it is written", () => {
        const storage = memoryStorage();
        expect(readAuditBannerDismissed("tenant-a", storage)).toBe(false);
        expect(writeAuditBannerDismissed("tenant-a", storage)).toBe(true);
        expect(readAuditBannerDismissed("tenant-a", storage)).toBe(true);
    });

    it("is kept per tenant", () => {
        const storage = memoryStorage();
        writeAuditBannerDismissed("tenant-a", storage);
        expect(readAuditBannerDismissed("tenant-b", storage)).toBe(false);
    });

    it("stores only the boolean", () => {
        const storage = memoryStorage();
        writeAuditBannerDismissed("tenant-a", storage);
        expect([...storage.data.entries()]).toEqual([[auditBannerKey("tenant-a"), "1"]]);
    });

    it("reads only 1 as dismissed", () => {
        const storage = memoryStorage();
        storage.setItem(auditBannerKey("tenant-a"), "true");
        expect(readAuditBannerDismissed("tenant-a", storage)).toBe(false);
    });

    it("does nothing without a tenant", () => {
        const storage = memoryStorage();
        expect(writeAuditBannerDismissed(undefined, storage)).toBe(false);
        expect(writeAuditBannerDismissed("", storage)).toBe(false);
        expect(storage.data.size).toBe(0);
        expect(readAuditBannerDismissed(null, storage)).toBe(false);
    });

    it("survives localStorage that throws when it is read, without a storage argument", () => {
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
        Object.defineProperty(globalThis, "localStorage", {
            configurable: true,
            get: () => {
                throw new Error("blocked");
            },
        });
        try {
            expect(readAuditBannerDismissed("tenant-a")).toBe(false);
            expect(writeAuditBannerDismissed("tenant-a")).toBe(false);
        } finally {
            if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
            else delete (globalThis as { localStorage?: unknown }).localStorage;
        }
    });

    it("survives blocked or missing storage", () => {
        expect(readAuditBannerDismissed("tenant-a", throwing)).toBe(false);
        expect(writeAuditBannerDismissed("tenant-a", throwing)).toBe(false);
        expect(readAuditBannerDismissed("tenant-a", null)).toBe(false);
        expect(writeAuditBannerDismissed("tenant-a", null)).toBe(false);
    });
});
