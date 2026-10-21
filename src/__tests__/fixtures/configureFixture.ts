/**
 * The Contoso data of the Configure renders (NG-62), for the fixture route `src/app/dev/configure/page.fixture.tsx`:
 * the six admins of spec 3.4 (`?access=`), the history line of Last applies and a basket of three changes. Names and
 * numbers follow the renders: Privileged Role Administrator active until 14:20, "7 changes on 3 roles" yesterday 16:05.
 */
import type { Basket } from "@/utils/configureBasket";
import type { HistoryEntry } from "@/utils/configureHistory";
import type { ApplyRun } from "@/utils/configureResult";
import { changeId } from "@/utils/configureBasket";
import { ROLE_TEMPLATES, deriveWriteAccess, type WriteAccess, type WriteAccessInput } from "@/utils/writeAccess";

export const CONFIGURE_NOW = new Date(2026, 9, 4, 12, 0);
export const CONFIGURE_TENANT_ID = "3f2a91c4-7d1e-4b6a-9e0f-5c8d2a1b7e63";
export const CONFIGURE_CATALOG_ROLES = 145;

export type FixtureAccess = "pra" | "groups" | "owner" | "eligible" | "none" | "consent";
export const FIXTURE_ACCESS: readonly FixtureAccess[] = ["pra", "groups", "owner", "eligible", "none", "consent"];

const T = ROLE_TEMPLATES;
const DEFINITIONS = [
    { id: T.privilegedRoleAdministrator, templateId: T.privilegedRoleAdministrator, displayName: "Privileged Role Administrator", isBuiltIn: true },
    { id: T.groupsAdministrator, templateId: T.groupsAdministrator, displayName: "Groups Administrator", isBuiltIn: true },
];
const GROUPS = [
    { id: "g-tier0", displayName: "Tier 0 Identity Admins", isAssignableToRole: true, isUnderPim: true },
    { id: "g-helpdesk", displayName: "Helpdesk Operators", isAssignableToRole: null, isUnderPim: true },
    { id: "g-sales", displayName: "All Sales (dynamic)", isAssignableToRole: null, membershipRule: "user.department -eq \"Sales\"", isUnderPim: false },
];
const UNTIL_1420 = new Date(2026, 9, 4, 14, 20).toISOString();

/**
 * The access of one of the six admins. `edit` replaces the three groups of the start page renders, so Edit gets a
 * decision for every group of the Report fixture it lists, and names the group the owner owns there.
 */
export function buildFixtureAccess(kind: FixtureAccess, edit?: { groups: WriteAccessInput["groups"]; ownedGroup: { id: string; displayName: string } }): WriteAccess {
    const groups = edit?.groups ?? GROUPS;
    const base: WriteAccessInput = {
        activeRoles: [], eligibleRoles: [], ownedGroups: [], groupActive: [], groupEligible: [], administrativeUnitGroups: {},
        appPermission: { directoryRoles: "granted", pimGroups: "granted" }, roleDefinitions: DEFINITIONS, groups,
    };
    const pra = { roleDefinitionId: T.privilegedRoleAdministrator, directoryScopeId: "/", memberType: "Direct", assignmentType: "Activated", endDateTime: UNTIL_1420 };
    switch (kind) {
        case "pra": return deriveWriteAccess({ ...base, activeRoles: [pra] });
        case "groups": return deriveWriteAccess({ ...base, activeRoles: [{ roleDefinitionId: T.groupsAdministrator, directoryScopeId: "/", memberType: "Direct", endDateTime: UNTIL_1420 }] });
        // The start page owns Helpdesk Operators ("1 group"); Edit names its own group
        case "owner": return deriveWriteAccess({ ...base, ownedGroups: [edit?.ownedGroup ?? { id: "g-helpdesk", displayName: "Helpdesk Operators" }] });
        case "eligible": return deriveWriteAccess({ ...base, eligibleRoles: [{ ...pra, endDateTime: null }] });
        case "consent": return deriveWriteAccess({ ...base, activeRoles: [pra], appPermission: { directoryRoles: "notGranted", pimGroups: "notGranted" } });
        default: return deriveWriteAccess(base);
    }
}

