import { useState, useEffect, useCallback } from "react";
import { useMsal } from "@azure/msal-react";
import { InteractionRequiredAuthError } from "@azure/msal-browser";
import { SecurityAlert } from "@/types/securityAlerts";
import { fetchSecurityAlerts } from "@/utils/alertsApi";

const DISMISSED_ALERTS_KEY = "pim-dismissed-alerts";
const ALERTS_PERMISSION = "RoleManagementAlert.Read.Directory";

export function useSecurityAlerts() {
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

        if (!accessToken) {
            // No token means permission not granted yet
            setHasPermission(false);
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const fetchedAlerts = await fetchSecurityAlerts(accessToken);
            setAlerts(fetchedAlerts);
            setHasPermission(true);
        } catch (err: unknown) {
            if (err instanceof Error && err.message === 'PERMISSION_DENIED') {
                setHasPermission(false);
            } else {
                setError("Failed to load security alerts");
                console.error("Alerts fetch error:", err);
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
                setError("Failed to load security alerts");
                console.error("Alerts fetch error after permission:", err);
            } finally {
                setLoading(false);
            }

        } catch (err) {
            if (err instanceof InteractionRequiredAuthError) {
                // User cancelled or interaction needed
                setError("Permission request was cancelled");
            } else {
                setError("Failed to request permission");
                console.error("Permission request error:", err);
            }
        } finally {
            setRequestingPermission(false);
        }
    };

    // Check permission on mount
    useEffect(() => {
        if (accounts.length > 0 && hasPermission === null) {
            loadAlerts();
        }
    }, [accounts.length, hasPermission, loadAlerts]);

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
