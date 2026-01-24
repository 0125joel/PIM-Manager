"use client";

import { useState, useEffect } from "react";
import { useMsal } from "@azure/msal-react";
import { Client } from "@microsoft/microsoft-graph-client";
import { AuthenticationContext } from "@/types";

interface AuthContextSelectorProps {
    selectedContextId?: string;
    onSelect: (contextId: string) => void;
}

export function AuthContextSelector({ selectedContextId, onSelect }: AuthContextSelectorProps) {
    const { instance, accounts } = useMsal();
    const [contexts, setContexts] = useState<AuthenticationContext[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        const fetchContexts = async () => {
            if (accounts.length === 0) return;

            setLoading(true);
            try {
                const request = {
                    scopes: ["Policy.Read.ConditionalAccess"],
                    account: accounts[0],
                };

                const response = await instance.acquireTokenSilent(request);
                const graphClient = Client.init({
                    authProvider: (done) => done(null, response.accessToken),
                });

                const result = await graphClient
                    .api("/identity/conditionalAccess/authenticationContextClassReferences")
                    .get();

                setContexts(result.value.filter((ctx: any) => ctx.isAvailable));
            } catch (error) {
                console.error("Failed to fetch auth contexts", error);
                // Fallback to empty if no permission
                setContexts([]);
            } finally {
                setLoading(false);
            }
        };

        fetchContexts();
    }, [instance, accounts]);

    if (loading) {
        return <p className="text-xs text-zinc-500">Loading contexts...</p>;
    }

    if (contexts.length === 0) {
        return (
            <p className="text-xs text-zinc-500 italic">
                No authentication contexts available. Configure them in Conditional Access.
            </p>
        );
    }

    return (
        <select
            value={selectedContextId || ""}
            onChange={(e) => onSelect(e.target.value)}
            className="w-full px-3 py-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
            <option value="">Select authentication context</option>
            {contexts.map((ctx) => (
                <option key={ctx.id} value={ctx.id}>
                    {ctx.displayName} {ctx.description ? `- ${ctx.description}` : ""}
                </option>
            ))}
        </select>
    );
}
