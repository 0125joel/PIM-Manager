import { useState, useEffect, useCallback } from "react";
import { useMsal } from "@azure/msal-react";
import { InteractionRequiredAuthError } from "@azure/msal-browser";
import { SecurityAlert } from '@/types/securityAlerts.types';
import { fetchSecurityAlerts } from "@/utils/alertsApi";
import { Logger } from "@/utils/logger";
import { describeLoadFailure } from "@/utils/errorUtils";
import { ALERTS_PERMISSION } from "@/config/constants";

const DISMISSED_ALERTS_KEY = "pim-dismissed-alerts";

/** MSAL errors carry their code in `errorCode` */
function getMsalErrorCode(error: unknown): string | undefined {
    if (error && typeof error === "object" && "errorCode" in error) {
        const code = (error as { errorCode?: unknown }).errorCode;
        if (typeof code === "string") return code;
    }
    return undefined;
}

/** One alerts read at a time: strict mode and a quick second mount must not send the same request twice */
let alertsInFlight: Promise<SecurityAlert[]> | null = null;

function fetchSecurityAlertsOnce(accessToken: string): Promise<SecurityAlert[]> {
    if (!alertsInFlight) {
        alertsInFlight = fetchSecurityAlerts(accessToken).finally(() => {
            alertsInFlight = null;
        });
    }
    return alertsInFlight;
}

interface UseSecurityAlertsOptions {
    /** False holds the first read back, so it does not compete with the roles for the tenant's request budget */
    enabled?: boolean;
}

export function useSecurityAlerts({ enabled = true }: UseSecurityAlertsOptions = {}) {
    const { instance, accounts } = useMsal();

    // State
    const [alerts, setAlerts] = useState<SecurityAlert[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [hasPermission, setHasPermission] = useState<boolean | null>(null);
    const [requestingPermission, setRequestingPermission] = useState(false);
    const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(new Set());

    // Load dismissed alerts from session storage
    useEffect(() => {
        try {
            const stored = sessionStorage.getItem(DISMISSED_ALERTS_KEY);
            if (stored) {
                setDismissedAlerts(new Set(JSON.parse(stored)));
            }
        } catch {
            // Ignore storage errors
        }
    }, []);

    // Save dismissed alerts to session storage
    const saveDismissed = useCallback((dismissed: Set<string>) => {
        try {
            sessionStorage.setItem(DISMISSED_ALERTS_KEY, JSON.stringify([...dismissed]));
        } catch {
            // Ignore storage errors
        }
    }, []);

    // Get access token with alerts permission
    const getAccessToken = useCallback(async (): Promise<string | null> => {
        if (!accounts[0]) return null;

        try {
            const response = await instance.acquireTokenSilent({
                scopes: [ALERTS_PERMISSION],
                account: accounts[0],
            });
            return response.accessToken;
        } catch {
            // Token not available silently - permission not granted
            return null;
        }
    }, [instance, accounts]);

    // Fetch alerts
    const loadAlerts = useCallback(async () => {
        const accessToken = await getAccessToken();
        setError(null);

        if (!accessToken) {
            // No token means permission not granted yet
            setHasPermission(false);
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const fetchedAlerts = await fetchSecurityAlertsOnce(accessToken);
            setAlerts(fetchedAlerts);
            setHasPermission(true);
        } catch (err: unknown) {
            if (err instanceof Error && err.message === 'PERMISSION_DENIED') {
                setHasPermission(false);
            } else {
                setError(describeLoadFailure(err));
                Logger.error("useSecurityAlerts", "Alerts fetch error", err);
            }
        } finally {
            setLoading(false);
        }
    }, [getAccessToken]);

    // Request permission via incremental consent
    const requestPermission = async () => {
        if (!accounts[0]) return;

        setRequestingPermission(true);
        setError(null);

        try {
            const response = await instance.acquireTokenPopup({
                scopes: [ALERTS_PERMISSION],
                account: accounts[0],
            });

            // Permission granted - use the token to fetch alerts
            setHasPermission(true);
            setLoading(true);

            try {
                const fetchedAlerts = await fetchSecurityAlerts(response.accessToken);
                setAlerts(fetchedAlerts);
            } catch (err) {
                setError(describeLoadFailure(err));
                Logger.error("useSecurityAlerts", "Alerts fetch error after permission:", err);
            } finally {
                setLoading(false);
            }

        } catch (err) {
            const code = getMsalErrorCode(err);
            if (err instanceof InteractionRequiredAuthError || code === "user_cancelled") {
                // User cancelled or interaction needed
                setError("Permission request was cancelled");
            } else if (code === "timed_out") {
                // The popup was closed or never finished before MSAL's timeout: a user outcome, not an app failure
                setError("The permission window timed out before consent was given. Try again and finish the prompt.");
                Logger.warn("useSecurityAlerts", "Permission popup timed out before consent");
            } else {
                setError("Failed to request permission");
                Logger.error("useSecurityAlerts", "Permission request error", err);
            }
        } finally {
            setRequestingPermission(false);
        }
    };

    // Check permission on mount
    useEffect(() => {
        if (enabled && accounts.length > 0 && hasPermission === null) {
            loadAlerts();
        }
    }, [enabled, accounts.length, hasPermission, loadAlerts]);

    // Actions
    const dismissAlert = (alertId: string) => {
        setDismissedAlerts(prev => {
            const next = new Set(prev);
            next.add(alertId);
            saveDismissed(next);
            return next;
        });
    };

    const restoreAll = () => {
        setDismissedAlerts(new Set());
        saveDismissed(new Set());
    };

    return {
        alerts,
        loading,
        error,
        hasPermission,
        requestingPermission,
        dismissedAlerts,
        loadAlerts,
        requestPermission,
        dismissAlert,
        restoreAll,
        ALERTS_PERMISSION
    };
}
