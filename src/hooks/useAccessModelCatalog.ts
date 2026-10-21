"use client";

import { useCallback, useEffect, useState } from "react";
import { useUnifiedLoading } from "@/contexts/UnifiedPimContext";
import { loadAccessModelCatalog, type LoadedCatalog } from "@/utils/accessModelCatalog";
import { Logger } from "@/utils/logger";

export type AccessModelCatalogStatus = "waiting" | "loading" | "ready" | "failed";

export interface AccessModelCatalogState {
    status: AccessModelCatalogStatus;
    /** The catalog with where it came from (live or the bundled copy, and why) and when it was read */
    loaded: LoadedCatalog | null;
    /** After "failed" (the bundled copy itself could not be loaded): read again */
    retry: () => void;
}

// One read per page load, shared by every consumer (Edit, Guided, Import, the access model page)
let shared: Promise<LoadedCatalog> | null = null;
let result: LoadedCatalog | null = null;

function readCatalog(): Promise<LoadedCatalog> {
    shared ??= loadAccessModelCatalog({
        fetchImpl: (input, init) => fetch(input, init),
        loadBundled: () => import("@/config/accessModel/eam-catalog.json").then((m) => m.default),
    }).then((loaded) => {
        result = loaded;
        if (loaded.origin === "bundled") Logger.info("AccessModel", `Using the bundled catalog (${loaded.fallbackReason})`);
        return loaded;
    }, (error: unknown) => {
        shared = null;
        throw error;
    });
    return shared;
}

/**
 * The PIM Monitor catalog (spec 9.1): read after the core load, never blocking; the bundled copy when pimmonitor.com
 * cannot be reached, answers a newer major or an invalid file.
 */
export function useAccessModelCatalog(): AccessModelCatalogState {
    const loading = useUnifiedLoading();
    const rolesPhase = loading.workloads.directoryRoles?.phase;
    const coreDone = rolesPhase === "complete" || rolesPhase === "error";
    const [loaded, setLoaded] = useState<LoadedCatalog | null>(result);
    const [status, setStatus] = useState<AccessModelCatalogStatus>(result ? "ready" : "waiting");

    const start = useCallback(() => {
        setStatus("loading");
        readCatalog().then((value) => {
            setLoaded(value);
            setStatus("ready");
        }, (error: unknown) => {
            Logger.error("AccessModel", "The access model catalog could not be read", error);
            setStatus("failed");
        });
    }, []);

    useEffect(() => {
        if (!coreDone || status !== "waiting") return;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- the side read starts once the core load is done (spec 9.1)
        start();
    }, [coreDone, status, start]);

    const retry = useCallback(() => setStatus((current) => (current === "failed" ? "waiting" : current)), []);

    return { status, loaded, retry };
}
