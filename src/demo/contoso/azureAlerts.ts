/**
 * The four PIM alerts of an Azure subscription as ARM returns them (`GET .../roleManagementAlerts`, api-version
 * `2022-08-01-preview`), copied from `docs/Assets/azure/spike-fixtures/subscription-roleManagementAlerts.json`
 * without the `scope` fields: the fake ARM (`src/demo/arm/server.ts`) sets those per subscription.
 */
export const AZURE_ALERT_DEFINITIONS = [
    {
        name: "TooManyOwnersAssignedToResource",
        configuration: {
            alertConfigurationType: "TooManyOwnersAssignedToResourceConfiguration",
            alertDefinitionId: "TooManyOwnersAssignedToResource",
            isEnabled: true,
            thresholdNumberOfOwners: 5,
            thresholdPercentageOfOwnersOutOfAllRoleMembers: 50
        },
        definition: {
            description: "The number of users with the Owner role is too high. We recommend assigning these individuals to less privileged roles or roles more suitable to their daily needs. Take a moment to review the current assignments, and suggested changes here.",
            displayName: "Too many owners assigned to a resource",
            howToPrevent: "Choose a role that provides the fewest privileges necessary for a user or group to complete their tasks.",
            isConfigurable: true,
            isRemediatable: true,
            mitigationSteps: "To mitigate this issue, reduce the number of users in the Owner role. Review the list of users in the list, and reassign them to a less privileged role such as Contributor.",
            securityImpact: "As the number of users with the owner role increases, so does the potential for malicious or mistaken actions affecting your resource.",
            severityLevel: "Medium"
        }
    },
    {
        name: "TooManyPermanentOwnersAssignedToResource",
        configuration: {
            alertConfigurationType: "TooManyPermanentOwnersAssignedToResourceConfiguration",
            alertDefinitionId: "TooManyPermanentOwnersAssignedToResource",
            isEnabled: true,
            thresholdNumberOfPermanentOwners: 5,
            thresholdPercentageOfPermanentOwnersOutOfAllOwners: 50
        },
        definition: {
            description: "The number of users set to never expire is too high. To enhance the security of your resources, we recommend requiring activation for role use. Take a moment to review the list of users, and suggested changes here.",
            displayName: "Too many permanent owners assigned to a resource",
            howToPrevent: "Enable \u201cActivation Required\u201d in the role settings menu. This will ensure newly added users must activate their role.",
            isConfigurable: true,
            isRemediatable: true,
            mitigationSteps: "To mitigate this issue, require the user to activate the role before use.",
            securityImpact: "Providing users permanent access in a role may leave resources vulnerable to accidental or malicious activity.",
            severityLevel: "Medium"
        }
    },
    {
        name: "DuplicateRoleCreated",
        configuration: {
            alertConfigurationType: "DuplicateRoleCreatedConfiguration",
            alertDefinitionId: "DuplicateRoleCreated",
            isEnabled: true
        },
        definition: {
            description: "One or more custom roles have the same display name and/or permissions as a built-in or preexisting custom role. Please review the newly created role membership assignments and determine the appropriate action.",
            displayName: "Duplicate role created",
            howToPrevent: "Prior to creating a custom role, determine if a built-in or preexisting custom role aligns to your security requirements.",
            isConfigurable: false,
            isRemediatable: true,
            mitigationSteps: "To mitigate this issue, review the newly created role, and determine if a built-in role is suitable.",
            securityImpact: "Duplicate roles add confusion and increases the complexity of administration.",
            severityLevel: "Medium"
        }
    },
    {
        name: "AzureRolesAssignedOutsidePimAlert",
        configuration: {
            alertConfigurationType: "AzureRolesAssignedOutsidePimAlertConfiguration",
            alertDefinitionId: "AzureRolesAssignedOutsidePimAlert",
            isEnabled: false
        },
        definition: {
            description: "0 privileged assignment(s) were made outside of Microsoft Entra Privileged Identity Management (PIM)",
            displayName: "Roles are being assigned outside of Privileged Identity Management",
            howToPrevent: "Investigate where users are being assigned privileged roles outside of Privileged Identity Management and prohibit future assignments from there.",
            isConfigurable: false,
            isRemediatable: true,
            mitigationSteps: "Review the users in the list and remove them from privileged roles assigned outside of PIM.",
            securityImpact: "Privileged role assignments made outside of Privileged Identity Management are not properly monitored and may indicate an active attack.",
            severityLevel: "High"
        }
    }
];
