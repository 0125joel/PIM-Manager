import type { RawDirectoryAudit } from "@/types/audit.types";
import type { WorkspaceRow } from "@/utils/auditWorkspaceRows";

/** Graph-shaped rows as the rows of a workspace read for `tenantId`; `count` repeats them with new ids up to that many */
export function adaptDemoRows(rows: readonly RawDirectoryAudit[], tenantId: string, count?: number): WorkspaceRow[] {
    const source = rows.length > 0 ? rows : [];
    const total = count ?? source.length;
    return Array.from({ length: total }, (_, index) => {
        const base = source[index % source.length];
        return { tenantId, raw: count === undefined ? base : { ...base, id: `${base.id}-${index}` } };
    });
}
