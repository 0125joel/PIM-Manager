/** Tips of the dashboard tip bar (spec 4.8). Tenant tips are generated from the numbers in `utils/tipRules.ts`; these are the general ones. */
export interface GeneralTip {
    title: string;
    description: string;
    /** Microsoft Learn page */
    link: string;
}

export const GENERAL_TIPS: GeneralTip[] = [
    {
        title: "Use Eligible Assignments",
        description: "Convert permanent assignments to eligible ones. Users activate access only when needed, reducing exposure.",
        link: "https://learn.microsoft.com/en-us/entra/id-governance/privileged-identity-management/pim-configure",
    },
    {
        title: "Enable Approval Workflows",
        description: "Require approval for high-risk role activations. This adds oversight for sensitive operations.",
        link: "https://learn.microsoft.com/en-us/entra/id-governance/privileged-identity-management/pim-how-to-require-approval-to-activate",
    },
    {
        title: "Set Maximum Activation Duration",
        description: "Limit how long users can keep roles active. Shorter durations reduce risk from compromised sessions.",
        link: "https://learn.microsoft.com/en-us/entra/id-governance/privileged-identity-management/pim-how-to-change-default-settings",
    },
    {
        title: "Review Access Regularly",
        description: "Set up access reviews to ensure only necessary users retain privileged access over time.",
        link: "https://learn.microsoft.com/en-us/entra/id-governance/privileged-identity-management/pim-create-roles-and-resource-roles-review",
    },
    {
        title: "Require MFA for Activations",
        description: "Enforce Azure MFA or Conditional Access for all privileged role activations to verify identity.",
        link: "https://learn.microsoft.com/en-us/entra/id-governance/privileged-identity-management/pim-how-to-change-default-settings#on-activation-require-azure-mfa",
    },
    {
        title: "Limit Global Administrators",
        description: "Keep fewer than 5 Global Administrators. Use more specific roles like User Administrator or Security Admin.",
        link: "https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/best-practices",
    },
    {
        title: "Monitor PIM Security Alerts",
        description: "Enable alerts to detect unused roles, excessive activations, and policy violations automatically.",
        link: "https://learn.microsoft.com/en-us/entra/id-governance/privileged-identity-management/pim-how-to-configure-security-alerts",
    },
    {
        title: "Require Justification",
        description: "Make users provide a reason when activating roles. Creates an audit trail for security investigations.",
        link: "https://learn.microsoft.com/en-us/entra/id-governance/privileged-identity-management/pim-how-to-change-default-settings",
    },
    {
        title: "Use Authentication Context",
        description: "Apply Conditional Access rules to require specific MFA methods or trusted devices for activation.",
        link: "https://learn.microsoft.com/en-us/entra/id-governance/privileged-identity-management/pim-resource-roles-configure-role-settings",
    },
    {
        title: "Create Emergency Access Accounts",
        description: "Maintain cloud-only 'break glass' accounts for emergencies when normal admin access is unavailable.",
        link: "https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/security-emergency-access",
    },
];