export const CONFIGURE_HISTORY: HistoryEntry[] = [{
    runId: "fixture-run-1",
    at: new Date(2026, 9, 3, 16, 5).toISOString(),
    by: "Alex Wilber",
    targetCount: 3,
    results: Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`c${i}`, { status: "done" as const }])),
    changes: Array.from({ length: 7 }, (_, i) => ({ kind: "setting" as const, target: { kind: "role" as const, id: `role-${i % 3}` }, field: "requireApproval" as const, from: false, to: true, source: { from: "edit" as const } })),
    snapshot: { schemaVersion: 1, app: { name: "PIM Manager", version: "3.2.0" }, tenant: { id: CONFIGURE_TENANT_ID, displayName: "Contoso" }, readAt: {}, exportedAt: new Date(2026, 9, 3, 16, 5).toISOString(), workloads: ["directoryRoles"], lists: { authenticationContexts: [], customExtensions: [] } },
}];

/** Three changes on two roles of the Report fixture: the basket bar shows "3 changes not applied", "2 targets" */
export function buildFixtureBasket(count: number): Basket {
    const fields = ["maxActivationDuration", "allowPermanentEligible", "requireJustificationOnActivation"] as const;
    return {
        changes: Array.from({ length: Math.max(0, Math.min(count, 3)) }, (_, i) => ({
            kind: "setting" as const,
            target: { kind: "role" as const, id: i === 2 ? "role-pra" : "role-ga" },
            field: fields[i],
            // From the values the Report fixture's policies hold: Global Administrator activates for 4 hours and allows
            // permanent eligible assignments, Privileged Role Administrator asks a justification
            from: i === 0 ? "PT4H" : true,
            to: i === 0 ? "PT2H" : false,
            source: { from: "edit" as const },
        })),
    };
}

/**
 * The basket of the review and result renders (`basket=review`): four changes on three targets. Privileged Role
 * Administrator asks an authentication context instead of MFA and activates for 2 hours instead of 8, Global
 * Administrator allows permanent active assignments (the built-in privileged role warning), and Mo Haddad's eligible
 * Exchange Administrator assignment is removed (the confirmation by name).
 */
export function buildReviewBasket(): Basket {
    const source = { from: "edit" as const };
    return {
        changes: [
            { kind: "setting", target: { kind: "role", id: "role-pra" }, field: "activationRequirement", from: { kind: "mfa" }, to: { kind: "authenticationContext", contextId: "c1" }, source },
            { kind: "setting", target: { kind: "role", id: "role-pra" }, field: "maxActivationDuration", from: "PT8H", to: "PT2H", source },
            { kind: "setting", target: { kind: "role", id: "role-ga" }, field: "allowPermanentActive", from: false, to: true, source },
            {
                kind: "remove",
                target: { kind: "role", id: "role-exo" },
                schedule: { principal: { id: "u-mo", kind: "user", displayName: "Mo Haddad", userPrincipalName: "mo@contoso.com" }, type: "eligible", scope: "/", end: null },
                source,
            },
        ],
    };
}

/**
 * The run of the result render (`step=result`): the render's three changes on two targets, the maximum activation
 * duration refused with 429 three times; `finished` false is the progress list (`apply=progress`).
 */
export function buildFixtureRun(finished: boolean): ApplyRun {
    const [requirement, duration, , removal] = buildReviewBasket().changes;
    const changes = [requirement, duration, removal];
    const throttled = { status: "failed" as const, code: "TooManyRequests", message: "Microsoft Graph answered 429 (too many requests) three times. Nothing was changed for this one." };
    return {
        runId: "fixture-result",
        changes,
        progress: finished
            ? { [changeId(requirement)]: { status: "done" }, [changeId(duration)]: throttled, [changeId(removal)]: { status: "done" } }
            : { [changeId(requirement)]: { status: "done" }, [changeId(duration)]: "writing" },
        startedAt: new Date(2026, 9, 4, 13, 41).toISOString(),
        ...(finished ? { finishedAt: new Date(2026, 9, 4, 13, 42).toISOString() } : {}),
        snapshotSaved: true,
        targetCount: 2,
        reread: "done",
    };
}

/**
 * The file of the import render (`?mode=import&import=assignments`): eight rows against the Report fixture's tenant that
 * give every result of spec 7.3, in the order of the render: two new (one limited to an administrative unit), one
 * removal, two skipped (already there, not there any more) and three that need a fix (permanent active not allowed,
 * nobody with this UPN, an End Date that is not a date). Megan Bowen is not in the loaded assignments; the fixture's look-up finds her.
 */
