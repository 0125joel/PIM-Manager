/** PIM Custom Extensions (Preview): the tenant's roleManagementCustomCalloutExtension objects (`services/customExtensionService.ts`) */

export type CustomExtensionResourceType = "entraRoles" | "entraGroups" | "azureResources";

export interface PimCustomExtension {
    id: string;
    displayName: string;
    description: string;
    resourceType: CustomExtensionResourceType | string;
    targetUrl: string;
    timeoutInMilliseconds?: number;
    maximumRetries?: number;
    /** Application ID URI of the app registration that secures the endpoint */
    resourceId?: string;
    customAttributes: string[];
}

export interface CreateCustomExtensionInput {
    displayName: string;
    description?: string;
    targetUrl: string;
    resourceId: string;
    resourceType: CustomExtensionResourceType;
    timeoutInMilliseconds?: number;
    maximumRetries?: number;
    customAttributes?: string[];
}
