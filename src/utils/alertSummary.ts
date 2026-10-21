import type { AlertSeverity, SecurityAlert } from "@/types/securityAlerts.types";
import { formatAlertString } from "@/utils/alertFormatting";

export interface AlertRow {
    id: string;
    title: string;
    description: string;
    severity: AlertSeverity;
    /** The user dismissed this alert (only listed when dismissed alerts are shown) */
    isDismissed: boolean;
    /** Filled dot for medium and high, open ring for the rest (spec 4.2) */
    isFilled: boolean;
    affected: number;
    alert: SecurityAlert;
}

export interface AlertSummary {
    /** Active alerts, most severe first; dismissed ones only when asked for */
    rows: AlertRow[];
    /** Active alerts that are not dismissed: the count in the block title */
    openCount: number;
    /** Active alerts the user dismissed */
    dismissedCount: number;
    /** Checks that found nothing */
    passedCount: number;
}

const SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2, informational: 3 };

/** Splits the alert list into what the "From Microsoft" block shows. */
export function summarizeAlerts(alerts: SecurityAlert[], dismissed: ReadonlySet<string>, showDismissed = false): AlertSummary {
    const active = alerts.filter((a) => a.isActive && a.incidentCount > 0);
    const passedCount = alerts.length - active.length;
    const visible = showDismissed ? active : active.filter((a) => !dismissed.has(a.id));

    const rows = visible
        .map((alert): AlertRow => {
            const severity = alert.alertDefinition?.severityLevel ?? "unknown";
            return {
                id: alert.id,
                title: formatAlertString(alert.alertDefinition?.displayName, alert) || "Unknown alert",
                description: formatAlertString(alert.alertDefinition?.description, alert),
                severity,
                isDismissed: dismissed.has(alert.id),
                isFilled: severity === "high" || severity === "medium",
                affected: alert.incidentCount,
                alert,
            };
        })
        .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 4) - (SEVERITY_ORDER[b.severity] ?? 4) || b.affected - a.affected);

    return { rows, openCount: active.filter((a) => !dismissed.has(a.id)).length, dismissedCount: active.filter((a) => dismissed.has(a.id)).length, passedCount };
}
