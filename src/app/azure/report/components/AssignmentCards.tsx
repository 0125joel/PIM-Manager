"use client";

import { Tag } from "@/components/ui/Tag";
import { AZURE_TERMS } from "@/config/help/azureReportTerms";
import { useIsDetailed } from "@/contexts/DetailsContext";
import type { AzureAssignment } from "@/types/azureResource.types";
import { cardFactLine, type AzureAssignmentRow } from "@/utils/azureReport";
import { azureAssignmentTags } from "@/utils/azureAssignmentTags";
import { isAzureTagShown } from "@/utils/calmTags";
import { formatDate } from "@/utils/dateFormat";

interface AssignmentCardsProps {
    rows: AzureAssignmentRow[];
    /** The principal ids (lowercase) marked as emergency access accounts */
    emergencyAccountIds: ReadonlySet<string>;
    /** The role becomes a button when this is passed */
    onOpenRole?: (assignment: AzureAssignment) => void;
    /** Graph servicePrincipalType by lowercase object id, for the managed identity tag */
    spTypes?: ReadonlyMap<string, string> | null;
}

/** The assignments as cards, below 640 px. */
export function AssignmentCards({ rows, emergencyAccountIds, onOpenRole, spTypes }: AssignmentCardsProps) {
    const isDetailed = useIsDetailed();
    return (
        <ul className="flex flex-col gap-3 sm:hidden">
            {rows.map((row) => (
                <li key={row.assignment.id} className="rounded border border-line bg-surface px-3.5 py-3">
                    <div className="flex items-center gap-2">
                        {onOpenRole ? (
                            <button type="button" onClick={() => onOpenRole(row.assignment)} className="min-h-11 flex-1 text-left text-[15px] font-semibold text-accent underline-offset-2 hover:underline">{row.assignment.roleName}</button>
                        ) : (
                            <span className="flex-1 text-[15px] font-semibold text-ink">{row.assignment.roleName}</span>
                        )}
                    </div>
                    <p className="mt-1 text-[13px] text-body">{`${row.assignment.principalName} (${row.assignment.principalUpn ?? row.principalTypeLabel})`}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                        {azureAssignmentTags(row.assignment, emergencyAccountIds, formatDate, spTypes).filter((tag) => isAzureTagShown(tag.term, isDetailed, { keepAssignmentState: true })).map((tag) => (
                            <Tag key={tag.label} tip={tag.term ? AZURE_TERMS[tag.term].text : undefined} variant={tag.variant} icon={tag.icon}>{tag.label}</Tag>
                        ))}
                    </div>
                    <p className="mt-1 text-xs text-muted">{cardFactLine(row)}</p>
                </li>
            ))}
        </ul>
    );
}
