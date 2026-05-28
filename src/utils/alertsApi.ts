// API utility for fetching PIM Security Alerts from Graph API beta
import { SecurityAlert } from '@/types/securityAlerts.types';
import { GRAPH_LOCALE } from "@/config/constants";
import { Logger } from "@/utils/logger";
import { withRetry } from "@/utils/retryUtils";

const ALERTS_ENDPOINT = "https://graph.microsoft.com/beta/identityGovernance/roleManagementAlerts/alerts";
const ALERTS_FILTER = "scopeId eq '/' and scopeType eq 'DirectoryRole'";

/**
 * Error shape that `withRetry` understands: it inspects `statusCode` to decide
 * retryability and `responseHeaders` to honor `Retry-After` on 429s. Raw `fetch`
 * doesn't throw on non-2xx, so we synthesize this shape ourselves.
 */
class HttpError extends Error {
    statusCode: number;
    responseHeaders: Headers;
    constructor(status: number, statusText: string, headers: Headers) {
        super(`HTTP ${status}: ${statusText}`);
        this.statusCode = status;
        this.responseHeaders = headers;
    }
}

/**
 * Fetches PIM security alerts from Microsoft Graph API (beta)
 * Requires: RoleManagementAlert.Read.Directory permission
 */
export async function fetchSecurityAlerts(accessToken: string): Promise<SecurityAlert[]> {
    try {
        const url = `${ALERTS_ENDPOINT}?$filter=${encodeURIComponent(ALERTS_FILTER)}&$expand=alertDefinition,alertConfiguration`;

        const data = await withRetry(async () => {
            const response = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                    'Accept-Language': GRAPH_LOCALE,
                },
            });

            // 403 is not retryable and is handled specially by the caller
            if (response.status === 403) {
                throw new Error('PERMISSION_DENIED');
            }

            if (!response.ok) {
                throw new HttpError(response.status, response.statusText, response.headers);
            }

            return response.json();
        }, 3, 1000, 'fetchSecurityAlerts');

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
        Logger.error('alertsApi', 'Failed to fetch security alerts:', error);
        throw error;
    }
}
