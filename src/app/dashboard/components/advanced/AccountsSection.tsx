"use client";

import { SectionHeader, PANEL_CLASS } from "@/components/ui/SectionHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { isAgentKind } from "@/utils/principalUtils";
import type { AccountRow, ApproversSummary, DashboardScope } from "@/utils/dashboardAdvanced";
import { EmergencyBadge, KindTag, SectionNotice, SPLIT_END, SPLIT_START, SubHeading } from "./shared";

interface AccountsSectionProps {
    /** null: loading */
    accounts: AccountRow[] | null;
    approvers: ApproversSummary | null;
    scope: DashboardScope;
    /** Policies (and so the approvers) are still arriving */
    isPending: boolean;
    notice?: string;
    isDimmed: boolean;
}

/** Most privileged, and who approves (spec 4.3 section 4). */
export function AccountsSection({ accounts, approvers, scope, isPending, notice, isDimmed }: AccountsSectionProps) {
    const rolesLabel = scope === "all" ? "Roles" : "Privileged roles";
    return (
        <section aria-labelledby="adv-accounts-heading" className={PANEL_CLASS}>
            <SectionHeader eyebrow="accounts" title="Most privileged, and who approves" headingId="adv-accounts-heading" isDimmed={isDimmed} />
            <div className={isDimmed ? "opacity-45" : ""}>
                {notice ? (
                    <SectionNotice>{notice}</SectionNotice>
                ) : (
                    <div className="mt-5 grid grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                        <div className={SPLIT_START}>
                            <SubHeading>Accounts</SubHeading>
                            <div className="mt-2 overflow-x-auto" tabIndex={0} role="region" aria-label="Accounts table">
                            {accounts === null ? (
                                <div className="flex flex-col gap-3" aria-hidden="true">
                                    {[0, 1, 2, 3].map((i) => (
                                        <Skeleton key={i} className="block w-full" height={20} />
                                    ))}
                                </div>
                            ) : accounts.length === 0 ? (
                                <SectionNotice>No accounts hold a role.</SectionNotice>
                            ) : (
                                <table className="w-full min-w-[22rem] border-collapse text-[13px] leading-[18px]">
                                    <thead>
                                        <tr className="text-right text-muted">
                                            <th scope="col" className="py-2 pr-3 text-left font-normal">Account</th>
                                            <th scope="col" className="py-2 pr-3 font-normal">{rolesLabel}</th>
                                            <th scope="col" className="py-2 pr-3 font-normal">Permanent</th>
                                            <th scope="col" className="py-2 font-normal">Eligible</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {accounts.map((a) => (
                                            <tr key={a.id} className="border-t border-line text-right font-mono text-ink">
                                                <th scope="row" className="max-w-[14rem] py-2.5 pr-3 text-left font-sans font-medium">
                                                    <span className="inline-block max-w-[10rem] truncate align-middle" title={a.name}>{a.name}</span>
                                                    {a.kind === "servicePrincipal" && <KindTag label="app" />}
                                                    {isAgentKind(a.kind) && <KindTag label="agent" />}
                                                    {a.isEmergency && <EmergencyBadge />}
                                                </th>
                                                <td className="py-2.5 pr-3">{a.privilegedRoles}</td>
                                                <td className={`py-2.5 pr-3 ${a.permanent > 0 ? "text-warn-text" : "text-muted"}`}>{a.permanent}</td>
                                                <td className="py-2.5">{a.eligible}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                            </div>
                        </div>
                        <div className={SPLIT_END}>
                            <SubHeading>Approvers</SubHeading>
                            {isPending || approvers === null ? (
                                <div className="mt-3 flex flex-col gap-3" aria-hidden="true">
                                    {[0, 1, 2].map((i) => (
                                        <Skeleton key={i} className="block w-full" height={20} />
                                    ))}
                                </div>
                            ) : approvers.requiringApproval === 0 ? (
                                <SectionNotice>No roles require approval.</SectionNotice>
                            ) : (
                                <>
                                    <ul className="mt-2 flex flex-col">
                                        {approvers.approvers.map((a) => (
                                            <li key={a.id} className="flex items-baseline justify-between gap-3 border-t border-line py-2.5 text-[13px] leading-[18px] text-ink">
                                                <span className="min-w-0 truncate font-medium" title={a.name}>
                                                    {a.name}
                                                    {a.isGroup && <KindTag label="group" />}
                                                </span>
                                                <span className="shrink-0 font-mono">{a.roleCount}</span>
                                            </li>
                                        ))}
                                    </ul>
                                    {approvers.singleApproverRoles.length > 0 && (
                                        <ul className="mt-3 flex flex-col gap-1">
                                            {approvers.singleApproverRoles.map((w) => (
                                                <li key={w.role} className="text-[13px] leading-[18px] text-warn-text">
                                                    <span className="font-medium">{w.role}</span> has one approver: {w.approver}.
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
}
