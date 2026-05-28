import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface PreflightWarningsProps {
    hasHighRiskTargets: boolean;
    scratchRiskyOnPrivileged: boolean;
    extensionLines: string[];
    /** Hide individual sections when caller renders them elsewhere */
    showHighRisk?: boolean;
}

/**
 * Shared preflight banners surfaced before applying PIM policy changes.
 * Mirrors the wizard's ReviewStep callouts so Manual and Bulk modes can warn
 * users about the same Microsoft-rejection risks before they hit Apply.
 */
export function PreflightWarnings({
    hasHighRiskTargets,
    scratchRiskyOnPrivileged,
    extensionLines,
    showHighRisk = true,
}: PreflightWarningsProps) {
    if (!hasHighRiskTargets && !scratchRiskyOnPrivileged && extensionLines.length === 0) return null;
    return (
        <div className="space-y-3">
            {showHighRisk && hasHighRiskTargets && (
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-lg p-3 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                    <div>
                        <h4 className="text-sm font-medium text-amber-800 dark:text-amber-200">
                            Privileged roles selected
                        </h4>
                        <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                            Verify settings before applying. These changes affect tenant-wide administrative access.
                        </p>
                    </div>
                </div>
            )}

            {scratchRiskyOnPrivileged && (
                <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-300 dark:border-orange-700 rounded-lg p-3 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-orange-600 dark:text-orange-400 flex-shrink-0 mt-0.5" />
                    <div>
                        <h4 className="text-sm font-medium text-orange-800 dark:text-orange-200">
                            Default policy may be rejected on these roles
                        </h4>
                        <p className="text-xs text-orange-700 dark:text-orange-300 mt-1">
                            The settings allow permanent eligible/active assignments. Microsoft enforces stricter limits on privileged roles and will return <code className="text-xs px-1 bg-orange-100 dark:bg-orange-900/40 rounded">InvalidPolicy</code>. Disable <em>Allow permanent eligible</em> / <em>Allow permanent active</em> first.
                        </p>
                    </div>
                </div>
            )}

            {extensionLines.length > 0 && (
                <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-300 dark:border-orange-700 rounded-lg p-3 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-orange-600 dark:text-orange-400 flex-shrink-0 mt-0.5" />
                    <div>
                        <h4 className="text-sm font-medium text-orange-800 dark:text-orange-200">
                            Policy maximum extension: Microsoft may reject this
                        </h4>
                        <p className="text-xs text-orange-700 dark:text-orange-300 mt-1">
                            Built-in privileged roles have hard caps on <code className="text-xs px-1 bg-orange-100 dark:bg-orange-900/40 rounded">maximumDuration</code> that cannot be extended (PATCH returns <code className="text-xs px-1 bg-orange-100 dark:bg-orange-900/40 rounded">InvalidPolicyRule</code>):
                        </p>
                        <ul className="mt-2 space-y-0.5">
                            {extensionLines.slice(0, 6).map((line, idx) => (
                                <li key={idx} className="text-xs text-orange-700 dark:text-orange-300 font-mono">
                                    {line}
                                </li>
                            ))}
                            {extensionLines.length > 6 && (
                                <li className="text-xs text-orange-700 dark:text-orange-300 italic">
                                    +{extensionLines.length - 6} more
                                </li>
                            )}
                        </ul>
                    </div>
                </div>
            )}
        </div>
    );
}
