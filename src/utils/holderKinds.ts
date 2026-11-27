/**
 * Who can hold a role, in one vocabulary: the kinds and the words every filter uses. Pure.
 *
 * This is the list and its labels, not how a row gets its kind. Each page knows that in its own way and may not know it at
 * all (the Audit log calls an app and an agent the same), so a page keeps its own matching and only offers what it can tell.
 */
export type HolderKind = "user" | "guest" | "app" | "agent" | "managedIdentity" | "group" | "foreignGroup" | "deleted";

export const HOLDER_LABELS: Record<HolderKind, { one: string; many: string }> = {
    user: { one: "User", many: "Users" },
    guest: { one: "Guest", many: "Guests" },
    app: { one: "App", many: "Apps" },
    agent: { one: "Agent", many: "Agents" },
    managedIdentity: { one: "Managed identity", many: "Managed identities" },
    group: { one: "Group", many: "Groups" },
    foreignGroup: { one: "Foreign group", many: "Foreign groups" },
    deleted: { one: "Deleted", many: "Deleted" },
};

/** The options of a Who control, after All. `valueOf` is for a page whose URL has its own word for a kind, so its links keep working */
export function holderOptions<V extends string = HolderKind>(kinds: readonly HolderKind[], valueOf?: Partial<Record<HolderKind, V>>): { value: V | HolderKind; label: string }[] {
    return kinds.map((kind) => ({ value: valueOf?.[kind] ?? kind, label: HOLDER_LABELS[kind].many }));
}

/** A guest's user principal name holds `#EXT#` (ARM and Entra, measured). An account can be an exception, so where a page has `userType` that goes first */
export function isGuestUpn(upn: string | null | undefined): boolean {
    return (upn ?? "").toLowerCase().includes("#ext#");
}
