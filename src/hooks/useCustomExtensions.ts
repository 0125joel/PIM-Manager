"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useMsal } from "@azure/msal-react";
import { Client } from "@microsoft/microsoft-graph-client";
import { InteractionRequiredAuthError } from "@azure/msal-browser";
import { CUSTOM_EXTENSION_SCOPES } from "@/config/constants";
import { fetchCustomExtensions, isCustomExtensionPermissionError, PimCustomExtension } from "@/services/customExtensionService";
import { Logger } from "@/utils/logger";
import type { CustomExtensionStatus } from "@/utils/permissionStatus";

const CACHE_KEY = "pim-custom-extensions";
const CACHE_TTL_MS = 60 * 60 * 1000;

interface CacheEntry {
    extensions: PimCustomExtension[];
    fetchedAt: number;
}

// Shared across every consumer (dashboard card, report, configure) so one page
// load triggers one Graph call at most.
let memoryCache: CacheEntry | null = null;
let inFlight: Promise<PimCustomExtension[]> | null = null;
const listeners = new Set<() => void>();

function readCache(): CacheEntry | null {
    if (memoryCache) return memoryCache;
    try {
        const raw = sessionStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as CacheEntry;
        if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null;
        memoryCache = parsed;
        return parsed;
    } catch {
        return null;
    }
}

function writeCache(extensions: PimCustomExtension[]): void {
    memoryCache = { extensions, fetchedAt: Date.now() };
    try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify(memoryCache));
    } catch {
        // Storage unavailable, the in-memory copy still serves this session
    }
    listeners.forEach((notify) => notify());
}

export function clearCustomExtensionsCache(): void {
    memoryCache = null;
    try {
        sessionStorage.removeItem(CACHE_KEY);
    } catch {
        // ignore
    }
}

export interface UseCustomExtensionsResult {
    extensions: PimCustomExtension[];
    extensionsById: Map<string, PimCustomExtension>;
    loading: boolean;
    error: string | null;
    /** null until the silent token probe finished */
    hasPermission: boolean | null;
    /** hasPermission told apart: `forbidden` only when a token exists and the list call answered 403 (licence missing) */
    status: CustomExtensionStatus;
    requestingPermission: boolean;
    requestPermission: () => Promise<void>;
    reload: () => Promise<void>;
    /** Builds a Graph client carrying the read scope, for callers that create extensions */
    getClient: (scope?: string) => Promise<Client | null>;
}

/**
 * Loads the tenant's PIM custom extensions behind incremental consent for
 * PrivilegedAccess-CustomExt.Read.All. Reading which extension a policy links
 * needs no extra scope (the rule carries the name); this list only adds the
 * picker and orphan detection, so nothing here blocks the rest of the app.
 */
export function useCustomExtensions(options: { autoLoad?: boolean } = {}): UseCustomExtensionsResult {
    const { autoLoad = true } = options;
    const { instance, accounts } = useMsal();
    const [cache, setCache] = useState<CacheEntry | null>(() => (typeof window === "undefined" ? null : readCache()));
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [hasPermission, setHasPermission] = useState<boolean | null>(() => (cache ? true : null));
    const [requestingPermission, setRequestingPermission] = useState(false);
    const [isForbidden, setIsForbidden] = useState(false);

    useEffect(() => {
        const notify = () => setCache(memoryCache);
        listeners.add(notify);
        return () => {
            listeners.delete(notify);
        };
    }, []);

    const buildClient = useCallback((accessToken: string): Client => Client.init({
        authProvider: (done) => done(null, accessToken),
    }), []);

    const getClient = useCallback(async (scope: string = CUSTOM_EXTENSION_SCOPES.read): Promise<Client | null> => {
        if (!accounts[0]) return null;
        try {
            const response = await instance.acquireTokenSilent({ scopes: [scope], account: accounts[0] });
            return buildClient(response.accessToken);
        } catch {
            return null;
        }
    }, [accounts, instance, buildClient]);

    const load = useCallback(async (client: Client): Promise<void> => {
        setLoading(true);
        setError(null);
        try {
            if (!inFlight) {
                inFlight = fetchCustomExtensions(client).finally(() => {
                    inFlight = null;
                });
            }
            const extensions = await inFlight;
            writeCache(extensions);
            setHasPermission(true);
            setIsForbidden(false);
        } catch (err: unknown) {
            if (isCustomExtensionPermissionError(err)) {
                setHasPermission(false);
                setIsForbidden(true);
            } else {
                setError("Failed to load custom extensions");
                Logger.error("useCustomExtensions", "Custom extensions fetch error", err);
            }
        } finally {
            setLoading(false);
        }
    }, []);

    const reload = useCallback(async () => {
        const client = await getClient();
        if (!client) {
            setHasPermission(false);
            return;
        }
        clearCustomExtensionsCache();
        await load(client);
    }, [getClient, load]);

    const requestPermission = useCallback(async () => {
        if (!accounts[0]) return;
        setRequestingPermission(true);
        setError(null);
        try {
            const response = await instance.acquireTokenPopup({ scopes: [CUSTOM_EXTENSION_SCOPES.read], account: accounts[0] });
            await load(buildClient(response.accessToken));
        } catch (err: unknown) {
            if (err instanceof InteractionRequiredAuthError) {
                setError("Permission request was cancelled");
            } else {
                setError("Failed to request permission");
                Logger.error("useCustomExtensions", "Permission request error", err);
            }
        } finally {
            setRequestingPermission(false);
        }
    }, [accounts, instance, buildClient, load]);

    // Silent probe on mount: a consented scope loads the list, anything else
    // just marks the permission as absent without prompting.
    useEffect(() => {
        if (!autoLoad || accounts.length === 0 || hasPermission !== null || cache) return;
        let cancelled = false;
        (async () => {
            const client = await getClient();
            if (cancelled) return;
            if (!client) {
                setHasPermission(false);
                return;
            }
            await load(client);
        })();
        return () => {
            cancelled = true;
        };
    }, [autoLoad, accounts.length, hasPermission, cache, getClient, load]);

    const extensions = useMemo(() => cache?.extensions ?? [], [cache]);
    const extensionsById = useMemo(() => new Map(extensions.map((e) => [e.id, e])), [extensions]);

    const status: CustomExtensionStatus = hasPermission === true ? "granted" : hasPermission === null ? "checking" : isForbidden ? "forbidden" : "noConsent";

    return {
        extensions,
        extensionsById,
        loading,
        error,
        hasPermission,
        status,
        requestingPermission,
        requestPermission,
        reload,
        getClient,
    };
}
