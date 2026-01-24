import { SecurityAlert } from "@/types/securityAlerts";

/**
 * Formats a security alert string by replacing placeholders with actual values.
 *
 * Replacements:
 * - {0}: Replaced with the incident count (e.g. number of roles/users affected)
 * - {1}: Replaced with configuration values (e.g. duration, days, threshold) found in alertConfiguration
 *
 * @param text The text string containing placeholders like {0} or {1}
 * @param alert The full SecurityAlert object containing incidentCount and alertConfiguration
 * @returns The formatted string with placeholders replaced
 */
export function formatAlertString(text: string | undefined, alert: SecurityAlert): string {
    if (!text) return "";

    // Replace {0} with incident count
    let formatted = text.replace(/\{0\}/g, alert.incidentCount.toString());

    // Replace {1} with configuration values if available
    if (formatted.includes("{1}")) {
        // Try to find a meaningful number in the configuration
        // Common keys for time-based alerts: duration, days, threshold, timePeriod
        const config = alert.alertConfiguration || {};
        const configValue = config.duration || config.days || config.threshold || config.period || "30"; // Fallback to 30 if not found

        // Remove ISODuration format if present (e.g. "P30D" -> "30")
        const cleanValue = configValue.toString().replace(/^P/, '').replace(/D$/, '');

        formatted = formatted.replace(/\{1\}/g, cleanValue);
    }

    return formatted;
}
