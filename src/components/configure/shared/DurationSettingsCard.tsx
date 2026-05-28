import React, { useEffect } from 'react';
import { Calendar, Info, Loader2, ShieldAlert } from 'lucide-react';
import { Toggle } from '@/components/ui/Toggle';
import { LocalAssignmentState } from './assignmentTypes';
import { PolicySettings } from '@/hooks/useWizardState';
import { addIsoDurationToDate, formatDuration, toLocalDateTimeInputValue } from '@/utils/durationUtils';

interface DurationSettingsCardProps {
    assignments: LocalAssignmentState;
    currentPolicies: PolicySettings | undefined;
    isLoadingPolicies?: boolean;
    /** When true, the justification field is hidden (e.g., wizard's assignment-only mode) */
    skipJustification?: boolean;
    onUpdate: (updates: Partial<LocalAssignmentState>) => void;
}

export function DurationSettingsCard({
    assignments,
    currentPolicies,
    isLoadingPolicies,
    skipJustification = false,
    onUpdate
}: DurationSettingsCardProps) {
    const isPermanentAllowed = () => {
        if (!currentPolicies) return true;
        if (assignments.type === "active") return currentPolicies.allowPermanentActive;
        return currentPolicies.allowPermanentEligible;
    };

    const isJustificationRequired = () => {
        if (skipJustification) return false;
        if (!currentPolicies) return false;
        if (assignments.type === "active") return currentPolicies.requireJustificationOnActiveAssignment;
        return false;
    };

    // A1: cap the end-date input to (start + policy max duration) so admins
    // can't pick a date that Graph would reject with "duration exceeds
    // maximumDuration". When the policy allows permanent, there's no cap.
    const policyMaxIso = assignments.type === "active"
        ? currentPolicies?.activeExpiration
        : currentPolicies?.eligibleExpiration;
    const startDateObj = assignments.startDate ? new Date(assignments.startDate) : new Date();
    const maxEndDateObj = !isPermanentAllowed() && policyMaxIso
        ? addIsoDurationToDate(startDateObj, policyMaxIso)
        : null;
    const maxEndDateValue = maxEndDateObj ? toLocalDateTimeInputValue(maxEndDateObj) : undefined;
    const maxEndDateLabel = policyMaxIso ? formatDuration(policyMaxIso) : undefined;

    // If the policy disallows permanent for the current assignment type, the
    // Permanent toggle is disabled. Without coercion the duration stays
    // "permanent" (the default), the End Date picker never renders, and the
    // user can't set an expiry. Flip to "bounded" once policies have loaded.
    useEffect(() => {
        if (!currentPolicies) return;
        if (!isPermanentAllowed() && assignments.duration === "permanent") {
            onUpdate({ duration: "bounded" });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentPolicies, assignments.type, assignments.duration]);

    // A2: justification required but empty → caller should block Next.
    const justificationMissing = isJustificationRequired() && assignments.justification.trim() === "";

    // A3: warn admin when active assignment requires MFA — their session must
    // already satisfy it; Graph rejects otherwise.
    const showMfaPill = assignments.type === "active"
        && currentPolicies?.requireMfaOnActiveAssignment === true;

    return (
        <div className="bg-white dark:bg-zinc-800 p-4 rounded-lg border border-zinc-200 dark:border-zinc-700 shadow-sm">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2 mb-3">
                <Calendar className="w-4 h-4 text-orange-500" />
                Duration & Settings
            </h3>

            <div className="space-y-4">
                {/* Permanent Checkbox */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-zinc-700 dark:text-zinc-300">Permanent Assignment</span>
                        {isLoadingPolicies && !currentPolicies && (
                            <span className="text-xs text-zinc-400 flex items-center gap-1">
                                <Loader2 className="w-3 h-3 animate-spin" /> Checking policy...
                            </span>
                        )}
                        {!isPermanentAllowed() && (
                            <span className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 px-2 py-0.5 rounded border border-red-100 dark:border-red-900">
                                Blocked by Policy
                            </span>
                        )}
                    </div>
                    <Toggle
                        checked={assignments.duration === "permanent"}
                        onChange={(checked) => onUpdate({ duration: checked ? "permanent" : "bounded" })}
                        disabled={!isPermanentAllowed()}
                    />
                </div>

                {/* Date Pickers */}
                <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 bg-zinc-50 dark:bg-zinc-900/50 rounded-lg border border-zinc-200 dark:border-zinc-700">
                        <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                            Assignment Start
                        </label>
                        <input
                            type="datetime-local"
                            className="w-full px-2 py-1.5 text-xs border border-zinc-300 dark:border-zinc-600 rounded-md bg-white dark:bg-zinc-800 focus:ring-2 focus:ring-blue-500 outline-none dark:[color-scheme:dark]"
                            value={assignments.startDate}
                            onChange={(e) => onUpdate({ startDate: e.target.value })}
                        />
                    </div>

                    {assignments.duration === "bounded" && (
                        <div className="p-3 bg-zinc-50 dark:bg-zinc-900/50 rounded-lg border border-zinc-200 dark:border-zinc-700">
                            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                                Assignment End
                            </label>
                            <input
                                type="datetime-local"
                                className="w-full px-2 py-1.5 text-xs border border-zinc-300 dark:border-zinc-600 rounded-md bg-white dark:bg-zinc-800 focus:ring-2 focus:ring-blue-500 outline-none dark:[color-scheme:dark]"
                                value={assignments.endDate}
                                onChange={(e) => onUpdate({ endDate: e.target.value })}
                                min={assignments.startDate || toLocalDateTimeInputValue()}
                                max={maxEndDateValue}
                            />
                            {maxEndDateLabel && (
                                <div className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400">
                                    Cannot exceed {maxEndDateLabel} per role policy.
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {assignments.duration === "bounded" && (
                    <div className="text-xs text-zinc-500 flex items-center gap-1">
                        <Info className="w-3 h-3" />
                        If no end date is selected, a default duration will apply.
                    </div>
                )}

                {/* A3: MFA-on-active warning pill */}
                {showMfaPill && (
                    <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md p-2">
                        <ShieldAlert className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                        <span>
                            <strong>Active assignment requires Azure MFA.</strong> Your current
                            session must satisfy MFA, otherwise Microsoft Graph will reject the
                            request.
                        </span>
                    </div>
                )}

                {isJustificationRequired() && (
                    <div className="pt-3 border-t border-zinc-200 dark:border-zinc-700">
                        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                            Justification <span className="text-red-500">*</span>
                        </label>
                        <textarea
                            className={`w-full px-3 py-2 text-sm border rounded-md bg-white dark:bg-zinc-800 focus:ring-2 outline-none resize-none ${
                                justificationMissing
                                    ? "border-red-400 dark:border-red-600 focus:ring-red-500"
                                    : "border-zinc-300 dark:border-zinc-600 focus:ring-blue-500"
                            }`}
                            rows={2}
                            placeholder="Provide a reason for this assignment..."
                            value={assignments.justification}
                            onChange={(e) => onUpdate({ justification: e.target.value })}
                            aria-invalid={justificationMissing}
                        />
                        {justificationMissing && (
                            <div className="mt-1 text-[11px] text-red-600 dark:text-red-400">
                                Justification is required by the role policy for active assignments.
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
