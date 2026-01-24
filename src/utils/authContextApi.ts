import { Client } from "@microsoft/microsoft-graph-client";
import { GRAPH_LOCALE } from "@/config/constants";

export interface AuthenticationContext {
    id: string;              // e.g., "c1", "c2"
    displayName: string;     // e.g., "Require MFA for PIM"
    description?: string;
    isAvailable: boolean;
}

/**
 * Fetch all Authentication Context Class References from tenant
 * Endpoint: GET /identity/conditionalAccess/authenticationContextClassReferences
 * Permission: Policy.Read.ConditionalAccess
 */
export async function getAuthenticationContexts(client: Client): Promise<AuthenticationContext[]> {
    try {
        const response = await client
            .api("/identity/conditionalAccess/authenticationContextClassReferences")
            .header("Accept-Language", GRAPH_LOCALE)
            .get();

        return (response.value || []).map((ctx: any) => ({
            id: ctx.id,
            displayName: ctx.displayName,
            description: ctx.description || "",
            isAvailable: ctx.isAvailable !== false
        }));
    } catch (error) {
        if (process.env.NODE_ENV === 'development') {
            console.error("Failed to fetch authentication contexts:", error);
        }
        return [];
    }
}

/**
 * Get displayName for a specific Authentication Context ID
 */
export function getAuthContextDisplayName(
    authContexts: AuthenticationContext[],
    id: string | undefined
): string | undefined {
    if (!id) return undefined;
    return authContexts.find(ctx => ctx.id === id)?.displayName;
}
