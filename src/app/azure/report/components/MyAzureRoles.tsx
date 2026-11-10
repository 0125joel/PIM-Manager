"use client";

import type { MyAzureRoleRow } from "@/utils/azureReportStates";

interface MyAzureRolesProps {
    roles: { active: MyAzureRoleRow[]; eligible: MyAzureRoleRow[] };
}

function RoleGroup({ title, rows }: { title: string; rows: MyAzureRoleRow[] }) {
    return (
        <>
            <h3 className="mb-2 mt-3 text-[13px] leading-5 font-semibold text-body">{title}</h3>
            <ul className="divide-y divide-line">
                {rows.map((row) => (
                    <li key={row.id} className="py-2.5">
                        <p className="text-sm leading-5 text-ink">{row.roleName}</p>
                        <p className="text-xs leading-4 text-muted">{row.isPermanent ? `${row.scopeName}, permanent` : `${row.scopeName}, ends ${row.endText}`}</p>
                    </li>
                ))}
            </ul>
        </>
    );
}

/** The user's own active and eligible Azure roles, shown in the empty state: Eligible first, then Active, as the Entra roles */
export function MyAzureRoles({ roles }: MyAzureRolesProps) {
    return (
        <section data-visual-section="azure-my-roles" className="mt-5 border-t border-line pt-4" aria-labelledby="azure-my-roles-heading">
            <h2 id="azure-my-roles-heading" className="text-sm leading-5 font-semibold text-ink">
                Your Azure roles
            </h2>
            {roles.eligible.length > 0 && <RoleGroup title={`Eligible (${roles.eligible.length})`} rows={roles.eligible} />}
            {roles.active.length > 0 && <RoleGroup title={`Active (${roles.active.length})`} rows={roles.active} />}
        </section>
    );
}
