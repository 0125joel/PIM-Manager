import { describe, expect, it } from "vitest";
import type { AzureAssignment, AzureScope } from "@/types/azureResource.types";
import { buildAzureReadability, partlyNote, readabilitySentence, unreadSentence, type AzureReadability } from "@/utils/azureReadability";
import { azurePolicyKey } from "@/utils/azureScopes";

const OWNER = "8e3af657-a8ff-443c-a75c-2fe8c4bcb635";
const READER = "acdd72a7-3385-48ef-bd42-f606fba81ae7";
const OWNER_ID = OWNER;
const READER_ID = READER;

function sub(n: number, over: Partial<AzureScope> = {}): AzureScope {
    return { id: `/subscriptions/s${n}`, name: `Sub ${n}`, level: "subscription", parentId: null, tenantId: "t-home", ...over };
}

function a(id: string, scopeId: string, roleDefinitionId: string, roleName = "Owner"): AzureAssignment {
    return { id, scopeId, roleDefinitionId, roleName, principalId: `p-${id}`, principalName: id, principalType: "User", state: "active", memberType: "direct", endDateTime: null };
}

function readable(scopes: AzureScope[], over: Partial<Parameters<typeof buildAzureReadability>[0]> = {}): AzureReadability {
    return buildAzureReadability({ scopes, assignments: [], definitions: null, settings: new Map(), homeTenantId: "t-home", includeDelegated: true, ...over });
}

describe("readabilitySentence", () => {
    it("says all subscriptions are readable when every one is whole", () => {
        const r = readable([sub(1), sub(2), sub(3)]);
        const s = readabilitySentence(r);
        expect(s.first).toBe("You can read 3 of 3 subscriptions completely.");
        expect(s.second).toBeNull();
        expect(s.hasDetails).toBe(false);
    });

    it("names the partial subscriptions and the resource groups in the second sentence", () => {
        const scopes = [sub(1), sub(2), sub(3), sub(4), sub(5, { access: "partial" })];
        const s = readabilitySentence(readable(scopes));
        expect(s.first).toBe("You can read 4 of 5 subscriptions completely, and 1 in part.");
        expect(s.second).toBe("Not everything below is readable for you: some resource groups.");
    });

    it("adds the failed subscriptions to the first sentence and shows the button", () => {
        const scopes = [sub(1), sub(2), sub(3, { access: "failed" })];
        const s = readabilitySentence(readable(scopes));
        expect(s.first.endsWith(" 1 could not be read.")).toBe(true);
        expect(s.first).toBe("You can read 2 of 3 subscriptions completely. 1 could not be read.");
        expect(s.second).toBeNull();
        expect(s.hasDetails).toBe(true);
    });

    it("uses the singular for one subscription", () => {
        expect(readabilitySentence(readable([sub(1)])).first).toBe("You can read 1 of 1 subscription completely.");
    });

    it("joins a partial subscription and a not readable setting in the second sentence", () => {
        const scopes = [sub(1), sub(2, { access: "partial" })];
        const assignments = [a("own", "/subscriptions/s1", OWNER_ID)];
        const settings = new Map([[azurePolicyKey("/subscriptions/s1", OWNER_ID), { status: "noAccess" }]]);
        const s = readabilitySentence(readable(scopes, { assignments, settings }));
        expect(s.second).toBe("Not everything below is readable for you: some resource groups, and the settings of 1 privileged role × scope.");
    });
});

describe("buildAzureReadability", () => {
    it("leaves a delegated subscription out when delegated subscriptions are off", () => {
        const scopes = [sub(1), sub(2, { tenantId: "t-other" })];
        expect(readable(scopes, { includeDelegated: false }).subscriptions.map((x) => x.id)).toEqual(["/subscriptions/s1"]);
        expect(readable(scopes, { includeDelegated: true }).subscriptions).toHaveLength(2);
    });

    it("reports an Owner assignment at the root as one not readable setting named Root", () => {
        const r = readable([sub(1)], { assignments: [a("root", "/", OWNER_ID)] });
        expect(r.notReadableSettings).toHaveLength(1);
        expect(r.notReadableSettings[0]?.scopeName).toBe("Root");
    });

    it("counts one not readable setting for two assignments of the same role and scope", () => {
        const scope = "/subscriptions/s1";
        const assignments = [a("own-1", scope, OWNER_ID), a("own-2", scope, OWNER_ID)];
        const settings = new Map([[azurePolicyKey(scope, OWNER_ID), { status: "noAccess" }]]);
        const r = readable([sub(1)], { assignments, settings });
        expect(r.notReadableSettings).toHaveLength(1);
    });

    it("ignores a setting that is readable and a role that is not privileged", () => {
        const scope = "/subscriptions/s1";
        const assignments = [a("own", scope, OWNER_ID), a("read", scope, READER_ID, "Reader")];
        const settings = new Map([[azurePolicyKey(scope, OWNER_ID), { status: "loaded" }], [azurePolicyKey(scope, READER_ID), { status: "noAccess" }]]);
        expect(readable([sub(1)], { assignments, settings }).notReadableSettings).toHaveLength(0);
    });
});

describe("what is not read yet", () => {
    const rgs = (n: number) => Array.from({ length: n }, (_, i) => `/subscriptions/s5/resourceGroups/rg-${i}`);

    it("counts the unread resource groups and resources of the subscriptions in view, and they stay in part", () => {
        const scopes = [sub(1), sub(2), sub(3), sub(4, { access: "partial", unreadScopeIds: rgs(300) }), sub(5, { access: "partial", unreadScopeIds: rgs(40), tenantId: "t-other" })];
        const all = readable(scopes);
        expect(all.unread).toBe(340);
        expect(all.partial).toBe(2);
        expect(all.whole).toBe(3);
        expect(readabilitySentence(all).first).toBe("You can read 3 of 5 subscriptions completely, and 2 in part.");
        expect(unreadSentence(all)).toBe("340 resource groups and resources are not read yet.");
        // Delegated subscriptions off: the delegated one and what it has left are out of every number
        expect(readable(scopes, { includeDelegated: false }).unread).toBe(300);
    });

    it("says nothing when everything readable was read", () => {
        expect(unreadSentence(readable([sub(1), sub(2, { access: "partial" })]))).toBeNull();
    });

    it("uses the singular, and names subscriptions that are not listed yet", () => {
        expect(unreadSentence({ unread: 1, unlisted: 0 })).toBe("1 resource group or resource is not read yet.");
        expect(unreadSentence({ unread: 12, unlisted: 1 })).toBe("12 resource groups and resources are not read yet, and those of 1 more subscription.");
        expect(unreadSentence({ unread: 0, unlisted: 2 })).toBe("The resource groups and resources of 2 subscriptions are not read yet.");
        expect(readable([sub(1, { access: "partial", isUnlisted: true })]).unlisted).toBe(1);
    });

    it("adds the count to the note of a subscription read in part", () => {
        expect(partlyNote({ unread: 0, isUnlisted: false })).toBe("Only the resource groups and resources you can read are counted.");
        expect(partlyNote({ unread: 120, isUnlisted: false })).toBe("Only the resource groups and resources you can read are counted; 120 are not read yet.");
        expect(partlyNote({ unread: 1, isUnlisted: false })).toBe("Only the resource groups and resources you can read are counted; 1 is not read yet.");
        expect(partlyNote({ unread: 0, isUnlisted: true })).toBe("Only the resource groups and resources you can read are counted; they are not read yet.");
    });
});
