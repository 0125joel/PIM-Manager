import type { ArmRoleManagementPolicy, AzureAssignment, AzureScope, AzureScopeLevel } from "@/types/azureResource.types";
import type { PolicySettings } from "@/types/wizard.types";
import type { MyAzureRoleRow } from "@/utils/azureReportStates";
import { graphRulesOf, parseArmPolicy } from "@/utils/armPolicyRules";
import { AZURE_SCOPE_IDS as S, buildContosoAzure, type DemoAzureLevel } from "@/demo/contoso/azure";
import ownerPolicy from "@/__tests__/fixtures/azure/subscription-owner-policy.json";

/**
 * The Azure Report fixture (NG-96): the Contoso tree and items of the demo, dated from a fixed moment so the screenshots
 * do not change from day to day, in the shapes the Report reads. Used by `src/app/dev/azure-report/page.fixture.tsx`.
 */

export const AZURE_FIXTURE_NOW = new Date("2026-10-18T09:00:00Z");

/** The id of the assignment the panel states open: Johanna's eligible Owner on production */
export const AZURE_FIXTURE_PANEL_ID = "fixture:e:prod-owner-johanna";

const LEVEL: Record<DemoAzureLevel, AzureScopeLevel> = {
    tenant: "root",
    managementgroup: "managementGroup",
    subscription: "subscription",
    resourcegroup: "resourceGroup",
    resource: "resource",
};

/** `Microsoft.KeyVault/vaults` from `/subscriptions/{id}/resourceGroups/{rg}/providers/Microsoft.KeyVault/vaults/{name}` */
function resourceTypeOf(id: string): string {
    const segs = id.split("/").filter((s) => s !== "");
    return `${segs[5]}/${segs[6]}`;
}

export function buildAzureReportFixture(): { scopes: AzureScope[]; assignments: AzureAssignment[] } {
    const azure = buildContosoAzure(AZURE_FIXTURE_NOW);
    // Contoso Labs (read below its own level) and what the dashboard work added (the Landing Zones and Corp groups with
    // Corp Apps, the delegated Fabrikam subscription and their items) stay out, so the states keep the tree they were accepted with
    const labs = azure.subscriptions.filter((s) => s.readableScopes).map((s) => `/subscriptions/${s.subscriptionId}`.toLowerCase());
    const added = [S.landingZones, S.corp, S.corpApps, S.fabrikamProd].map((id) => id.toLowerCase());
    const outside = [...labs, ...added];
    const isOutside = (id: string) => outside.some((l) => id.toLowerCase() === l || id.toLowerCase().startsWith(`${l}/`));
    const addedKeys = new Set(["a:trg-owner-bg01", "e:platform-operator-johanna"]);
    const scopes: AzureScope[] = azure.scopes.filter((s) => !isOutside(s.id)).map((s) => {
        const level = LEVEL[s.level];
        return {
            id: s.id,
            name: s.displayName,
            level,
            parentId: s.parentId,
            ...(level === "resource" ? { resourceType: resourceTypeOf(s.id) } : {}),
        };
    });
    const assignments: AzureAssignment[] = azure.instances.filter((i) => !isOutside(i.scope) && !addedKeys.has(i.key)).map((i) => ({
        id: `fixture:${i.key}`,
        scopeId: i.scope,
        principalId: i.principal.id,
        principalName: i.principal.displayName,
        principalType: i.principal.type,
        roleDefinitionId: i.role.id,
        roleName: i.role.displayName,
        state: i.kind === "active" ? "active" : "eligible",
        memberType: "direct",
        endDateTime: i.endDateTime,
        ...(i.role.custom ? { isCustomRole: true as const } : {}),
    }));
    return { scopes, assignments };
}

/** The Owner settings of the board: the spike's Owner policy, with MFA on activation */
export function buildAzurePanelSettings(): PolicySettings {
    const settings = parseArmPolicy(ownerPolicy.value[0] as unknown as ArmRoleManagementPolicy);
    return { ...settings, activationRequirement: "mfa" };
}

/** The same Owner policy's rules in the Graph shape, for the role configuration tabs */
export function buildAzurePanelRules(): Record<string, unknown>[] {
    return graphRulesOf(ownerPolicy.value[0] as unknown as ArmRoleManagementPolicy);
}

/** The own roles of the user for the empty state with "Your Azure roles": one active, two eligible */
export const AZURE_FIXTURE_MY_ROLES: { active: MyAzureRoleRow[]; eligible: MyAzureRoleRow[] } = {
    active: [
        { id: "fixture:my:3", roleName: "Key Vault Secrets User", scopeName: "kv-contoso-prod", endText: "2 Nov 2026", isPermanent: false },
    ],
    eligible: [
        { id: "fixture:my:1", roleName: "Contributor", scopeName: "Contoso Test", endText: "15 Nov 2026", isPermanent: false },
        { id: "fixture:my:2", roleName: "Reader", scopeName: "Tenant Root Group", endText: "Permanent", isPermanent: true },
    ],
};
