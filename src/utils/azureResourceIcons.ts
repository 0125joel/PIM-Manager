import type { IconName } from "@/components/icons/Icon";
import type { AzureScope } from "@/types/azureResource.types";

/**
 * Maps an Azure scope level or an ARM resource type to an icon name and an English label.
 * The resource icons come from `docs/Assets/icons/resource-*.svg`; any other type falls back to `resource`.
 */

export interface ResourceIcon {
    icon: IconName;
    label: string;
}

/** The resource types with their own icon, keyed by the ARM type as Microsoft writes it */
export const RESOURCE_ICONS: Readonly<Record<string, ResourceIcon>> = {
    "Microsoft.Storage/storageAccounts": { icon: "resource-storage", label: "Storage account" },
    "Microsoft.KeyVault/vaults": { icon: "resource-key-vault", label: "Key vault" },
    "Microsoft.Web/sites": { icon: "resource-app-service", label: "App Service" },
    "Microsoft.Web/serverfarms": { icon: "resource-app-plan", label: "App Service plan" },
    "Microsoft.Compute/virtualMachines": { icon: "resource-vm", label: "Virtual machine" },
    "Microsoft.Network/virtualNetworks": { icon: "resource-vnet", label: "Virtual network" },
    "Microsoft.Network/networkSecurityGroups": { icon: "resource-nsg", label: "Network security group" },
    "Microsoft.Network/publicIPAddresses": { icon: "resource-public-ip", label: "Public IP address" },
    "Microsoft.Network/networkInterfaces": { icon: "resource-nic", label: "Network interface" },
    "Microsoft.Network/loadBalancers": { icon: "resource-lb", label: "Load balancer" },
    "Microsoft.Network/applicationGateways": { icon: "resource-app-gateway", label: "Application gateway" },
    "Microsoft.Sql/servers": { icon: "resource-sql-server", label: "SQL server" },
    "Microsoft.Sql/servers/databases": { icon: "resource-sql-database", label: "SQL database" },
    "Microsoft.DocumentDB/databaseAccounts": { icon: "resource-cosmos", label: "Azure Cosmos DB account" },
    "Microsoft.ContainerService/managedClusters": { icon: "resource-aks", label: "Kubernetes service" },
    "Microsoft.ContainerRegistry/registries": { icon: "resource-acr", label: "Container registry" },
    "Microsoft.OperationalInsights/workspaces": { icon: "resource-log-analytics", label: "Log Analytics workspace" },
    "Microsoft.Insights/components": { icon: "resource-app-insights", label: "Application Insights" },
    "Microsoft.Logic/workflows": { icon: "resource-logic-app", label: "Logic app" },
    "Microsoft.Automation/automationAccounts": { icon: "resource-automation", label: "Automation account" },
};

/** Lowercased ARM type to its entry, built once: ARM types are case-insensitive */
const RESOURCE_ICONS_BY_LOWER_TYPE: ReadonlyMap<string, ResourceIcon> = new Map(
    Object.entries(RESOURCE_ICONS).map(([type, entry]) => [type.toLowerCase(), entry]),
);

const GENERIC_RESOURCE: ResourceIcon = { icon: "resource", label: "Resource" };

/** The icon and label of a resource type; unknown types keep their own name as label */
export function resourceIconFor(resourceType: string | undefined): ResourceIcon {
    if (!resourceType) return GENERIC_RESOURCE;
    return RESOURCE_ICONS_BY_LOWER_TYPE.get(resourceType.toLowerCase()) ?? { icon: "resource", label: resourceType };
}

/** The icon of a scope in the tree: one icon per level, the resource type decides for resources */
export function scopeIconFor(scope: Pick<AzureScope, "level" | "resourceType">): IconName {
    switch (scope.level) {
        case "root":
            return "tenant";
        case "managementGroup":
            return "layers";
        case "subscription":
            return "key";
        case "resourceGroup":
            return "admin-unit";
        case "resource":
            return resourceIconFor(scope.resourceType).icon;
    }
}
