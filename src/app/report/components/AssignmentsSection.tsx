import { Clock } from "lucide-react";
import { ScopeBadge } from "@/components/ScopeBadge";

interface AssignmentsSectionProps {
    assignments: {
        permanent: any[];
        eligible: any[];
        active: any[];
    };
}

export function AssignmentsSection({ assignments }: AssignmentsSectionProps) {
    const totalAssignments = assignments.permanent.length + assignments.eligible.length + assignments.active.length;

    return (
        <div>
            <div className="space-y-4">
                {assignments.permanent.length > 0 && (
                    <div>
                        <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                            Permanent Assignments ({assignments.permanent.length})
                        </div>
                        <div className="space-y-2">
                            {assignments.permanent.map((assignment: any) => (
                                <AssignmentRow key={assignment.id} assignment={assignment} type="permanent" />
                            ))}
                        </div>
                    </div>
                )}
                {assignments.eligible.length > 0 && (
                    <div>
                        <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                            PIM Eligible ({assignments.eligible.length})
                        </div>
                        <div className="space-y-2">
                            {assignments.eligible.map((schedule: any) => (
                                <ScheduleRow key={schedule.id} schedule={schedule} type="eligible" />
                            ))}
                        </div>
                    </div>
                )}
                {assignments.active.length > 0 && (
                    <div>
                        <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                            PIM Active ({assignments.active.length})
                        </div>
                        <div className="space-y-2">
                            {assignments.active.map((schedule: any) => (
                                <ScheduleRow key={schedule.id} schedule={schedule} type="active" />
                            ))}
                        </div>
                    </div>
                )}
                {totalAssignments === 0 && (
                    <div className="text-sm text-zinc-500 italic">No assignments found</div>
                )}
            </div>
        </div>
    );
}

function AssignmentRow({ assignment, type }: { assignment: any; type: string }) {
    const principalType = assignment.principal?.["@odata.type"]?.replace("#microsoft.graph.", "") || "Unknown";

    return (
        <div className="text-sm bg-zinc-50 dark:bg-zinc-800/50 p-3 rounded">
            <div className="flex items-center justify-between mb-1">
                <div className="font-medium text-zinc-900 dark:text-zinc-100">
                    {assignment.principal?.displayName || assignment.principalId}
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-xs px-2 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300">
                        {principalType}
                    </span>
                    <span className="text-xs text-zinc-500">
                        {type}
                    </span>
                </div>
            </div>
            {assignment.principal?.userPrincipalName && (
                <div className="text-xs text-zinc-600 dark:text-zinc-400">
                    {assignment.principal.userPrincipalName}
                </div>
            )}
            {/* Scope Badge */}
            {assignment.scopeInfo && (
                <div className="mt-2 flex items-center gap-2">
                    <ScopeBadge scopeInfo={assignment.scopeInfo} />
                </div>
            )}
        </div>
    );
}

function ScheduleRow({ schedule, type }: { schedule: any; type: string }) {
    const principalType = schedule.principal?.["@odata.type"]?.replace("#microsoft.graph.", "") || "Unknown";
    const memberType = schedule.memberType || "Unknown";
    const isDirect = memberType === "Direct";

    return (
        <div className="text-sm bg-zinc-50 dark:bg-zinc-800/50 p-3 rounded">
            <div className="flex items-center justify-between mb-1">
                <div className="font-medium text-zinc-900 dark:text-zinc-100">
                    {schedule.principal?.displayName || schedule.principalId}
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-xs px-2 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300">
                        {principalType}
                    </span>
                    <span className="text-xs text-zinc-500">
                        {type}
                    </span>
                </div>
            </div>
            {schedule.principal?.userPrincipalName && (
                <div className="text-xs text-zinc-600 dark:text-zinc-400 mb-1">
                    {schedule.principal.userPrincipalName}
                </div>
            )}
            <div className="flex items-center gap-3 text-xs text-zinc-500">
                {/* Member Type */}
                <div className="flex items-center gap-1">
                    <span className={`px-2 py-0.5 rounded ${isDirect ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'}`}>
                        {isDirect ? "Direct" : "Via Group"}
                    </span>
                </div>

                {/* Duration */}
                {schedule.scheduleInfo && (
                    <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {schedule.scheduleInfo.expiration?.type === "noExpiration" ? (
                            <span>Permanent</span>
                        ) : schedule.scheduleInfo.expiration?.endDateTime ? (
                            <span>Expires: {new Date(schedule.scheduleInfo.expiration.endDateTime).toLocaleDateString()}</span>
                        ) : schedule.scheduleInfo.expiration?.duration ? (
                            <span>Duration: {schedule.scheduleInfo.expiration.duration}</span>
                        ) : (
                            <span>Active</span>
                        )}
                    </div>
                )}

                {/* Scope Badge */}
                {schedule.scopeInfo && (
                    <div className="flex items-center gap-1">
                        <ScopeBadge scopeInfo={schedule.scopeInfo} />
                    </div>
                )}
            </div>
        </div>
    );
}
