import type { RoleDetailData } from "@/types/directoryRole.types";
import type { PimGroupData } from "@/types/pimGroup.types";
import type { AuthenticationContext } from "@/types/shared.types";
import type { PolicySettings } from "@/types/wizard.types";
import { parseGraphPolicy } from "@/utils/policyParser";
import { completeRules } from "@/utils/policyView";

/** Report spec 10.5: everything as it is now, in one JSON file. Raw rules are kept next to the parsed settings. */
export const BACKUP_SCHEMA_VERSION = 1;

export type BackupWorkload = "directoryRoles" | "pimGroups";

export interface BackupInput {
    roles: RoleDetailData[];
    groups: PimGroupData[];
    tenant: { id: string; displayName?: string };
    /** When each workload was read (ISO), for the header */
    readAt: Partial<Record<BackupWorkload, string>>;
    appVersion: string;
    exportedAt?: Date;
    /** Workloads that are loaded and consented; the others are left out of the file */
    workloads: BackupWorkload[];
    authenticationContexts: readonly AuthenticationContext[];
    /** The tenant's custom extensions; null when the list could not be read (licence or consent) */
    customExtensions: readonly { id: string; displayName: string }[] | null;
}

export interface Backup {
    schemaVersion: number;
    app: { name: string; version: string };
    tenant: { id: string; displayName?: string };
    readAt: Partial<Record<BackupWorkload, string>>;
    exportedAt: string;
    workloads: BackupWorkload[];
    lists: {
        authenticationContexts: readonly AuthenticationContext[];
        customExtensions: readonly { id: string; displayName: string }[];
        /** Present when the extension list could not be read */
        customExtensionsNote?: string;
    };
    directoryRoles?: Array<{
        definition: RoleDetailData["definition"];
        policy: { id: string; rules: unknown[] } | null;
        settings: PolicySettings | null;
        assignments: RoleDetailData["assignments"];
        configError?: string;
        /** Graph answered 403: the policy was not readable with the admin's access, so `policy` and `settings` are null (FIX-12) */
        policiesForbidden?: true;
    }>;
    pimGroups?: Array<{
        group: PimGroupData["group"];
        isManaged: boolean;
        policies: { member: { id: string; rules: unknown[] } | null; owner: { id: string; rules: unknown[] } | null };
        settings: { member: PolicySettings | null; owner: PolicySettings | null };
        /** Graph answered 403: the policies were not readable with the admin's access, so the nulls above mean "not read" (FIX-11) */
        policiesForbidden?: true;
        assignments: PimGroupData["assignments"];
    }>;
}

const settingsOf = (rules: readonly unknown[] | undefined): PolicySettings | null =>
    rules && rules.length > 0 ? parseGraphPolicy({ rules: completeRules(rules) }) : null;

export function buildBackup(input: BackupInput): Backup {
    const backup: Backup = {
        schemaVersion: BACKUP_SCHEMA_VERSION,
        app: { name: "PIM Manager", version: input.appVersion },
        tenant: input.tenant,
        readAt: input.readAt,
        exportedAt: (input.exportedAt ?? new Date()).toISOString(),
        workloads: input.workloads,
        lists: {
            authenticationContexts: input.authenticationContexts,
            customExtensions: input.customExtensions ?? [],
            ...(input.customExtensions === null ? { customExtensionsNote: "The custom extension list could not be read (licence or consent); the rules still carry the extension ids." } : {}),
        },
    };
    if (input.workloads.includes("directoryRoles")) {
        backup.directoryRoles = input.roles.map((role) => {
            const rules = role.policy?.details?.rules;
            return {
                definition: role.definition,
                policy: role.policy?.details ? { id: role.policy.details.id, rules: (rules ?? []) as unknown[] } : null,
                settings: settingsOf(rules),
                assignments: role.assignments,
                ...(role.configError ? { configError: role.configError } : {}),
                ...(role.policiesForbidden ? { policiesForbidden: true as const } : {}),
            };
        });
    }
    if (input.workloads.includes("pimGroups")) {
        const rawPolicy = (policy: NonNullable<PimGroupData["policies"]>["member"]) => (policy ? { id: policy.id, rules: policy.rules as unknown[] } : null);
        backup.pimGroups = input.groups.map((data) => ({
            group: data.group,
            isManaged: data.isManaged !== false,
            policies: { member: rawPolicy(data.policies?.member), owner: rawPolicy(data.policies?.owner) },
            settings: { member: settingsOf(data.policies?.member?.rules), owner: settingsOf(data.policies?.owner?.rules) },
            assignments: data.assignments,
            ...(data.policiesForbidden ? { policiesForbidden: true as const } : {}),
        }));
    }
    return backup;
}
