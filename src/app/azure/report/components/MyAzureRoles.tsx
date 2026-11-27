"use client";

import Link from "next/link";
import type { MyAzureRoleRow, MyAzureRolesLoaded } from "@/utils/azureReportStates";
import type { MyGroupPath, MyGroupPathsState } from "@/utils/myGroupPaths";

interface MyAzureRolesProps {
    roles: MyAzureRolesLoaded;
}

const NOTE_AFTER_ACTIVATION = "The Azure roles of a group show here once you activate your membership in PIM for Groups. Azure can take a few minutes before they appear.";
const NOTE_FAILED = "Your PIM group memberships could not be read.";

function endLine(scope: string | null, via: string | undefined, row: { isPermanent: boolean; endText: string }): string {
    const parts = [...(scope !== null ? [scope] : []), ...(via !== undefined ? [`via ${via}`] : []), row.isPermanent ? "permanent" : `ends ${row.endText}`];
    return parts.join(", ");
}

function RoleGroup({ title, rows }: { title: string; rows: MyAzureRoleRow[] }) {
    return (
        <>
            <h3 className="mb-2 mt-3 text-[13px] leading-5 font-semibold text-body">{title}</h3>
            <ul className="divide-y divide-line">
                {rows.map((row) => (
                    <li key={row.id} className="py-2.5">
                        <p className="text-sm leading-5 text-ink">{row.roleName}</p>
                        <p className="text-xs leading-4 text-muted">{endLine(row.scopeName, row.viaGroup, row)}</p>
                    </li>
                ))}
            </ul>
        </>
    );
}

function GroupPaths({ groups }: { groups: MyGroupPath[] }) {
    return (
        <>
            <h3 className="mb-2 mt-3 text-[13px] leading-5 font-semibold text-body">{`Through a PIM group (${groups.length})`}</h3>
            <ul className="divide-y divide-line">
                {groups.map((group) => (
                    <li key={group.groupId} className="py-2.5">
                        <p className="text-sm leading-5 text-ink">{`Eligible member of ${group.groupName}`}</p>
                        <p className="text-xs leading-4 text-muted">{endLine(null, undefined, group)}</p>
                    </li>
                ))}
            </ul>
            <p className="mt-2 text-xs leading-4 text-muted">{NOTE_AFTER_ACTIVATION}</p>
        </>
    );
}

function GroupNote({ groups }: { groups: MyGroupPathsState }) {
    if (groups.kind === "listed") return groups.groups.length > 0 ? <GroupPaths groups={groups.groups} /> : null;
    if (groups.kind === "failed") return <p className="mt-3 text-xs leading-4 text-muted">{NOTE_FAILED}</p>;
    return (
        <p className="mt-3 text-xs leading-4 text-muted">
            Roles you hold through a PIM group are not shown, because PIM Manager has no read access to PIM for Groups. Choose Grant read access for PIM for Groups under{" "}
            <Link href="/settings#permissions" className="text-accent underline">Settings, Workloads and permissions</Link>; an admin has to consent.
        </p>
    );
}

/** The user's own active and eligible Azure roles, shown in the empty state: Eligible first, then Active, as the Entra roles, then the PIM groups they are an eligible member of */
export function MyAzureRoles({ roles }: MyAzureRolesProps) {
    return (
        <section data-visual-section="azure-my-roles" className="mt-5 border-t border-line pt-4" aria-labelledby="azure-my-roles-heading">
            <h2 id="azure-my-roles-heading" className="text-sm leading-5 font-semibold text-ink">
                Your Azure roles
            </h2>
            {roles.eligible.length > 0 && <RoleGroup title={`Eligible (${roles.eligible.length})`} rows={roles.eligible} />}
            {roles.active.length > 0 && <RoleGroup title={`Active (${roles.active.length})`} rows={roles.active} />}
            <GroupNote groups={roles.groups} />
        </section>
    );
}
