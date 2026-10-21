"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useMsal } from "@azure/msal-react";
import {
    addEmergencyAccount,
    mergeImportedAccounts,
    parseStoredAccounts,
    readRawEmergencyAccounts,
    removeEmergencyAccount,
    saveEmergencyAccounts,
    type EmergencyAccount,
    type EmergencyChange,
} from "@/utils/emergencyAccounts";

/**
 * One shared store for every component that shows or edits emergency access accounts: a single window listener for
 * the whole page (a report has thousands of principal rows), the stored string as the snapshot, parsed once per value.
 */
const CHANGE_EVENT = "pim-emergency-accounts-change";
const subscribers = new Set<() => void>();
let listening = false;

function notifyAll() {
    subscribers.forEach((notify) => notify());
}

function subscribe(onChange: () => void) {
    subscribers.add(onChange);
    if (!listening && typeof window !== "undefined") {
        window.addEventListener(CHANGE_EVENT, notifyAll);
        window.addEventListener("storage", notifyAll);
        listening = true;
    }
    return () => {
        subscribers.delete(onChange);
        if (subscribers.size === 0 && listening) {
            window.removeEventListener(CHANGE_EVENT, notifyAll);
            window.removeEventListener("storage", notifyAll);
            listening = false;
        }
    };
}

interface Parsed {
    accounts: EmergencyAccount[];
    ids: ReadonlySet<string>;
}

const EMPTY: Parsed = { accounts: [], ids: new Set<string>() };
const parseCache = new Map<string, { raw: string; parsed: Parsed }>();

function parseOnce(tenantId: string, raw: string): Parsed {
    if (!raw) return EMPTY;
    const cached = parseCache.get(tenantId);
    if (cached && cached.raw === raw) return cached.parsed;
    const accounts = parseStoredAccounts(raw);
    const parsed = { accounts, ids: new Set(accounts.map((a) => a.id)) };
    parseCache.set(tenantId, { raw, parsed });
    return parsed;
}

function announceChange() {
    if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * Emergency access accounts of the signed-in tenant. `ids` is a stable set of lowercase ids for the same snapshot;
 * the actions return `{ ok: false, reason }` when the browser refuses the write.
 */
export function useEmergencyAccounts() {
    const { accounts: msalAccounts } = useMsal();
    const tenantId = msalAccounts[0]?.tenantId ?? "";

    const getSnapshot = useCallback(() => (tenantId ? readRawEmergencyAccounts(tenantId) ?? "" : ""), [tenantId]);
    const raw = useSyncExternalStore(subscribe, getSnapshot, () => "");
    const parsed = useMemo(() => parseOnce(tenantId, raw), [tenantId, raw]);

    const add = useCallback(
        (account: EmergencyAccount): EmergencyChange => {
            const result = tenantId ? addEmergencyAccount(tenantId, account) : ({ ok: false, reason: "Sign in first." } as const);
            if (result.ok) announceChange();
            return result;
        },
        [tenantId],
    );

    const remove = useCallback(
        (principalId: string): EmergencyChange => {
            const result = tenantId ? removeEmergencyAccount(tenantId, principalId) : ({ ok: false, reason: "Sign in first." } as const);
            if (result.ok) announceChange();
            return result;
        },
        [tenantId],
    );

    /** Adds imported accounts to the list (never replaces it); counts what was new. */
    const merge = useCallback(
        (imported: EmergencyAccount[]): { ok: true; added: number; alreadyMarked: number } | { ok: false; reason: string } => {
            if (!tenantId) return { ok: false, reason: "Sign in first." };
            const merged = mergeImportedAccounts(parseOnce(tenantId, readRawEmergencyAccounts(tenantId) ?? "").accounts, imported);
            if (!saveEmergencyAccounts(tenantId, merged.accounts)) return { ok: false, reason: "Could not save in this browser." };
            announceChange();
            return { ok: true, added: merged.added, alreadyMarked: merged.alreadyMarked };
        },
        [tenantId],
    );

    return { tenantId, accounts: parsed.accounts, ids: parsed.ids, add, remove, merge };
}
