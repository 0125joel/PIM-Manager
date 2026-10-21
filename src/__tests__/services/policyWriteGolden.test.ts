/**
 * Golden tests of the policy write path (NG-53, spec 11.3).
 *
 * Every case loads a fixture policy into the settings model the Configure screens edit (`parseGraphPolicy`), changes one
 * field, applies it through the one write path (`updatePimPolicy` for roles; for groups `buildRuleUpdates` over
 * `settingsToChanges`, which is what the apply engine of Configure sends) against the recording client, and stores what
 * it sent as snapshots:
 *
 * - "{case}": the PATCH bodies of the rules the field maps to (spec 11.2), in the order they were sent;
 * - "bug 4: {case}, rules the change did not touch": the bodies of every other rule that was written;
 * - "bug 4: no change, {fixture}": what an apply of an unchanged form writes.
 *
 * The snapshot file is the record of what PIM Manager writes; any change to a request body fails here. Names starting
 * with "bug 3" or "bug 4" mark the bodies that are wrong today (spec 20), and only those may change in NG-54:
 * - bug 3: leaving an authentication context. Groups never write it; roles send `claimValue` null where spec 11.2 sends
 *   "" for both workloads.
 * - bug 4: rules rewritten with values the change did not ask for. Groups rewrite every rule with fixed approval values;
 *   roles rewrite their approval stage with fixed values (also on an unchanged form with approvers), rewrite an
 *   assignment expiration rule that allows permanence without its stored `maximumDuration`, and rewrite an eligible end
 *   required at P365D (it goes through the label "1 Year" and back to P1Y).
 *
 * The PATCH version is not part of the record: roles go to beta today and NG-54 moves them to v1.0 (spec 13.1); the
 * service tests of NG-54 pin it.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { updatePimPolicy } from "@/services/pimConfigurationService";
import { buildRuleUpdates, settingsToChanges, type GraphRule } from "@/utils/policyRules";
import { completeRules } from "@/utils/policyView";
import { parseGraphPolicy } from "@/utils/policyParser";
import type { PolicySettings } from "@/types/wizard.types";
import { createRecordingClient, type RecordingClient } from "../support/recordingGraphClient";
import {
    GROUP_APPROVER,
    GROUP_ID,
    GROUP_POLICY_ID,
    OTHER_USER_APPROVER,
    ROLE_ID,
    ROLE_POLICY_ID,
    USER_APPROVER,
    groupRules,
    roleRules,
    type FixtureOptions,
    type FixtureRule,
} from "../fixtures/policyRules";

type Workload = "roles" | "groups";

function fixtureClient(rules: FixtureRule[]): RecordingClient {
    const approvers = [USER_APPROVER, GROUP_APPROVER, OTHER_USER_APPROVER];
    return createRecordingClient([
        {
            method: "GET",
            match: (r) => r.path === "/policies/roleManagementPolicyAssignments" && (r.query.filter ?? "").includes(`roleDefinitionId eq '${ROLE_ID}'`) && (r.query.filter ?? "").includes("scopeId eq '/'"),
            respond: () => ({ value: [{ id: `${ROLE_POLICY_ID}_assignment`, policyId: ROLE_POLICY_ID, roleDefinitionId: ROLE_ID, policy: { id: ROLE_POLICY_ID, rules } }] }),
        },
        {
            method: "GET",
            match: (r) => r.path === "/policies/roleManagementPolicyAssignments" && (r.query.filter ?? "").includes(`scopeId eq '${GROUP_ID}'`) && (r.query.filter ?? "").includes("roleDefinitionId eq 'member'"),
            respond: () => ({ value: [{ id: `${GROUP_POLICY_ID}_assignment`, policyId: GROUP_POLICY_ID, roleDefinitionId: "member", policy: { id: GROUP_POLICY_ID, rules } }] }),
        },
        // The rules of a policy read directly, for a caller that reads them by policy id
        { method: "GET", match: (r) => r.path === `/policies/roleManagementPolicies/${ROLE_POLICY_ID}/rules` || r.path === `/policies/roleManagementPolicies/${GROUP_POLICY_ID}/rules`, respond: () => ({ value: rules }) },
        {
            method: "GET",
            match: (r) => r.path === `/policies/roleManagementPolicies/${ROLE_POLICY_ID}` || r.path === `/policies/roleManagementPolicies/${GROUP_POLICY_ID}`,
            respond: (r) => ({ id: r.path.split("/").pop(), rules }),
        },
        {
            method: "GET",
            match: /^\/(users|groups)\/[0-9a-f-]+$/,
            respond: (r) => {
                const id = r.path.split("/")[2];
                const known = approvers.find((a) => a.id === id);
                return { id, displayName: known?.name ?? id, userPrincipalName: known?.kind === "user" ? `${id}@contoso.com` : undefined };
            },
        },
    ]);
}

/** Runs a promise to the end while fake timers skip the pacing delays of the services */
async function settle<T>(promise: Promise<T>): Promise<T> {
    let done = false;
    promise.then(() => { done = true; }, () => { done = true; });
    while (!done) await vi.advanceTimersByTimeAsync(500);
    return promise;
}

