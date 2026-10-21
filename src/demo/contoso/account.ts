import { CONTOSO_TENANT_ID, demoGuid } from "./ids";

/** The person signed in to the demo: Alex Wilber, IT administrator at Contoso (`PEOPLE.alex` in tenant.ts) */
export const DEMO_ACCOUNT = {
    id: demoGuid("user:AlexW"),
    displayName: "Alex Wilber",
    userPrincipalName: "AlexW@contoso.com",
    tenantId: CONTOSO_TENANT_ID,
    tenantName: "Contoso",
} as const;
