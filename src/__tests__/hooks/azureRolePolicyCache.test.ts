import { beforeEach, describe, expect, it } from "vitest";
import { policyKey, readAzureRolePolicies, readAzureRolePolicy, readAzureRolePolicyPairs, resetAzureRolePolicies, settledPolicyFor } from "@/hooks/useAzureRolePolicy";
import type { ArmRoleManagementPolicy } from "@/types/azureResource.types";
import { graphRulesOf } from "@/utils/armPolicyRules";
import { noMfaSignalFor, privilegedRoleIds, type AzureRoleListRow } from "@/utils/azureRoleView";
import fixture from "@/__tests__/fixtures/azure/subscription-owner-policy.json";
import { armError, createRecordingArmClient } from "../support/recordingArmClient";

/**
 * The shared policy cache of the Azure Report (Azure spec 15.6): one read per role per scope across the settings
 * dialog, the configuration tab and the role list, and the "No MFA on activation" signal. Nothing here reaches ARM.
 */

const SUB = "/subscriptions/00000000-0000-0000-0000-000000000003";
const OWNER = "8e3af657-a8ff-443c-a75c-2fe8c4bcb635";
const CONTRIBUTOR = "b24988ac-6180-42a0-ab88-20f7382dd24c";
const POLICY = (fixture as { value: ArmRoleManagementPolicy[] }).value[0];

/** The fixture policy with the activation rules set to `enabledRules`, and the authentication context on or off */
function policyWith(enabledRules: string[], authContext = false): ArmRoleManagementPolicy {
    const rules = POLICY.properties.rules.map((rule) => {
        if (rule.id === "Enablement_EndUser_Assignment") return { ...rule, enabledRules };
        if (rule.id === "AuthenticationContext_EndUser_Assignment") return { ...rule, isEnabled: authContext, claimValue: authContext ? "c1" : undefined };
        return rule;
    });
    return { ...POLICY, properties: { ...POLICY.properties, rules, effectiveRules: rules } };
}

beforeEach(() => resetAzureRolePolicies());

describe("readAzureRolePolicy", () => {
    it("reads a role at a scope once", async () => {
        const arm = createRecordingArmClient([{ match: /roleManagementPolicies$/, respond: () => ({ body: fixture }) }]);
        expect((await readAzureRolePolicy(arm.client, SUB, OWNER)).status).toBe("loaded");
        expect((await readAzureRolePolicy(arm.client, SUB.toUpperCase(), OWNER.toUpperCase())).status).toBe("loaded");
        expect(arm.requests).toHaveLength(1);
    });

    it("keeps a role without a policy (400 ResourceNotFound) as missing", async () => {
        const arm = createRecordingArmClient([{ match: /roleManagementPolicies$/, respond: () => armError(400, "ResourceNotFound") }]);
        expect(await readAzureRolePolicy(arm.client, SUB, OWNER)).toEqual({ status: "missing" });
        expect(await readAzureRolePolicy(arm.client, SUB, OWNER)).toEqual({ status: "missing" });
        expect(arm.requests).toHaveLength(1);
    });

    it("does not call ARM at the root scope and keeps it as unavailable", async () => {
        const arm = createRecordingArmClient([{ match: /roleManagementPolicies$/, respond: () => ({ body: fixture }) }]);
        expect(await readAzureRolePolicy(arm.client, "/", OWNER)).toEqual({ status: "unavailable" });
        expect(await readAzureRolePolicy(arm.client, "/", OWNER)).toEqual({ status: "unavailable" });
        expect(arm.requests).toHaveLength(0);
    });

    it("still reads a subscription scope from ARM and keeps loaded and missing as before", async () => {
        const arm = createRecordingArmClient([{ match: /roleManagementPolicies$/, respond: () => ({ body: fixture }) }]);
        expect((await readAzureRolePolicy(arm.client, SUB, OWNER)).status).toBe("loaded");
        expect(arm.requests).toHaveLength(1);
        expect(arm.requests[0].path).toBe(`${SUB}/providers/Microsoft.Authorization/roleManagementPolicies`);
    });

    it("keeps no read access at the scope (403, or 400 InsufficientPermissions) as noAccess and does not ask again", async () => {
        for (const [status, code] of [[403, "AuthorizationFailed"], [400, "InsufficientPermissions"]] as const) {
            resetAzureRolePolicies();
            const arm = createRecordingArmClient([{ match: /roleManagementPolicies$/, respond: () => armError(status, code) }]);
            expect(await readAzureRolePolicy(arm.client, SUB, OWNER)).toEqual({ status: "noAccess" });
            expect(await readAzureRolePolicy(arm.client, SUB, OWNER)).toEqual({ status: "noAccess" });
            expect(arm.requests).toHaveLength(1);
        }
    });

    it("throws any other failure and does not keep it", async () => {
        const arm = createRecordingArmClient([{ match: /roleManagementPolicies$/, respond: () => armError(400, "InvalidFilter") }]);
        await expect(readAzureRolePolicy(arm.client, SUB, OWNER)).rejects.toThrow();
        arm.on({ match: /roleManagementPolicies$/, respond: () => ({ body: fixture }) });
        expect((await readAzureRolePolicy(arm.client, SUB, OWNER)).status).toBe("loaded");
    });
});

