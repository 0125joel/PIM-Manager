import { describe, expect, it } from "vitest";
import { loginRequest } from "@/config/authConfig";
import { ALERTS_PERMISSION, CUSTOM_EXTENSION_SCOPES } from "@/config/constants";
import { WORKLOAD_SCOPES, WORKLOAD_WRITE_SCOPES } from "@/hooks/useIncrementalConsent";
import { PERMISSION_PURPOSES, buildPermissionCatalog } from "@/utils/permissionCatalog";

const sources = {
    signIn: loginRequest.scopes,
    optional: [
        { feature: "PIM for Groups", scopes: WORKLOAD_SCOPES.pimGroups },
        { feature: "Security alerts", scopes: [ALERTS_PERMISSION] },
        { feature: "Custom extensions", scopes: [CUSTOM_EXTENSION_SCOPES.read] },
    ],
    write: [
        { workload: "Directory roles", scopes: WORKLOAD_WRITE_SCOPES.directoryRoles },
        { workload: "PIM for Groups", scopes: WORKLOAD_WRITE_SCOPES.pimGroups },
    ],
};

describe("buildPermissionCatalog", () => {
    it("lists every scope the app requests, each with its purpose", () => {
        const catalog = buildPermissionCatalog(sources);
        const listed = catalog.flatMap((g) => g.items.map((i) => i.scope));
        for (const scope of [...sources.signIn, ...sources.optional.flatMap((o) => o.scopes), ...sources.write.flatMap((w) => w.scopes)]) {
            expect(listed).toContain(scope);
            expect(PERMISSION_PURPOSES[scope], `purpose for ${scope}`).toBeDefined();
        }
    });

    it("keeps the three groups apart and names the feature or workload", () => {
        const [signIn, optional, write] = buildPermissionCatalog(sources);
        expect(signIn.items.map((i) => i.scope)).toEqual(loginRequest.scopes);
        expect(optional.items.find((i) => i.scope === ALERTS_PERMISSION)?.purpose).toBe("Security alerts: PIM's own security alerts");
        expect(write.items.every((i) => i.scope.includes("ReadWrite"))).toBe(true);
    });
});