interface Written {
    path: string;
    version: string;
    ruleId: string;
    body: unknown;
}

async function write(workload: Workload, fixture: FixtureOptions, edit: (s: PolicySettings) => void): Promise<Written[]> {
    const rules = workload === "roles" ? roleRules(fixture) : groupRules(fixture);
    const recording = fixtureClient(rules);
    const settings = parseGraphPolicy({ rules: JSON.parse(JSON.stringify(rules)) });
    edit(settings);
    if (workload === "roles") await settle(updatePimPolicy(recording.client, ROLE_ID, settings));
    else {
        const complete = completeRules(rules) as GraphRule[];
        const updates = buildRuleUpdates("pimGroups", complete, settingsToChanges(parseGraphPolicy({ rules: complete }), settings));
        for (const update of updates) await recording.client.api(`/policies/roleManagementPolicies/${GROUP_POLICY_ID}/rules/${update.ruleId}`).version("v1.0").patch(update.body);
    }
    const writes = recording.writes();
    expect(writes.every((w) => w.method === "PATCH")).toBe(true);
    return writes.map((w) => ({ path: w.path, version: w.version, ruleId: w.path.split("/").pop() ?? "", body: w.body }));
}

const NOTIFICATION_CELLS: Array<{ section: "eligibleAssignment" | "activeAssignment" | "activation"; recipient: "admin" | "assignee" | "requestor" | "approver"; ruleId: string }> = [
    { section: "eligibleAssignment", recipient: "admin", ruleId: "Notification_Admin_Admin_Eligibility" },
    { section: "eligibleAssignment", recipient: "assignee", ruleId: "Notification_Requestor_Admin_Eligibility" },
    { section: "eligibleAssignment", recipient: "approver", ruleId: "Notification_Approver_Admin_Eligibility" },
    { section: "activeAssignment", recipient: "admin", ruleId: "Notification_Admin_Admin_Assignment" },
    { section: "activeAssignment", recipient: "assignee", ruleId: "Notification_Requestor_Admin_Assignment" },
    { section: "activeAssignment", recipient: "approver", ruleId: "Notification_Approver_Admin_Assignment" },
    { section: "activation", recipient: "admin", ruleId: "Notification_Admin_EndUser_Assignment" },
    { section: "activation", recipient: "requestor", ruleId: "Notification_Requestor_EndUser_Assignment" },
    { section: "activation", recipient: "approver", ruleId: "Notification_Approver_EndUser_Assignment" },
];

function notificationCell(s: PolicySettings, section: string, recipient: string) {
    return (s.notifications as unknown as Record<string, Record<string, { isEnabled: boolean; additionalRecipients: string; criticalOnly: boolean }>>)[section][recipient];
}

const REQUIREMENT_RULES = ["Enablement_EndUser_Assignment", "AuthenticationContext_EndUser_Assignment"];
const EXTENSION_RULES = ["CustomExtension_PreApproval_EndUser_Assignment", "CustomExtension_PostApproval_EndUser_Assignment"];

