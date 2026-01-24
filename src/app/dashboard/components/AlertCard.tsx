import { SecurityAlert, getSeverityColor, getSeverityIcon, getSeverityLabel } from "@/types/securityAlerts";
import { formatAlertString } from "@/utils/alertFormatting";
import { ChevronDown, ChevronUp, X } from "lucide-react";

interface AlertCardProps {
    alert: SecurityAlert;
    isExpanded: boolean;
    onToggle: () => void;
    onDismiss: () => void;
}

export function AlertCard({
    alert,
    isExpanded,
    onToggle,
    onDismiss
}: AlertCardProps) {
    const severity = alert.alertDefinition?.severityLevel || 'unknown';
    const severityColor = getSeverityColor(severity);
    const displayName = formatAlertString(alert.alertDefinition?.displayName, alert);
    const description = formatAlertString(alert.alertDefinition?.description, alert);

    return (
        <div
            className="border rounded-lg overflow-hidden bg-white dark:bg-black"
            style={{ borderColor: `${severityColor}40` }}
        >
            {/* Header row */}
            <div
                className="flex items-center gap-3 p-3 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
                onClick={onToggle}
            >
                {/* Severity indicator */}
                <span className="text-lg" title={getSeverityLabel(severity)}>
                    {getSeverityIcon(severity)}
                </span>

                {/* Severity label */}
                <span
                    className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded"
                    style={{
                        backgroundColor: `${severityColor}20`,
                        color: severityColor
                    }}
                >
                    {getSeverityLabel(severity)}
                </span>

                {/* Title */}
                <span className="flex-1 font-medium text-zinc-900 dark:text-zinc-100 text-sm">
                    {displayName || "Unknown Alert"}
                </span>

                {/* Count badge */}
                <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded">
                    {alert.incidentCount}
                </span>

                {/* Dismiss button */}
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onDismiss();
                    }}
                    className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded"
                    title="Dismiss alert"
                >
                    <X className="w-4 h-4" />
                </button>

                {/* Expand indicator */}
                {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-zinc-400" />
                ) : (
                    <ChevronDown className="w-4 h-4 text-zinc-400" />
                )}
            </div>

            {/* Expanded content */}
            {isExpanded && (
                <div className="px-3 pb-3 border-t border-zinc-100 dark:border-zinc-800">
                    {/* Description */}
                    <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-3">
                        {description}
                    </p>

                    {/* Affected principals */}
                    {alert.alertIncidents && alert.alertIncidents.length > 0 && (
                        <div className="mt-3">
                            <h5 className="text-xs font-semibold text-zinc-500 uppercase mb-2">
                                Affected ({alert.incidentCount})
                            </h5>
                            <ul className="text-sm space-y-1">
                                {alert.alertIncidents.map((incident, idx) => (
                                    <li key={incident.id || idx} className="text-zinc-700 dark:text-zinc-300">
                                        • {incident.assigneeDisplayName || incident.roleDisplayName || "Unknown"}
                                        {incident.assigneeUserPrincipalName && (
                                            <span className="text-zinc-500 ml-1">
                                                ({incident.assigneeUserPrincipalName})
                                            </span>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* Mitigation steps */}
                    {alert.alertDefinition?.mitigationSteps && (
                        <div className="mt-3 p-2 bg-blue-50 dark:bg-blue-950/30 rounded text-sm">
                            <span className="font-medium text-blue-700 dark:text-blue-400">💡 Mitigation: </span>
                            <span className="text-blue-600 dark:text-blue-300">
                                {alert.alertDefinition.mitigationSteps}
                            </span>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
