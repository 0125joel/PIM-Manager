/**
 * The permission list of the guide (/help), built from the scopes the app really requests, so it cannot fall behind
 * the code (NextGen plan, 1E). The caller passes the scopes from the config; this file only adds the purpose of each.
 */

export interface PermissionGroup {
    id: "signIn" | "optional" | "write";
    title: string;
    /** One sentence under the list */
    note: string;
    items: { scope: string; purpose: string }[];
}

export interface PermissionSources {
    /** `loginRequest.scopes` */
    signIn: readonly string[];
    /** Read scopes asked when an optional feature is switched on, per feature */
    optional: { feature: string; scopes: readonly string[] }[];
    /** Write scopes asked when Configure applies a change, per workload */
    write: { workload: string; scopes: readonly string[] }[];
}

/** What each scope is used for. A scope without an entry fails the test of this file. */
export const PERMISSION_PURPOSES: Record<string, string> = {
    "User.Read": "who you are",
    "User.Read.All": "who the assignments belong to, and whether an account is a guest",
    "RoleManagement.Read.Directory": "role definitions",
    "RoleAssignmentSchedule.Read.Directory": "active assignments",
    "RoleEligibilitySchedule.Read.Directory": "eligible assignments",
    "RoleManagementPolicy.Read.Directory": "the PIM settings of each role",
    "Policy.Read.ConditionalAccess": "authentication contexts",
    "Group.Read.All": "names and members of groups",
    "AdministrativeUnit.Read.All": "administrative units used as a scope",
    "Application.Read.All": "apps and agent blueprints that hold a role or are used as a scope",
    "PrivilegedAccess.Read.AzureADGroup": "groups under PIM and their assignments",
    "RoleManagementPolicy.Read.AzureADGroup": "the PIM settings of each group",
    "RoleManagementAlert.Read.Directory": "PIM's own security alerts",
    "PrivilegedAccess-CustomExt.Read.All": "the custom extensions of the tenant (preview)",
    "Policy.Read.All": "the Conditional Access policies behind an authentication context, checked before Configure applies",
    "RoleManagementPolicy.ReadWrite.Directory": "changing the PIM settings of a role",
    "RoleEligibilitySchedule.ReadWrite.Directory": "creating and removing eligible role assignments",
    "RoleAssignmentSchedule.ReadWrite.Directory": "creating and removing active role assignments",
    "RoleManagementPolicy.ReadWrite.AzureADGroup": "changing the PIM settings of a group",
    "PrivilegedEligibilitySchedule.ReadWrite.AzureADGroup": "creating and removing eligible group assignments",
    "PrivilegedAssignmentSchedule.ReadWrite.AzureADGroup": "creating and removing active group assignments",
};

function items(scopes: readonly string[], prefix = ""): PermissionGroup["items"] {
    return scopes.map((scope) => ({ scope, purpose: `${prefix}${PERMISSION_PURPOSES[scope] ?? "used by the app"}` }));
}

/** Three groups in the order a user meets them: at sign-in, when a feature is switched on, when Configure writes. */
export function buildPermissionCatalog(sources: PermissionSources): PermissionGroup[] {
    return [
        {
            id: "signIn",
            title: "Read permissions asked at sign-in",
            note: "Each one follows least privilege and needs admin consent in the Microsoft Entra admin center.",
            items: items(sources.signIn),
        },
        {
            id: "optional",
            title: "Read permissions asked when you switch a feature on",
            note: "Microsoft asks for these once, the first time you switch the feature on. Nothing is changed in your tenant.",
            items: sources.optional.flatMap((o) => items(o.scopes, `${o.feature}: `)),
        },
        {
            id: "write",
            title: "Write permissions asked by Configure",
            note: "Asked when you choose Grant permission in Configure, per workload, never at sign-in. Settings lists what is granted.",
            items: sources.write.flatMap((w) => items(w.scopes, `${w.workload}: `)),
        },
    ];
}