interface GoldenCase {
    name: string;
    /** The rules spec 11.2 maps the changed field to */
    rules: string[];
    fixture?: FixtureOptions;
    edit: (s: PolicySettings) => void;
    /** Today's body for these rules is wrong for both workloads (labelled per workload in `label`) */
    bug3?: boolean;
    bug4Roles?: boolean;
    bug4Groups?: boolean;
}

/** The cases per field of spec 11.2 */
const CASES: GoldenCase[] = [
    { name: "activation duration PT8H to PT4H", rules: ["Expiration_EndUser_Assignment"], edit: (s) => { s.maxActivationDuration = "PT4H"; } },
    { name: "requirement nothing to MFA", rules: REQUIREMENT_RULES, edit: (s) => { s.activationRequirement = "mfa"; } },
    { name: "requirement nothing to context c1", rules: REQUIREMENT_RULES, bug4Groups: true, edit: (s) => { s.activationRequirement = "authenticationContext"; s.authenticationContextId = "c1"; } },
    { name: "requirement context to MFA", rules: REQUIREMENT_RULES, bug3: true, fixture: { requirement: { context: "c1" } }, edit: (s) => { s.activationRequirement = "mfa"; } },
    { name: "requirement context to nothing", rules: REQUIREMENT_RULES, bug3: true, bug4Groups: true, fixture: { requirement: { context: "c1" } }, edit: (s) => { s.activationRequirement = "none"; } },
    { name: "requirement MFA to context c2", rules: REQUIREMENT_RULES, fixture: { requirement: "mfa" }, edit: (s) => { s.activationRequirement = "authenticationContext"; s.authenticationContextId = "c2"; } },
    { name: "requirement MFA to nothing", rules: REQUIREMENT_RULES, fixture: { requirement: "mfa" }, edit: (s) => { s.activationRequirement = "none"; } },
    { name: "requirement context c1 to context c2", rules: REQUIREMENT_RULES, bug4Groups: true, fixture: { requirement: { context: "c1" } }, edit: (s) => { s.authenticationContextId = "c2"; } },
    { name: "justification on activation off", rules: ["Enablement_EndUser_Assignment"], edit: (s) => { s.requireJustificationOnActivation = false; } },
    { name: "ticket information on", rules: ["Enablement_EndUser_Assignment"], edit: (s) => { s.requireTicketInfo = true; } },
    {
        name: "approval on with a user and a group", rules: ["Approval_EndUser_Assignment"], bug4Roles: true, bug4Groups: true,
        edit: (s) => { s.requireApproval = true; s.approvers = [{ id: USER_APPROVER.id, type: "user", displayName: USER_APPROVER.name }, { id: GROUP_APPROVER.id, type: "group", displayName: GROUP_APPROVER.name }]; },
    },
    {
        name: "approval off, two-day timeout set before", rules: ["Approval_EndUser_Assignment"], bug4Roles: true, bug4Groups: true,
        fixture: { approvers: [USER_APPROVER, GROUP_APPROVER], approvalTimeoutDays: 2 },
        edit: (s) => { s.requireApproval = false; s.approvers = []; },
    },
    {
        name: "approvers replaced, two-day timeout set before", rules: ["Approval_EndUser_Assignment"], bug4Roles: true, bug4Groups: true,
        fixture: { approvers: [USER_APPROVER, GROUP_APPROVER], approvalTimeoutDays: 2 },
        edit: (s) => { s.approvers = [{ id: OTHER_USER_APPROVER.id, type: "user", displayName: OTHER_USER_APPROVER.name }]; },
    },
    { name: "extension before approval linked", rules: EXTENSION_RULES, edit: (s) => { s.customExtensions = { preApproval: { isEnabled: true, customExtensionId: "ext-pre", customAttributes: [] } }; } },
    { name: "extension after approval linked", rules: EXTENSION_RULES, edit: (s) => { s.customExtensions = { postApproval: { isEnabled: true, customExtensionId: "ext-post", customAttributes: ["Reason"] } }; } },
    {
        name: "extension before approval unlinked, after approval kept", rules: EXTENSION_RULES, bug4Groups: true, fixture: { preApprovalExtension: "ext-pre", postApprovalExtension: "ext-post" },
        edit: (s) => { s.customExtensions = { ...s.customExtensions, preApproval: { isEnabled: false, customExtensionId: "", customAttributes: [] } }; },
    },
    {
        name: "extension after approval unlinked, before approval kept", rules: EXTENSION_RULES, bug4Groups: true, fixture: { preApprovalExtension: "ext-pre", postApprovalExtension: "ext-post" },
        edit: (s) => { s.customExtensions = { ...s.customExtensions, postApproval: { isEnabled: false, customExtensionId: "", customAttributes: [] } }; },
    },
    { name: "permanent eligible off", rules: ["Expiration_Admin_Eligibility"], fixture: { eligibleMustEnd: undefined }, edit: (s) => { s.allowPermanentEligible = false; } },
    { name: "permanent eligible on", rules: ["Expiration_Admin_Eligibility"], bug4Roles: true, fixture: { eligibleMustEnd: "P365D" }, edit: (s) => { s.allowPermanentEligible = true; } },
    { name: "eligible end after 1 year to 3 months", rules: ["Expiration_Admin_Eligibility"], fixture: { eligibleMustEnd: "P365D" }, edit: (s) => { s.eligibleExpiration = "P3M"; } },
    { name: "permanent active off", rules: ["Expiration_Admin_Assignment"], fixture: { activeMustEnd: undefined }, edit: (s) => { s.allowPermanentActive = false; } },
    { name: "permanent active on", rules: ["Expiration_Admin_Assignment"], bug4Roles: true, fixture: { activeMustEnd: "P180D" }, edit: (s) => { s.allowPermanentActive = true; } },
    { name: "active end after 6 months to 15 days", rules: ["Expiration_Admin_Assignment"], fixture: { activeMustEnd: "P180D" }, edit: (s) => { s.activeExpiration = "P15D"; } },
    { name: "MFA on active assignment on", rules: ["Enablement_Admin_Assignment"], edit: (s) => { s.requireMfaOnActiveAssignment = true; } },
    { name: "justification on active assignment off", rules: ["Enablement_Admin_Assignment"], edit: (s) => { s.requireJustificationOnActiveAssignment = false; } },
    ...NOTIFICATION_CELLS.map(({ section, recipient, ruleId }): GoldenCase => ({
        name: `notification ${section} ${recipient}: defaults off, one recipient, critical only`,
        rules: [ruleId],
        edit: (s) => {
            const cell = notificationCell(s, section, recipient);
            cell.isEnabled = false;
            cell.additionalRecipients = "audit@contoso.com";
            cell.criticalOnly = true;
        },
    })),
    { name: "notification activation admin: defaults off only", rules: ["Notification_Admin_EndUser_Assignment"], edit: (s) => { notificationCell(s, "activation", "admin").isEnabled = false; } },
    { name: "notification activation admin: one recipient only", rules: ["Notification_Admin_EndUser_Assignment"], edit: (s) => { notificationCell(s, "activation", "admin").additionalRecipients = "audit@contoso.com"; } },
    { name: "notification activation admin: critical only", rules: ["Notification_Admin_EndUser_Assignment"], edit: (s) => { notificationCell(s, "activation", "admin").criticalOnly = true; } },
    {
        name: "notification recipients cleared on every cell", rules: NOTIFICATION_CELLS.map((c) => c.ruleId), fixture: { recipients: ["old@contoso.com"] },
        edit: (s) => { for (const { section, recipient } of NOTIFICATION_CELLS) notificationCell(s, section, recipient).additionalRecipients = ""; },
    },
];

