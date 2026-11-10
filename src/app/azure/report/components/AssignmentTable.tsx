"use client";

import { Icon } from "@/components/icons/Icon";
import { Tag } from "@/components/ui/Tag";
import { AZURE_TERMS } from "@/config/help/azureReportTerms";
import { useIsDetailed } from "@/contexts/DetailsContext";
import type { AzureAssignment } from "@/types/azureResource.types";
import type { AzureAssignmentRow } from "@/utils/azureReport";
import { azureAssignmentTags } from "@/utils/azureAssignmentTags";
import { isAzureTagShown } from "@/utils/calmTags";
import { formatDate } from "@/utils/dateFormat";
import { scopeIconFor } from "@/utils/azureResourceIcons";

const HEADERS = ["Scope", "Principal", "Role", "Assignment", "Origin"];

interface AssignmentTableProps {
    rows: AzureAssignmentRow[];
    /** The principal ids (lowercase) marked as emergency access accounts */
    emergencyAccountIds: ReadonlySet<string>;
    /** The role becomes a button when this is passed */
    onOpenRole?: (assignment: AzureAssignment) => void;
    /** Graph servicePrincipalType by lowercase object id, for the managed identity tag */
    spTypes?: ReadonlyMap<string, string> | null;
    /** Calm details spec 3.6: false hides the Origin column */
    showOrigin?: boolean;
}

/** The assignments as a table, from 640 px. */
export function AssignmentTable({ rows, emergencyAccountIds, onOpenRole, spTypes, showOrigin = true }: AssignmentTableProps) {
    const isDetailed = useIsDetailed();
    return (
        <div className="overflow-hidden rounded border border-line bg-surface max-sm:hidden">
            <table className="w-full text-left text-sm leading-5">
                <caption className="sr-only">Assignments</caption>
                <thead className="bg-band text-xs font-semibold text-muted">
                    <tr>
                        {(showOrigin ? HEADERS : HEADERS.slice(0, 4)).map((header) => <th key={header} scope="col" className="px-3.5 py-2.5">{header}</th>)}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row) => (
                        <tr key={row.assignment.id} className="border-t border-line">
                            <td className="px-3.5 py-3 align-middle">
                                <span className="flex min-w-0 items-start gap-2 text-ink">
                                    <Icon name={scopeIconFor(row.scope)} size={16} className="mt-0.5" />
                                    <span className="min-w-0 wrap-anywhere">{row.scope.name}</span>
                                </span>
                            </td>
                            <td className="px-3.5 py-3 align-middle">
                                <span className="block wrap-anywhere">
                                    <span className="text-ink">{row.assignment.principalName}</span>
                                    <span className="block text-xs leading-4 text-muted wrap-anywhere">{row.assignment.principalUpn ?? row.principalTypeLabel}</span>
                                </span>
                            </td>
                            <td className="px-3.5 py-3 align-middle">
                                {onOpenRole ? (
                                    <button type="button" onClick={() => onOpenRole(row.assignment)} className="text-left text-accent underline-offset-2 hover:underline wrap-anywhere">{row.assignment.roleName}</button>
                                ) : (
                                    <span className="text-ink wrap-anywhere">{row.assignment.roleName}</span>
                                )}
                            </td>
                            <td className="px-3.5 py-3 align-middle">
                                <span className="flex flex-wrap gap-1">
                                    {azureAssignmentTags(row.assignment, emergencyAccountIds, formatDate, spTypes).filter((tag) => isAzureTagShown(tag.term, isDetailed, { keepAssignmentState: true })).map((tag) => (
                                        <Tag key={tag.label} tip={tag.term ? AZURE_TERMS[tag.term].text : undefined} variant={tag.variant} icon={tag.icon}>{tag.label}</Tag>
                                    ))}
                                </span>
                            </td>
                            {showOrigin && (
                                <td className="px-3.5 py-3 align-middle">
                                    {/* A shown column names the origin of every row */}
                                    <Tag tip={AZURE_TERMS[row.isInherited ? "inherited" : "thisScope"].text}>{row.originText}</Tag>
                                </td>
                            )}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
