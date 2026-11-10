import { describe, it, expect } from "vitest";
import { ICON_DATA } from "@/components/icons/iconData";
import { RESOURCE_ICONS, resourceIconFor, scopeIconFor } from "@/utils/azureResourceIcons";

describe("RESOURCE_ICONS", () => {
    it("has 20 resource types", () => {
        expect(Object.keys(RESOURCE_ICONS)).toHaveLength(20);
    });

    it("gives every type an icon in the set", () => {
        for (const value of Object.values(RESOURCE_ICONS)) {
            expect(value.icon in ICON_DATA).toBe(true);
        }
    });

    it("uses every resource icon file of the set", () => {
        const used = [...Object.values(RESOURCE_ICONS).map((value) => value.icon), "resource"].sort();
        const files = Object.keys(ICON_DATA).filter((name) => name === "resource" || name.startsWith("resource-")).sort();
        expect(used).toEqual(files);
    });
});

describe("resourceIconFor", () => {
    it.each([
        ["Microsoft.KeyVault/vaults", { icon: "resource-key-vault", label: "Key vault" }],
        ["microsoft.keyvault/VAULTS", { icon: "resource-key-vault", label: "Key vault" }],
        ["Microsoft.Sql/servers", { icon: "resource-sql-server", label: "SQL server" }],
        ["Microsoft.Sql/servers/databases", { icon: "resource-sql-database", label: "SQL database" }],
        ["Microsoft.Web/sites", { icon: "resource-app-service", label: "App Service" }],
        ["Microsoft.Storage/storageAccounts", { icon: "resource-storage", label: "Storage account" }],
    ])("known type %s", (type, expected) => {
        expect(resourceIconFor(type)).toEqual(expected);
    });

    it.each([
        ["Microsoft.Cdn/profiles", { icon: "resource", label: "Microsoft.Cdn/profiles" }],
        ["Microsoft.Sql/servers/elasticPools", { icon: "resource", label: "Microsoft.Sql/servers/elasticPools" }],
        [undefined, { icon: "resource", label: "Resource" }],
        ["", { icon: "resource", label: "Resource" }],
    ])("fallback for %s", (type, expected) => {
        expect(resourceIconFor(type)).toEqual(expected);
    });
});

describe("scopeIconFor", () => {
    it.each([
        [{ level: "root" }, "tenant"],
        [{ level: "managementGroup" }, "layers"],
        [{ level: "subscription" }, "key"],
        [{ level: "resourceGroup" }, "admin-unit"],
        [{ level: "resource", resourceType: "Microsoft.Compute/virtualMachines" }, "resource-vm"],
        [{ level: "resource", resourceType: "Microsoft.Cdn/profiles" }, "resource"],
        [{ level: "resource" }, "resource"],
    ] as const)("level of %o", (scope, expected) => {
        expect(scopeIconFor(scope)).toBe(expected);
    });
});
