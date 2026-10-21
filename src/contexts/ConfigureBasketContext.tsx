"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Change } from "@/types/configure.types";
import {
    EMPTY_BASKET,
    addChanges,
    clearTargets,
    leaveOut,
    readStoredBasket,
    rebase,
    writeStoredBasket,
    type Basket,
} from "@/utils/configureBasket";
import type { SettingField, SettingValue, Target } from "@/types/configure.types";

/**
 * The basket of the Configure page (spec 10.1): one store, kept in sessionStorage per tenant so a reload or a consent
 * popup does not lose it. Two contexts: the basket (re-renders on every change) and the actions (stable, never
 * re-render their consumers).
 */

export interface ConfigureBasketActions {
    add: (changes: Change | readonly Change[]) => void;
    leaveOut: (changeIds: readonly string[]) => void;
    clearTargets: (targets: readonly Target[]) => void;
    discard: () => void;
    /** Replaces the whole basket (Undo builds one from a snapshot); the caller asks first when the basket is not empty */
    replace: (basket: Basket) => void;
    /** After a new read: `from` becomes the value read now, changes that now match the tenant go */
    rebase: (readNow: (target: Target, field: SettingField) => SettingValue | undefined) => void;
}

interface BasketState {
    basket: Basket;
    /** False when the browser refused to store it: the basket lives in memory only */
    isStored: boolean;
    /** False until the stored basket of this tenant has been read after mount */
    isReady: boolean;
}

interface InternalState extends BasketState {
    /** The tenant the basket in this state belongs to */
    tenantId: string;
}

const BasketContext = createContext<BasketState | undefined>(undefined);
const BasketActionsContext = createContext<ConfigureBasketActions | undefined>(undefined);

function sessionStore(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | null {
    try {
        return typeof sessionStorage === "undefined" ? null : sessionStorage;
    } catch {
        return null;
    }
}

export interface ConfigureBasketProviderProps {
    /** The tenant the basket belongs to; empty while nobody is signed in */
    tenantId: string;
    /** For fixtures: the basket to start with when nothing is stored yet (a reload keeps what was stored) */
    initialBasket?: Basket;
    /** For fixtures: the storage to use (default sessionStorage) */
    storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
    children: ReactNode;
}

export function ConfigureBasketProvider({ tenantId, initialBasket, storage, children }: ConfigureBasketProviderProps) {
    const [state, setState] = useState<InternalState>({ basket: EMPTY_BASKET, isStored: true, isReady: false, tenantId: "" });
    const storageRef = useRef(storage);
    const initialRef = useRef(initialBasket);
    // The tenant of the latest render, for the action guard below (set in an effect, never read during render)
    const tenantRef = useRef(tenantId);
    useEffect(() => { tenantRef.current = tenantId; }, [tenantId]);

    // Read the stored basket after hydration (never during render), and again when the tenant changes. Until it is read
    // the basket is not ready and actions do nothing, so nothing lands in another tenant's basket.
    useEffect(() => {
        if (!tenantId) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- nobody signed in: no basket to read or keep
            setState({ basket: EMPTY_BASKET, isStored: true, isReady: false, tenantId });
            return;
        }
        const store = storageRef.current === undefined ? sessionStore() : storageRef.current;
        const stored = readStoredBasket(store, tenantId);
        const basket = stored.changes.length === 0 && initialRef.current ? addChanges(EMPTY_BASKET, initialRef.current.changes) : stored;
        setState({ basket, isStored: true, isReady: true, tenantId });
    }, [tenantId]);

    // Store after every change, outside the state updater (updaters stay pure), under the tenant the basket belongs to
    const { basket, isReady, tenantId: basketTenant } = state;
    useEffect(() => {
        if (!isReady || !basketTenant) return;
        const stored = writeStoredBasket(storageRef.current === undefined ? sessionStore() : storageRef.current, basketTenant, basket);
        // eslint-disable-next-line react-hooks/set-state-in-effect -- reflects whether the browser kept the basket (bails out when unchanged)
        setState((s) => (s.isStored === stored ? s : { ...s, isStored: stored }));
    }, [basket, isReady, basketTenant]);

    const update = useCallback((fn: (b: Basket) => Basket) => {
        setState((s) => {
            // Ignored until the basket of the current tenant has been read
            if (!s.isReady || s.tenantId !== tenantRef.current) return s;
            const next = fn(s.basket);
            return next === s.basket ? s : { ...s, basket: next };
        });
    }, []);

    const actions = useMemo<ConfigureBasketActions>(() => ({
        add: (changes) => update((b) => addChanges(b, Array.isArray(changes) ? changes : [changes as Change])),
        leaveOut: (ids) => update((b) => leaveOut(b, ids)),
        clearTargets: (targets) => update((b) => clearTargets(b, targets)),
        discard: () => update((b) => (b.changes.length === 0 ? b : EMPTY_BASKET)),
        // Through the reducers, so a basket built elsewhere (Undo) follows the same rules
        replace: (next) => update(() => addChanges(EMPTY_BASKET, next.changes)),
        rebase: (readNow) => update((b) => rebase(b, readNow)),
    }), [update]);

    const value = useMemo<BasketState>(() => ({ basket: state.basket, isStored: state.isStored, isReady: state.isReady }), [state.basket, state.isStored, state.isReady]);

    return (
        <BasketActionsContext.Provider value={actions}>
            <BasketContext.Provider value={value}>{children}</BasketContext.Provider>
        </BasketActionsContext.Provider>
    );
}

export function useConfigureBasket(): BasketState {
    const value = useContext(BasketContext);
    if (value === undefined) throw new Error("useConfigureBasket must be used within a ConfigureBasketProvider");
    return value;
}

export function useConfigureBasketActions(): ConfigureBasketActions {
    const value = useContext(BasketActionsContext);
    if (value === undefined) throw new Error("useConfigureBasketActions must be used within a ConfigureBasketProvider");
    return value;
}
