"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMsal } from "@azure/msal-react";
import { CONDITIONAL_ACCESS_PERMISSION } from "@/config/constants";
import { createGraphClient } from "@/utils/graphClient";
import { fetchConditionalAccessPolicies, type ConditionalAccessPolicy } from "@/services/conditionalAccessService";
import { classifyProbeError } from "@/utils/permissionStatus";
import { getErrorMessage, getErrorStatusCode } from "@/utils/errorUtils";
import { Logger } from "@/utils/logger";

/**
 * - `notGranted`: the app has no `Policy.Read.All` yet ("Check Conditional Access" asks for it)
 * - `forbidden`: the scope is there, but the admin's active roles may not read Conditional Access (403)
 */
export type ConditionalAccessStatus = "idle" | "checking" | "ready" | "notGranted" | "forbidden" | "failed";

export interface ConditionalAccessState {
    status: ConditionalAccessStatus;
    policies: ConditionalAccessPolicy[] | null;
    error: string | null;
    /** Asks for the permission with a popup when needed, then reads ("Check Conditional Access") */
    check: () => Promise<void>;
}

// Once per session (spec 12.5), shared by every consumer; a 403 is remembered too, so a remount does not read again
let cached: ConditionalAccessPolicy[] | null = null;
let forbiddenOnce = false;

/**
 * The optional Conditional Access check (spec 12.5): on first use a silent token request decides whether the app may
 * read already, and reads when it may; otherwise it waits for `check()`, which asks for the permission on demand.
 */
export function useConditionalAccess(): ConditionalAccessState {
    const { instance, accounts } = useMsal();
    const account = accounts[0];
    const [status, setStatus] = useState<ConditionalAccessStatus>(cached ? "ready" : forbiddenOnce ? "forbidden" : "idle");
    const [policies, setPolicies] = useState<ConditionalAccessPolicy[] | null>(cached);
    const [error, setError] = useState<string | null>(null);
    const started = useRef(false);

    const read = useCallback(async (interactive: boolean) => {
        if (!account) return;
        setStatus("checking");
        setError(null);
        let token: string;
        try {
            token = (await instance.acquireTokenSilent({ scopes: [CONDITIONAL_ACCESS_PERMISSION], account })).accessToken;
        } catch (silentError: unknown) {
            if (!interactive || classifyProbeError(silentError) !== "notGranted") {
                setStatus(interactive ? "failed" : "notGranted");
                if (interactive) setError(getErrorMessage(silentError));
                return;
            }
            try {
                token = (await instance.acquireTokenPopup({ scopes: [CONDITIONAL_ACCESS_PERMISSION], account })).accessToken;
            } catch (popupError: unknown) {
                Logger.warn("ConditionalAccess", "Permission not granted", popupError);
                setStatus("notGranted");
                return;
            }
        }
        try {
            const result = await fetchConditionalAccessPolicies(createGraphClient(token));
            cached = result;
            forbiddenOnce = false;
            setPolicies(result);
            setStatus("ready");
        } catch (readError: unknown) {
            if (getErrorStatusCode(readError) === 403) {
                // The expected answer of an admin without a role that may read Conditional Access: info, never an error (FIX-15)
                Logger.info("ConditionalAccess", "Conditional Access is not readable with the current access (403)");
                forbiddenOnce = true;
                setStatus("forbidden");
                return;
            }
            Logger.error("ConditionalAccess", "Conditional Access policies could not be read", readError);
            setError(getErrorMessage(readError));
            setStatus("failed");
        }
    }, [instance, account]);

    useEffect(() => {
        // check() reads again on request (after activating a fitting role)
        if (cached || forbiddenOnce || started.current || !account) return;
        started.current = true;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- a silent first read, never a popup (spec 12.5)
        void read(false);
    }, [account, read]);

    const check = useCallback(() => read(true), [read]);
    return { status, policies, error, check };
}
