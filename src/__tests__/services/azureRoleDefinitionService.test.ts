import { beforeEach, describe, expect, it } from "vitest";
import { getRoleDefinition } from "@/services/azureRoleDefinitionService";
import { readAzureRoleDescription, resetAzureRoleDescriptions } from "@/hooks/useAzureRoleDefinition";
import { ArmError } from "@/utils/armClient";
import { armError, createRecordingArmClient } from "../support/recordingArmClient";

/**
 * The role definition read of the Azure role view (Azure spec 15.4) against the recording ARM client: the URL and
 * api-version of Learn, and the description read once per role GUID. Nothing here reaches ARM.
 */

const ARM = "https://management.azure.com";
const AUTH = "/providers/Microsoft.Authorization";
const OWNER = "8e3af657-a8ff-443c-a75c-2fe8c4bcb635";
const SUB = "/subscriptions/00000000-0000-0000-0000-000000000003";

const definition = (description?: string) => ({
    id: `${SUB}${AUTH}/roleDefinitions/${OWNER}`,
    name: OWNER,
    type: "Microsoft.Authorization/roleDefinitions",
    properties: { roleName: "Owner", type: "BuiltInRole", ...(description === undefined ? {} : { description }) },
});

beforeEach(() => resetAzureRoleDescriptions());

describe("getRoleDefinition", () => {
    it("reads one role by GUID at the scope, at 2022-04-01", async () => {
        const arm = createRecordingArmClient([{ match: /roleDefinitions\//, respond: () => ({ body: definition("Grants full access.") }) }]);
        const result = await getRoleDefinition(arm.client, SUB, OWNER);
        expect(arm.requests.map((r) => r.url)).toEqual([`${ARM}${SUB}${AUTH}/roleDefinitions/${OWNER}?api-version=2022-04-01`]);
        expect(result.properties.description).toBe("Grants full access.");
    });

    it("reads at root without a scope prefix", async () => {
        const arm = createRecordingArmClient([{ match: /roleDefinitions\//, respond: () => ({ body: definition() }) }]);
        await getRoleDefinition(arm.client, "/", OWNER);
        expect(arm.requests[0].url).toBe(`${ARM}${AUTH}/roleDefinitions/${OWNER}?api-version=2022-04-01`);
    });

    it("throws a failed read", async () => {
        const arm = createRecordingArmClient([{ match: /roleDefinitions\//, respond: () => armError(403, "AuthorizationFailed") }]);
        await expect(getRoleDefinition(arm.client, SUB, OWNER)).rejects.toBeInstanceOf(ArmError);
    });
});

describe("readAzureRoleDescription", () => {
    it("reads a role once, whatever the scope or the case of the GUID", async () => {
        const arm = createRecordingArmClient([{ match: /roleDefinitions\//, respond: () => ({ body: definition("  Grants full access.  ") }) }]);
        expect(await readAzureRoleDescription(arm.client, SUB, OWNER)).toBe("Grants full access.");
        expect(await readAzureRoleDescription(arm.client, `${SUB}/resourceGroups/rg-a`, OWNER.toUpperCase())).toBe("Grants full access.");
        expect(arm.requests).toHaveLength(1);
    });

    it("gives null for a role without a description", async () => {
        const arm = createRecordingArmClient([{ match: /roleDefinitions\//, respond: () => ({ body: definition("") }) }]);
        expect(await readAzureRoleDescription(arm.client, SUB, OWNER)).toBeNull();
    });

    it("gives null after a failure and does not read again", async () => {
        const arm = createRecordingArmClient([{ match: /roleDefinitions\//, respond: () => armError(403, "AuthorizationFailed") }]);
        expect(await readAzureRoleDescription(arm.client, SUB, OWNER)).toBeNull();
        expect(await readAzureRoleDescription(arm.client, SUB, OWNER)).toBeNull();
        expect(arm.requests).toHaveLength(1);
    });
});
