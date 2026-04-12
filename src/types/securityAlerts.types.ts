// TypeScript interfaces for PIM Security Alerts
// Based on Microsoft Graph API beta: /identityGovernance/roleManagementAlerts

export type AlertSeverity = 'high' | 'medium' | 'low' | 'informational' | 'unknown' | 'unknownFutureValue';

export interface SecurityAlertDefinition {
    id: string;
    displayName: string;
    description: string;
    severityLevel: AlertSeverity;
    securityImpact: string;
    mitigationSteps: string;
    howToPrevent: string;
    isRemediatable: boolean;
    isConfigurable: boolean;
    scopeType: string;
    scopeId: string;
}

export interface SecurityAlertIncident {
    id: string;
    // Common properties across incident types
    assigneeId?: string;
    assigneeDisplayName?: string;
    assigneeUserPrincipalName?: string;
    roleDefinitionId?: string;
    roleDisplayName?: string;
    // Allow additional properties for different incident types
    [key: string]: unknown;
}

export interface SecurityAlert {
    id: string;
    alertDefinitionId: string;
    isActive: boolean;
    incidentCount: number;
    lastModifiedDateTime: string;
    lastScannedDateTime: string;
    scopeId: string;
    scopeType: string;
    // Expanded relationships
    alertDefinition?: SecurityAlertDefinition;
    alertIncidents?: SecurityAlertIncident[];
    alertConfiguration?: Record<string, any>;
}

export interface SecurityAlertsState {
    alerts: SecurityAlert[];
    loading: boolean;
    error: string | null;
    hasPermission: boolean;
    permissionRequested: boolean;
}

// Helper function to get severity color
export function getSeverityColor(severity: AlertSeverity): string {
    switch (severity) {
        case 'high':
            return '#ef4444'; // red-500
        case 'medium':
            return '#f59e0b'; // amber-500
        case 'low':
            return '#3b82f6'; // blue-500
        case 'informational':
            return '#6b7280'; // gray-500
        default:
            return '#6b7280'; // gray-500
    }
}

// Helper function to get severity icon
export function getSeverityIcon(severity: AlertSeverity): string {
    switch (severity) {
        case 'high':
            return '🔴';
        case 'medium':
            return '🟠';
        case 'low':
            return '🔵';
        case 'informational':
            return 'ℹ️';
        default:
            return '⚪';
    }
}

// Helper function to get severity label
export function getSeverityLabel(severity: AlertSeverity): string {
    switch (severity) {
        case 'high':
            return 'HIGH';
        case 'medium':
            return 'MEDIUM';
        case 'low':
            return 'LOW';
        case 'informational':
            return 'INFO';
        default:
            return 'UNKNOWN';
    }
}
