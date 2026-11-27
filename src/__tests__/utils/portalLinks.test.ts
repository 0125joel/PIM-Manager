import { describe, expect, it } from "vitest";
import { getAzurePrincipalUrl, getAzureScopeUrl, getEntraAppUrl, getEntraUserUrl, getPrincipalUrl } from "@/utils/portalLinks";

const ID = "00000000-0000-0000-0000-00000000aaaa";
const APP_ID = "00000000-0000-0000-0000-00000000bbbb";

describe("Entra links", () => {
    it("gives the user profile URL for an object id", () => {
        expect(getEntraUserUrl(ID)).toBe(`https://entra.microsoft.com/#view/Microsoft_AAD_UsersAndTenants/UserProfileMenuBlade/~/overview/userId/${ID}`);
    });

    it("gives the application URL with both the object id and the appId", () => {
        expect(getEntraAppUrl(ID, APP_ID)).toBe(`https://entra.microsoft.com/#view/Microsoft_AAD_IAM/ManagedAppMenuBlade/~/Overview/objectId/${ID}/appId/${APP_ID}`);
    });

    it("gives the group URL for a group", () => {
        expect(getPrincipalUrl({ kind: "group", id: ID })).toContain(`/GroupDetailsMenuBlade/~/Overview/groupId/${ID}`);
    });

    it("gives the user URL for a user and a guest", () => {
        expect(getPrincipalUrl({ kind: "user", id: ID })).toBe(getEntraUserUrl(ID));
        expect(getPrincipalUrl({ kind: "guest", id: ID })).toBe(getEntraUserUrl(ID));
    });

    it("gives null for an app without an appId", () => {
        expect(getPrincipalUrl({ kind: "app", id: ID })).toBeNull();
        expect(getPrincipalUrl({ kind: "app", id: ID, appId: "" })).toBeNull();
    });

    it("gives the app URL for an app with an appId", () => {
        expect(getPrincipalUrl({ kind: "app", id: ID, appId: APP_ID })).toBe(getEntraAppUrl(ID, APP_ID));
    });

    it("gives null for agent objects, managed identities and an empty id", () => {
        expect(getPrincipalUrl({ kind: "agentIdentity", id: ID })).toBeNull();
        expect(getPrincipalUrl({ kind: "agentUser", id: ID })).toBeNull();
        expect(getPrincipalUrl({ kind: "agentBlueprint", id: ID })).toBeNull();
        expect(getPrincipalUrl({ kind: "user", id: "" })).toBeNull();
    });
});

describe("Azure scope links", () => {
    it("keeps the path of a management group", () => {
        expect(getAzureScopeUrl("/providers/Microsoft.Management/managementGroups/mg-1")).toBe("https://portal.azure.com/#@/resource/providers/Microsoft.Management/managementGroups/mg-1");
    });

    it("keeps the path of a resource", () => {
        expect(getAzureScopeUrl("/subscriptions/sub/resourceGroups/rg/providers/Microsoft.KeyVault/vaults/kv")).toBe("https://portal.azure.com/#@/resource/subscriptions/sub/resourceGroups/rg/providers/Microsoft.KeyVault/vaults/kv");
    });

    it("gives null for the root scope and an empty id", () => {
        expect(getAzureScopeUrl("/")).toBeNull();
        expect(getAzureScopeUrl("")).toBeNull();
    });
});

describe("Azure principal links", () => {
    const types = new Map([[ID, "Application"], [APP_ID, "ManagedIdentity"]]);
    const appIds = new Map([[ID, APP_ID]]);

    it("links a user and a group", () => {
        expect(getAzurePrincipalUrl("User", ID)).toBe(getEntraUserUrl(ID));
        expect(getAzurePrincipalUrl("Group", ID)).toContain(`groupId/${ID}`);
    });

    it("links a service principal of type Application when its appId is known", () => {
        expect(getAzurePrincipalUrl("ServicePrincipal", ID.toUpperCase(), types, appIds)).toBe(getEntraAppUrl(ID.toUpperCase(), APP_ID));
    });

    it("gives null for a managed identity, a service principal without an appId and an unknown type", () => {
        expect(getAzurePrincipalUrl("ServicePrincipal", APP_ID, types, appIds)).toBeNull();
        expect(getAzurePrincipalUrl("ServicePrincipal", ID, types, null)).toBeNull();
        expect(getAzurePrincipalUrl("ServicePrincipal", ID, null, appIds)).toBeNull();
        expect(getAzurePrincipalUrl("Unknown", ID)).toBeNull();
    });
});