describe("readAzureRolePolicies", () => {
    it("keeps a role the user may not read at the scope as noAccess, without a worker failure, and does not ask again", async () => {
        const arm = createRecordingArmClient([{ match: /roleManagementPolicies$/, respond: () => armError(400, "InsufficientPermissions") }]);
        await readAzureRolePolicies(arm.client, SUB, [OWNER, CONTRIBUTOR]);
        expect(arm.requests).toHaveLength(2);
        expect(await readAzureRolePolicy(arm.client, SUB, OWNER)).toEqual({ status: "noAccess" });
        await readAzureRolePolicies(arm.client, SUB, [OWNER, CONTRIBUTOR]);
        expect(arm.requests).toHaveLength(2);
        // No signal without the rules: the list shows nothing for such a role
        expect(noMfaSignalFor(true, { status: "noAccess" })).toBeNull();
    });

    it("reads only the roles not read before, and goes on after a failure", async () => {
        const arm = createRecordingArmClient([
            { match: /roleManagementPolicies$/, respond: (request) => (String(request.query.$filter).includes(CONTRIBUTOR) ? armError(400, "InvalidFilter") : { body: fixture }) },
        ]);
        await readAzureRolePolicy(arm.client, SUB, OWNER);
        await readAzureRolePolicies(arm.client, SUB, [OWNER, CONTRIBUTOR]);
        expect(arm.requests).toHaveLength(2);
        expect(arm.requests[1].query.$filter).toContain(CONTRIBUTOR);
        // The failed role is asked again next time; the read one is not
        await readAzureRolePolicies(arm.client, SUB, [OWNER, CONTRIBUTOR]);
        expect(arm.requests).toHaveLength(3);
    });
});

describe("lastModified", () => {
    it("is the policy's lastModifiedDateTime, or null for a policy never written", async () => {
        const written = { ...POLICY, properties: { ...POLICY.properties, lastModifiedDateTime: "2026-10-22T08:15:00Z" } };
        const never = { ...POLICY, properties: { ...POLICY.properties, lastModifiedDateTime: null } };
        const arm = createRecordingArmClient([
            { match: /roleManagementPolicies$/, respond: (request) => ({ body: { value: [String(request.query.$filter).includes(OWNER) ? written : never] } }) },
        ]);
        expect(await readAzureRolePolicy(arm.client, SUB, OWNER)).toMatchObject({ status: "loaded", lastModified: "2026-10-22T08:15:00Z" });
        expect(await readAzureRolePolicy(arm.client, SUB, CONTRIBUTOR)).toMatchObject({ status: "loaded", lastModified: null });
    });
});

