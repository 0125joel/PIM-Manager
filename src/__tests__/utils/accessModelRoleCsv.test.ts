import { describe, expect, it } from "vitest";
import bundledCatalog from "@/config/accessModel/eam-catalog.json";
import { parseAccessModelCatalog, type AccessModelCatalog } from "@/utils/accessModelCatalog";
import { buildRoleCsv, buildRoleCsvRows, roleCsvRow } from "@/utils/accessModelRoleCsv";
import { readImportFile } from "@/utils/importDetect";
import type { RoleDetailData } from "@/types/directoryRole.types";

const parsed = parseAccessModelCatalog(bundledCatalog);
if (!parsed.ok) throw new Error("the bundled catalog must parse");
const catalog: AccessModelCatalog = parsed.catalog;

/** A tenant role with only the fields the CSV reads */
function roleOf(id: string, displayName: string, templateId: string): RoleDetailData {
    return { definition: { id, displayName, templateId } } as unknown as RoleDetailData;
}

const noContext = () => null;
const context = (slug: string) => (slug === "phish-resistant-sif" ? "c1" : null);

describe("roleCsvRow", () => {
    it("writes the duration, the requirement with its context and the flags, and leaves the rest empty", () => {
        const row = roleCsvRow(roleOf("r1", "Helpdesk", "t1"), { maxActivationDuration: "PT4H", authContext: "phish-resistant-sif", requireApproval: true, allowPermanentEligible: false }, context);
        expect(row).toEqual({
            roleId: "r1",
            roleName: "Helpdesk",
            maxActivationDuration: "PT4H",
            requireOnActivation: "authenticationContext",
            authContextId: "c1",
            approvalRequired: true,
            allowPermanentEligible: false,
        });
    });

    it("writes MFA as the requirement, and no context id", () => {
        const row = roleCsvRow(roleOf("r1", "Helpdesk", "t1"), { requireMFA: true }, noContext);
        expect(row).toMatchObject({ requireOnActivation: "mfa" });
        expect(row).not.toHaveProperty("authContextId");
    });

    it("leaves a label without a context out of the row, so the current requirement is kept", () => {
        const row = roleCsvRow(roleOf("r1", "Helpdesk", "t1"), { authContext: "standard-mfa", maxActivationDuration: "PT8H" }, noContext);
        expect(row).toEqual({ roleId: "r1", roleName: "Helpdesk", maxActivationDuration: "PT8H" });
    });

    it("returns null for a role the catalog says nothing about", () => {
        expect(roleCsvRow(roleOf("r1", "Helpdesk", "t1"), {}, noContext)).toBeNull();
    });
});

describe("buildRoleCsvRows", () => {
    it("takes only the tenant's roles that the catalog has, matched by template id", () => {
        const first = catalog.roles[0];
        const rows = buildRoleCsvRows({
            catalog,
            roles: [roleOf("tenant-1", "Matched", first.templateId), roleOf("tenant-2", "Not in catalog", "not-a-template")],
            resolveContext: noContext,
        });
        expect(rows.map((r) => r.roleId)).toEqual(["tenant-1"]);
    });
});

describe("round trip through Import a file", () => {
    it("reads the file back as Role settings with the recommended values", () => {
        const first = catalog.roles[0];
        const rows = buildRoleCsvRows({
            catalog,
            roles: [roleOf("tenant-1", "Matched", first.templateId)],
            resolveContext: context,
        });
        const csv = buildRoleCsv(rows, ["# Recommended role settings for Contoso"]);
        const file = readImportFile(csv, "pim-manager-access-model-roles-contoso-2026-10-20.csv");
        expect(file.kind).toBe("rolePolicies");
        expect(file.csv?.errors).toEqual([]);
        expect(file.csv?.rows).toHaveLength(rows.length);
        expect(file.csv?.rows[0].roleId).toBe("tenant-1");
    });
});
