import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getRolePolicy } from "@/services/azurePolicyService";
import { ArmError, createArmClient } from "@/utils/armClient";
import { RateLimiter } from "@/utils/rateLimiter";
import { parseArmPolicy } from "@/utils/armPolicyRules";
import { AZURE_ROLES, AZURE_SCOPE_IDS, buildContosoAzure } from "@/demo/contoso/azure";
import { createFakeArm } from "@/demo/arm/server";
import { createDemoFetch } from "@/demo/runtime/fetch";
import fixture from "@/__tests__/fixtures/azure/subscription-owner-policy.json";
import { armError, createRecordingArmClient } from "../support/recordingArmClient";

/**
 * The role policy service (Azure spec 4 and 6) against the recording ARM client: the golden URL with the
 * `roleDefinitionId` filter at `2020-10-01`, a role without a policy that throws, and no write. Then the same read
 * against the demo's fake ARM. Nothing here reaches ARM.
 */

const SUB = "/subscriptions/00000000-0000-0000-0000-000000000003";
const OWNER = "8e3af657-a8ff-443c-a75c-2fe8c4bcb635";
const AUTH = "/providers/Microsoft.Authorization";

describe("getRolePolicy", () => {
    it("asks for one role's policy at the scope, filtered by the scope-qualified role id", async () => {
        const arm = createRecordingArmClient([{ match: /roleManagementPolicies$/, respond: () => ({ body: fixture }) }]);
        const policy = await getRolePolicy(arm.client, SUB, OWNER);

        expect(arm.requests).toHaveLength(1);
        expect(arm.requests[0].method).toBe("GET");
        expect(arm.requests[0].url).toBe(
            `https://management.azure.com${SUB}${AUTH}/roleManagementPolicies?api-version=2020-10-01&$filter=${encodeURIComponent(`roleDefinitionId eq '${SUB}${AUTH}/roleDefinitions/${OWNER}'`)}`
        );
        expect(policy?.name).toBe(OWNER);
        expect(policy?.properties.rules).toHaveLength(17);
    });

    it("has no prefix for the root scope", async () => {
        const arm = createRecordingArmClient([{ match: /roleManagementPolicies$/, respond: () => ({ body: { value: [] } }) }]);
        await getRolePolicy(arm.client, "/", OWNER);
        expect(arm.requests[0].path).toBe(`${AUTH}/roleManagementPolicies`);
        expect(arm.requests[0].query.$filter).toBe(`roleDefinitionId eq '${AUTH}/roleDefinitions/${OWNER}'`);
    });

    it("doubles a quote in the filter value, so it cannot end the string literal", async () => {
        const arm = createRecordingArmClient([{ match: /roleManagementPolicies$/, respond: () => ({ body: { value: [] } }) }]);
        await getRolePolicy(arm.client, SUB, "x' or name ne '");
        expect(arm.requests[0].query.$filter).toBe(`roleDefinitionId eq '${SUB}${AUTH}/roleDefinitions/x'' or name ne '''`);
    });

    it("gives null for an empty list", async () => {
        const arm = createRecordingArmClient([{ match: /roleManagementPolicies$/, respond: () => ({ body: { value: [] } }) }]);
        expect(await getRolePolicy(arm.client, SUB, OWNER)).toBeNull();
    });

    it("throws ResourceNotFound for a role without a policy at the scope, without a retry", async () => {
        const arm = createRecordingArmClient([{ match: /roleManagementPolicies$/, respond: () => armError(400, "ResourceNotFound", "The resource is not found.") }]);
        const failure = await getRolePolicy(arm.client, `${SUB}/resourceGroups/rg-web`, OWNER).catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(ArmError);
        expect((failure as ArmError).code).toBe("ResourceNotFound");
        expect(arm.requests).toHaveLength(1);
    });
});

describe("getRolePolicy against the demo's fake ARM", () => {
    const azure = buildContosoAzure(new Date());
    const realFetch = vi.fn<typeof fetch>(() => Promise.reject(new Error("network")));
    const client = createArmClient(() => Promise.resolve("demo-token"), { limiter: new RateLimiter(1000, 1000) });

    beforeAll(() => {
        const arm = createFakeArm(azure);
        vi.stubGlobal("fetch", createDemoFetch({ graph: () => Promise.reject(new Error("no Graph in this test")), arm: async () => arm, realFetch }));
    });
    afterAll(() => {
        vi.unstubAllGlobals();
        expect(realFetch).not.toHaveBeenCalled();
    });

    it("reads the changed Owner settings on production: MFA on activation, 8 hours", async () => {
        const policy = await getRolePolicy(client, AZURE_SCOPE_IDS.production, AZURE_ROLES.owner.id);
        expect(policy).not.toBeNull();
        expect(parseArmPolicy(policy!)).toMatchObject({ maxActivationDuration: "PT8H", activationRequirement: "mfa", requireJustificationOnActivation: true, requireApproval: false });
    });

    it("reads the Owner approvers on the platform management group", async () => {
        const policy = await getRolePolicy(client, AZURE_SCOPE_IDS.platform, AZURE_ROLES.owner.id);
        const settings = parseArmPolicy(policy!);
        expect(settings).toMatchObject({ maxActivationDuration: "PT4H", requireApproval: true });
        expect(settings.approvers).toEqual([expect.objectContaining({ type: "group", displayName: "Security Leads" })]);
    });
});