export const IMPORT_ROLE_ASSIGNMENTS_CSV = [
    "Role ID,Role Name,Principal ID,Principal UPN,Assignment Type,Duration Days,Justification,Action,Scope ID,End Date,Notes",
    "role-exo,Exchange Administrator,,megan@contoso.com,eligible,,,add,/,2027-04-01T00:00:00Z,from the Q4 list",
    "role-exo,Exchange Administrator,u-mo,,eligible,,,add,/,permanent,",
    "role-soc,Security Reader,u-lotte,,active,,,add,/,permanent,",
    "role-ua,User Administrator,,megan@contoso.com,eligible,,,add,/administrativeUnits/au-nl,2027-01-01T00:00:00Z,",
    "role-pra,Privileged Role Administrator,u-anna,,eligible,,,remove,/,,",
    "role-ua,User Administrator,,j.doe@contoso.com,eligible,,,add,/,,",
    "role-exo,Exchange Administrator,u-bram,,eligible,,,remove,/,,",
    "role-ga,Global Administrator,u-erik,,eligible,,,add,/,2026-13-01,",
].join("\r\n");

/** A file of the older removal kind (Duration Days, End Date and Justification absent): `?import=removals` */
export const IMPORT_OLDER_REMOVALS_CSV = [
    "Role ID,Role Name,Principal ID,Principal UPN,Assignment Type,Scope ID,Action",
    "role-exo,Exchange Administrator,u-mo,,eligible,/,remove",
    "role-pra,Privileged Role Administrator,u-anna,,eligible,/,remove",
].join("\r\n");

export const IMPORT_GROUP_ASSIGNMENTS_CSV = [
    "Group ID,Group Name,Principal ID,Principal UPN,Access Type,Assignment Type,Duration Days,Justification,Action,End Date",
    "g-helpdesk1,Helpdesk Tier 1,,megan@contoso.com,member,eligible,,,add,2027-04-01T00:00:00Z",
    "g-helpdesk1,Helpdesk Tier 1,u-mo,,member,eligible,,,add,permanent",
    "g-helpdesk1,Helpdesk Tier 1,u-lotte,,member,eligible,,,remove,",
].join("\r\n");

export const IMPORT_UNKNOWN_CSV = "Name,Colour\r\nSomething,red\r\n";

/** The people the fixture's look-up knows besides the loaded assignments */
export const IMPORT_MEGAN_ID = "5d9f1a2b-0c3e-4f7a-9b1d-2e8c6a4f7d10";
export const IMPORT_EXTRA_PEOPLE = [{ id: IMPORT_MEGAN_ID, kind: "user" as const, displayName: "Megan Bowen", userPrincipalName: "megan@contoso.com" }];

/**
 * The role settings file of the import render (`?mode=import&import=policies`): the columns the render lists as read
 * (Max Activation Duration, Require On Activation, Justification Required, Approval Required, Approver IDs, a
 * pre-approval extension and a recipients column), the read-only Description and Permanent Count as skipped, and cells
 * that equal the tenant (they count as "already match"). Megan Bowen is an approver the fixture's look-up names.
 */
export const IMPORT_ROLE_POLICIES_CSV = [
    "Role ID,Role Name,Description,Permanent Count,Max Activation Duration,Require On Activation,Justification Required,Approval Required,Approver IDs,Pre-approval Extension ID,Eligible Assignment Admin Recipients",
    `role-exo,Exchange Administrator,Manages Exchange,0,PT4H,mfa,Yes,Yes,user:${IMPORT_MEGAN_ID},ext-servicenow,finance-it@contoso.com`,
    "role-sec,Security Administrator,Manages security,2,PT8H,mfa,Yes,,,,",
    "role-ua,User Administrator,Manages users,2,PT8H,mfa,No,No,,,",
].join("\r\n");

export const IMPORT_GROUP_POLICIES_CSV = [
    "Group ID,Group Name,Member Max Duration,Member Require On Activation,Member Justification Required,Owner Max Duration,Owner Approval",
    "g-helpdesk1,Helpdesk Tier 1,PT2H,mfa,Yes,PT4H,",
    "g-dev,Dev Leads,PT4H,,,PT2H,",
].join("\r\n");

/** An access model file for the fixture: roles by display name (the fixture roles carry no template id) */
export const IMPORT_ACCESS_MODEL_JSON = JSON.stringify({
    schemaVersion: "1.0.0",
    roles: [
        { displayName: "Global Administrator", expectedConfig: { maxActivationDuration: "PT2H", requireMFA: true, requireJustification: true, requireApproval: true, allowPermanentEligible: false, allowPermanentActive: false } },
        { displayName: "Exchange Administrator", expectedConfig: { maxActivationDuration: "PT4H", requireMFA: true, requireJustification: true } },
        { displayName: "Security Administrator", expectedConfig: { authContext: "phish-resistant-sif" } },
    ],
}, null, 2);
