// API utility for fetching PIM Security Alerts from Graph API beta
import { SecurityAlert } from "@/types/securityAlerts";
import { GRAPH_LOCALE } from "@/config/constants";

const ALERTS_ENDPOINT = "https://graph.microsoft.com/beta/identityGovernance/roleManagementAlerts/alerts";
const ALERTS_FILTER = "scopeId eq '/' and scopeType eq 'DirectoryRole'";

/**
 * Fetches PIM security alerts from Microsoft Graph API (beta)
 * Requires: RoleManagementAlert.Read.Directory permission
 */
export async function fetchSecurityAlerts(accessToken: string): Promise<SecurityAlert[]> {
    try {
        const url = `${ALERTS_ENDPOINT}?$filter=${encodeURIComponent(ALERTS_FILTER)}&$expand=alertDefinition,alertConfiguration`;

        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'Accept-Language': GRAPH_LOCALE,
            },
        });

        if (response.status === 403) {
            throw new Error('PERMISSION_DENIED');
        }

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        const alerts: SecurityAlert[] = data.value || [];

        return alerts
            .sort((a, b) => {
                const severityOrder: Record<string, number> = {
                    'high': 0,
                    'medium': 1,
                    'low': 2,
                    'informational': 3,
                    'unknown': 4
                };
                const aOrder = severityOrder[a.alertDefinition?.severityLevel || 'unknown'] ?? 4;
                const bOrder = severityOrder[b.alertDefinition?.severityLevel || 'unknown'] ?? 4;
                return aOrder - bOrder;
            });

    } catch (error: unknown) {
        if (error instanceof Error && error.message === 'PERMISSION_DENIED') {
            throw error;
        }
        console.error('Failed to fetch security alerts:', error);
        throw error;
    }
}
