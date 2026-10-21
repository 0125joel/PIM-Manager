import { describe, it, expect } from "vitest";
import {
    addEmergencyAccount,
    emergencyStorageKey,
    getEmergencyAccounts,
    isEmergencyAccount,
    mergeImportedAccounts,
    parseEmergencyAccountsImport,
    parseStoredAccounts,
    removeEmergencyAccount,
    saveEmergencyAccounts,
    serializeEmergencyAccounts,
    type EmergencyAccount,
    type StorageLike,
} from "@/utils/emergencyAccounts";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

const acc = (id: string, name = "Break Glass", upn = "bg@contoso.com"): EmergencyAccount => ({ id, displayName: name, userPrincipalName: upn });

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
    const data = { ...initial };
    return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => void (data[k] = v) };
}

const throwingStorage: StorageLike = {
    getItem: () => {
        throw new Error("blocked");
    },
    setItem: () => {
        throw new Error("quota");
    },
};

describe("store round trip", () => {
    it("uses the documented key and JSON shape", () => {
        const storage = memoryStorage();
        expect(saveEmergencyAccounts("t1", [acc(A)], storage)).toBe(true);
        expect(emergencyStorageKey("t1")).toBe("pim-emergency-accounts:t1");
        expect(JSON.parse(storage.data["pim-emergency-accounts:t1"])).toEqual({ version: 1, accounts: [acc(A)] });
        expect(getEmergencyAccounts("t1", storage)).toEqual([acc(A)]);
    });

    it("adds without duplicates and removes by id, in any letter case", () => {
        const storage = memoryStorage();
        addEmergencyAccount("t1", acc(A), storage);
        const again = addEmergencyAccount("t1", acc(A.toUpperCase(), "Renamed"), storage);
        expect(again.ok && again.accounts).toEqual([acc(A, "Renamed")]);
        const removed = removeEmergencyAccount("t1", A.toUpperCase(), storage);
        expect(removed.ok && removed.accounts).toEqual([]);
    });

    it("keeps two tenants apart", () => {
        const storage = memoryStorage();
        addEmergencyAccount("t1", acc(A), storage);
        addEmergencyAccount("t2", acc(B), storage);
        expect(getEmergencyAccounts("t1", storage).map((a) => a.id)).toEqual([A]);
        expect(getEmergencyAccounts("t2", storage).map((a) => a.id)).toEqual([B]);
        expect(isEmergencyAccount("t1", B, storage)).toBe(false);
        expect(isEmergencyAccount("t1", A.toUpperCase(), storage)).toBe(true);
    });

    it("rejects an account without a GUID id", () => {
        expect(addEmergencyAccount("t1", acc("not-a-guid"), memoryStorage()).ok).toBe(false);
    });
});

describe("bad data and failing storage", () => {
    it("reads bad JSON, a wrong version or a wrong shape as an empty list", () => {
        expect(parseStoredAccounts("{nope")).toEqual([]);
        expect(parseStoredAccounts(JSON.stringify({ version: 2, accounts: [acc(A)] }))).toEqual([]);
        expect(parseStoredAccounts(JSON.stringify({ version: 1, accounts: "x" }))).toEqual([]);
        expect(parseStoredAccounts(null)).toEqual([]);
    });

    it("survives storage that throws on read and on write", () => {
        expect(getEmergencyAccounts("t1", throwingStorage)).toEqual([]);
        expect(isEmergencyAccount("t1", A, throwingStorage)).toBe(false);
        expect(saveEmergencyAccounts("t1", [acc(A)], throwingStorage)).toBe(false);
        const added = addEmergencyAccount("t1", acc(A), throwingStorage);
        expect(added).toEqual({ ok: false, reason: "Could not save in this browser." });
        expect(removeEmergencyAccount("t1", A, throwingStorage).ok).toBe(false);
    });

    it("has no storage at all", () => {
        expect(getEmergencyAccounts("t1", null)).toEqual([]);
        expect(saveEmergencyAccounts("t1", [acc(A)], null)).toBe(false);
    });
});

describe("import", () => {
    const file = (accounts: unknown[], version: unknown = 1) => JSON.stringify({ version, accounts });

    it("reads an exported list", () => {
        const result = parseEmergencyAccountsImport(serializeEmergencyAccounts([acc(A), acc(B)]));
        expect(result).toEqual({ ok: true, accounts: [acc(A), acc(B)], skipped: 0 });
    });

    it("skips entries without a usable id, ignores extra fields and handles a BOM", () => {
        const result = parseEmergencyAccountsImport("﻿" + file([{ ...acc(A), extra: 1 }, { displayName: "no id" }, "text", null, acc("bad")]));
        expect(result).toEqual({ ok: true, accounts: [acc(A)], skipped: 4 });
    });

    it("collapses duplicate ids that differ in case", () => {
        const result = parseEmergencyAccountsImport(file([acc(A, "One"), acc(A.toUpperCase(), "Two")]));
        expect(result.ok && result.accounts).toEqual([acc(A, "Two")]);
    });

    it("rejects bad JSON, a wrong version, a missing list, too many entries and a huge file", () => {
        expect(parseEmergencyAccountsImport("nope").ok).toBe(false);
        expect(parseEmergencyAccountsImport(file([], 2)).ok).toBe(false);
        expect(parseEmergencyAccountsImport(JSON.stringify({ version: 1 })).ok).toBe(false);
        expect(parseEmergencyAccountsImport("null").ok).toBe(false);
        expect(parseEmergencyAccountsImport(file(Array.from({ length: 501 }, () => acc(A)))).ok).toBe(false);
        expect(parseEmergencyAccountsImport(" ".repeat(300 * 1024)).ok).toBe(false);
    });

    it("caps long strings", () => {
        const result = parseEmergencyAccountsImport(file([acc(A, "x".repeat(1000))]));
        expect(result.ok && result.accounts[0].displayName).toHaveLength(256);
    });

    it("merges by id, counting added and already marked, imported names winning", () => {
        const merged = mergeImportedAccounts([acc(A, "Old")], [acc(A, "New"), acc(B)]);
        expect(merged).toEqual({ accounts: [acc(A, "New"), acc(B)], added: 1, alreadyMarked: 1 });
    });
});