/** The name of a case's own snapshot per workload, with the bug labels of spec 20 */
function label(workload: Workload, c: GoldenCase): string {
    const bugs: string[] = [];
    if (c.bug3) bugs.push("bug 3");
    if (workload === "roles" ? c.bug4Roles : c.bug4Groups) bugs.push("bug 4");
    return bugs.length ? `${bugs.join(", ")}: ${c.name}` : c.name;
}

// applyDirectoryRolePolicies imports pimConfigurationService on demand; load it once with real timers
beforeAll(async () => { await import("@/services/pimConfigurationService"); });
beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); });
afterEach(() => { vi.useRealTimers(); });

/** `enabledRules` is a set: the two old paths send it in different orders, so the snapshot sorts it */
function canonical(body: unknown): unknown {
    if (!body || typeof body !== "object") return body;
    const copy = { ...(body as Record<string, unknown>) };
    if (Array.isArray(copy.enabledRules)) copy.enabledRules = [...copy.enabledRules].sort();
    return copy;
}

const bodies = (written: Written[]) => written.map(({ path, body }) => ({ path, body: canonical(body) }));

describe.each<Workload>(["roles", "groups"])("policy write golden: %s", (workload) => {
    for (const c of CASES) {
        it(label(workload, c), async () => {
            const written = await write(workload, c.fixture ?? {}, c.edit);
            expect(bodies(written.filter((w) => c.rules.includes(w.ruleId)))).toMatchSnapshot();
        });

        it(`bug 4: ${c.name}, rules the change did not touch`, async () => {
            const written = await write(workload, c.fixture ?? {}, c.edit);
            expect(bodies(written.filter((w) => !c.rules.includes(w.ruleId)))).toMatchSnapshot();
        });
    }

    const unchanged: Array<{ name: string; fixture: FixtureOptions }> = [
        { name: "base policy", fixture: {} },
        { name: "approval with two approvers and a two-day timeout", fixture: { approvers: [USER_APPROVER, GROUP_APPROVER], approvalTimeoutDays: 2 } },
        { name: "both assignment ends required", fixture: { eligibleMustEnd: "P365D", activeMustEnd: "P180D" } },
        { name: "context, extensions and recipients", fixture: { requirement: { context: "c1" }, preApprovalExtension: "ext-pre", recipients: ["old@contoso.com"] } },
    ];
    for (const u of unchanged) {
        it(`bug 4: no change, ${u.name}`, async () => {
            const written = await write(workload, u.fixture, () => {});
            expect(bodies(written)).toMatchSnapshot();
        });
    }

    it("a tenant without the preview never gets an extension rule written", async () => {
        const written = await write(workload, { withoutExtensionRules: true }, (s) => {
            s.maxActivationDuration = "PT2H";
            s.requireApproval = true;
            s.approvers = [{ id: USER_APPROVER.id, type: "user", displayName: USER_APPROVER.name }];
            s.allowPermanentActive = !s.allowPermanentActive;
        });
        expect(written.length).toBeGreaterThan(0);
        expect(written.map((w) => w.ruleId).filter((id) => id.startsWith("CustomExtension_"))).toEqual([]);
    });

    it("rule ids a full form writes", async () => {
        const written = await write(workload, {}, (s) => {
            s.maxActivationDuration = "PT2H";
            s.activationRequirement = "authenticationContext";
            s.authenticationContextId = "c1";
            s.requireJustificationOnActivation = false;
            s.requireTicketInfo = true;
            s.requireApproval = true;
            s.approvers = [{ id: USER_APPROVER.id, type: "user", displayName: USER_APPROVER.name }];
            s.customExtensions = {
                preApproval: { isEnabled: true, customExtensionId: "ext-pre", customAttributes: [] },
                postApproval: { isEnabled: true, customExtensionId: "ext-post", customAttributes: [] },
            };
            s.allowPermanentEligible = !s.allowPermanentEligible;
            s.eligibleExpiration = "P3M";
            s.allowPermanentActive = !s.allowPermanentActive;
            s.activeExpiration = "P15D";
            s.requireMfaOnActiveAssignment = true;
            s.requireJustificationOnActiveAssignment = false;
            for (const { section, recipient } of NOTIFICATION_CELLS) {
                const cell = notificationCell(s, section, recipient);
                cell.isEnabled = false;
                cell.criticalOnly = true;
            }
        });
        const ids = written.map((w) => w.ruleId).sort();
        expect(ids).toMatchSnapshot();
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids).not.toContain("Enablement_Admin_Eligibility");
    });
});
