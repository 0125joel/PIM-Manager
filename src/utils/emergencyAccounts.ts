/**
 * Emergency access ("break glass") accounts, marked per tenant in this browser (spec 3.6 and 5.7).
 * Stored in localStorage under `pim-emergency-accounts:{tenantId}` as `{ version: 1, accounts: [...] }`.
 * Marked accounts are labelled everywhere and counted apart, never left out. Every storage access is guarded and
 * takes an optional storage so the logic runs without a browser.
 */

export interface EmergencyAccount {
    id: string;
    displayName: string;
    userPrincipalName: string;
}

export const EMERGENCY_STORAGE_PREFIX = "pim-emergency-accounts:";

const MAX_IMPORT_CHARS = 256 * 1024;
const MAX_ACCOUNTS = 500;
const MAX_FIELD_LENGTH = 256;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function emergencyStorageKey(tenantId: string): string {
    return `${EMERGENCY_STORAGE_PREFIX}${tenantId}`;
}

function defaultStorage(): StorageLike | null {
    try {
        return typeof localStorage === "undefined" ? null : localStorage;
    } catch {
        return null;
    }
}

function clean(value: unknown): string {
    return typeof value === "string" ? value.trim().slice(0, MAX_FIELD_LENGTH) : "";
}

/** One entry of a stored or imported list; null when it has no GUID-shaped id. Ids are kept lowercase. */
function toAccount(entry: unknown): EmergencyAccount | null {
    if (!entry || typeof entry !== "object") return null;
    const candidate = entry as Record<string, unknown>;
    const id = clean(candidate.id).toLowerCase();
    if (!GUID.test(id)) return null;
    const userPrincipalName = clean(candidate.userPrincipalName);
    return { id, displayName: clean(candidate.displayName) || userPrincipalName || id, userPrincipalName };
}

function dedupe(accounts: EmergencyAccount[]): EmergencyAccount[] {
    const byId = new Map<string, EmergencyAccount>();
    for (const account of accounts) byId.set(account.id, account);
    return Array.from(byId.values());
}

/** The raw stored string to accounts; anything unreadable is an empty list. */
export function parseStoredAccounts(raw: string | null | undefined): EmergencyAccount[] {
    if (!raw) return [];
    try {
        const data = JSON.parse(raw) as { version?: unknown; accounts?: unknown };
        if (data?.version !== 1 || !Array.isArray(data.accounts)) return [];
        return dedupe(data.accounts.map(toAccount).filter((a): a is EmergencyAccount => a !== null));
    } catch {
        return [];
    }
}

export function serializeEmergencyAccounts(accounts: EmergencyAccount[]): string {
    return JSON.stringify({ version: 1, accounts }, null, 2);
}

export function readRawEmergencyAccounts(tenantId: string, storage: StorageLike | null = defaultStorage()): string | null {
    if (!storage) return null;
    try {
        return storage.getItem(emergencyStorageKey(tenantId));
    } catch {
        return null;
    }
}

export function getEmergencyAccounts(tenantId: string, storage: StorageLike | null = defaultStorage()): EmergencyAccount[] {
    return parseStoredAccounts(readRawEmergencyAccounts(tenantId, storage));
}

/** False when the browser refuses the write (private mode, quota): the caller shows "Could not save in this browser". */
export function saveEmergencyAccounts(tenantId: string, accounts: EmergencyAccount[], storage: StorageLike | null = defaultStorage()): boolean {
    if (!storage) return false;
    try {
        storage.setItem(emergencyStorageKey(tenantId), serializeEmergencyAccounts(dedupe(accounts)));
        return true;
    } catch {
        return false;
    }
}

export function isEmergencyAccount(tenantId: string, principalId: string, storage: StorageLike | null = defaultStorage()): boolean {
    const id = principalId.toLowerCase();
    return getEmergencyAccounts(tenantId, storage).some((a) => a.id === id);
}

export type EmergencyChange = { ok: true; accounts: EmergencyAccount[] } | { ok: false; reason: string };

export function addEmergencyAccount(tenantId: string, account: EmergencyAccount, storage: StorageLike | null = defaultStorage()): EmergencyChange {
    const normalised = toAccount(account);
    if (!normalised) return { ok: false, reason: "That account has no valid id." };
    const next = dedupe([...getEmergencyAccounts(tenantId, storage), normalised]);
    return saveEmergencyAccounts(tenantId, next, storage) ? { ok: true, accounts: next } : { ok: false, reason: "Could not save in this browser." };
}

export function removeEmergencyAccount(tenantId: string, principalId: string, storage: StorageLike | null = defaultStorage()): EmergencyChange {
    const id = principalId.toLowerCase();
    const next = getEmergencyAccounts(tenantId, storage).filter((a) => a.id !== id);
    return saveEmergencyAccounts(tenantId, next, storage) ? { ok: true, accounts: next } : { ok: false, reason: "Could not save in this browser." };
}

export type EmergencyImport = { ok: true; accounts: EmergencyAccount[]; skipped: number } | { ok: false; reason: string };

/** Reads an exported list: version 1, GUID ids, size and count limits. Entries that are not usable are counted as skipped. */
export function parseEmergencyAccountsImport(text: string): EmergencyImport {
    if (text.length > MAX_IMPORT_CHARS) return { ok: false, reason: "That file is too large for an emergency account list." };
    let data: { version?: unknown; accounts?: unknown };
    try {
        data = JSON.parse(text.replace(/^﻿/, ""));
    } catch {
        return { ok: false, reason: "That file is not valid JSON." };
    }
    if (!data || typeof data !== "object") return { ok: false, reason: "That file does not hold an emergency account list." };
    if (data.version !== 1) return { ok: false, reason: "That file has an unknown version. Only version 1 can be imported." };
    if (!Array.isArray(data.accounts)) return { ok: false, reason: "That file has no list of accounts." };
    if (data.accounts.length > MAX_ACCOUNTS) return { ok: false, reason: `That file lists more than ${MAX_ACCOUNTS} accounts.` };

    const accounts: EmergencyAccount[] = [];
    let skipped = 0;
    for (const entry of data.accounts) {
        const account = toAccount(entry);
        if (account) accounts.push(account);
        else skipped++;
    }
    return { ok: true, accounts: dedupe(accounts), skipped };
}

/** Merges an import into the current list by id; imported names win. Never replaces. */
export function mergeImportedAccounts(existing: EmergencyAccount[], imported: EmergencyAccount[]): { accounts: EmergencyAccount[]; added: number; alreadyMarked: number } {
    const known = new Set(existing.map((a) => a.id));
    const added = imported.filter((a) => !known.has(a.id)).length;
    return { accounts: dedupe([...existing, ...imported]), added, alreadyMarked: imported.length - added };
}