describe("readAzureRolePolicyPairs", () => {
    const RG = `${SUB}/resourceGroups/rg-web`;

    it("reads each pair once, skips what was read, sends nothing for root, and reports progress", async () => {
        const arm = createRecordingArmClient([{ match: /roleManagementPolicies$/, respond: () => ({ body: fixture }) }]);
        await readAzureRolePolicy(arm.client, SUB, OWNER);
        const progress: Array<[number, number]> = [];
        const outcomes = await readAzureRolePolicyPairs(arm.client, [
            { scopeId: SUB, roleDefinitionId: OWNER },
            { scopeId: RG, roleDefinitionId: OWNER },
            { scopeId: RG.toUpperCase(), roleDefinitionId: OWNER },
            { scopeId: "/", roleDefinitionId: OWNER },
        ], { onProgress: (done, total) => progress.push([done, total]) });
        // One request before, one for the resource group; the duplicate in other casing and root send nothing
        expect(arm.requests).toHaveLength(2);
        expect(arm.requests[1].path).toBe(`${RG}/providers/Microsoft.Authorization/roleManagementPolicies`);
        expect(outcomes.get(policyKey(RG, OWNER))?.status).toBe("loaded");
        expect(outcomes.get(policyKey("/", OWNER))).toEqual({ status: "unavailable" });
        expect(outcomes.size).toBe(3);
        expect(progress).toEqual([[0, 1], [1, 1]]);
        expect(settledPolicyFor(RG, OWNER)?.status).toBe("loaded");
    });

    it("gives failed for a pair whose read fails, keeps the others, and asks for it again next time", async () => {
        const arm = createRecordingArmClient([
            { match: /roleManagementPolicies$/, respond: (request) => (String(request.query.$filter).includes(CONTRIBUTOR) ? armError(400, "InvalidFilter") : { body: fixture }) },
        ]);
        const pairs = [{ scopeId: SUB, roleDefinitionId: OWNER }, { scopeId: SUB, roleDefinitionId: CONTRIBUTOR }];
        const first = await readAzureRolePolicyPairs(arm.client, pairs);
        expect(first.get(policyKey(SUB, OWNER))?.status).toBe("loaded");
        expect(first.get(policyKey(SUB, CONTRIBUTOR))).toEqual({ status: "failed" });
        expect(settledPolicyFor(SUB, CONTRIBUTOR)).toBeUndefined();
        await readAzureRolePolicyPairs(arm.client, pairs);
        expect(arm.requests).toHaveLength(3);
    });

    it("keeps no access and a missing policy as their own outcome", async () => {
        const arm = createRecordingArmClient([
            { match: /roleManagementPolicies$/, respond: (request) => (String(request.query.$filter).includes(CONTRIBUTOR) ? armError(400, "ResourceNotFound") : armError(403, "AuthorizationFailed")) },
        ]);
        const outcomes = await readAzureRolePolicyPairs(arm.client, [{ scopeId: SUB, roleDefinitionId: OWNER }, { scopeId: SUB, roleDefinitionId: CONTRIBUTOR }]);
        expect(outcomes.get(policyKey(SUB, OWNER))).toEqual({ status: "noAccess" });
        expect(outcomes.get(policyKey(SUB, CONTRIBUTOR))).toEqual({ status: "missing" });
    });
});

describe("noMfaSignalFor", () => {
    const loaded = (policy: ArmRoleManagementPolicy) => ({ status: "loaded", rules: graphRulesOf(policy) });

    it("is true for a privileged role whose activation asks for neither MFA nor an authentication context", () => {
        expect(noMfaSignalFor(true, loaded(policyWith(["Justification"])))).toBe(true);
    });

    it("is false with MFA or an authentication context, and for a role that is not privileged", () => {
        expect(noMfaSignalFor(true, loaded(policyWith(["MultiFactorAuthentication", "Justification"])))).toBe(false);
        expect(noMfaSignalFor(true, loaded(policyWith(["Justification"], true)))).toBe(false);
        expect(noMfaSignalFor(false, loaded(policyWith([])))).toBe(false);
    });

    it("is null while not known, without a policy or after a failure", () => {
        expect(noMfaSignalFor(true, undefined)).toBeNull();
        expect(noMfaSignalFor(true, { status: "missing" })).toBeNull();
        expect(noMfaSignalFor(true, { status: "failed" })).toBeNull();
    });

    it("asks only for the privileged roles of the list", () => {
        const row = (id: string, isPrivileged: boolean): AzureRoleListRow => ({ id, name: id, isPrivileged, isCustom: false, eligible: 1, active: 0, permanent: 0, hasPermanentActive: false, hasNoMfaSignal: null });
        expect(privilegedRoleIds([row(OWNER, true), row("reader", false), row(CONTRIBUTOR, true)])).toEqual([OWNER, CONTRIBUTOR]);
    });
});
