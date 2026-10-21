import type { LoadingPhase } from "@/types/workload.types";

/**
 * When the Configure access check may start (FIX-13). It reads the admin's own roles and groups, and from the loaded roles
 * only their definitions and assignments: `deriveWriteAccess` never reads a policy. So it starts as soon as Directory Roles
 * has its fast phase: the roles are in and nothing is still being read. The background phase of the policies ("processing"
 * with the roles already shown) does not hold it back, and neither does the group workload. Not while the roles are read
 * (fetching) or consent is pending.
 */
export function isAccessCheckReady({ phase, loadedRoles }: { phase: LoadingPhase | undefined; loadedRoles: number }): boolean {
    if (phase === "complete" || phase === "error") return true;
    if (phase === "fetching" || phase === "consent") return false;
    return loadedRoles > 0;
}
