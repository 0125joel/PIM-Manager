"use client";

import { useState, useCallback, useEffect } from "react";
import { useMsal } from "@azure/msal-react";
import { Client } from "@microsoft/microsoft-graph-client";
import { Principal } from "@/types/shared.types";
import { Search, User, Users, Check, X } from "lucide-react";
import { Logger } from "@/utils/logger";
import { withRetry } from "@/utils/retryUtils";

/**
 * Escapes single quotes in OData filter strings to prevent injection attacks.
 * OData standard requires single quotes to be escaped as two single quotes.
 */
function escapeODataString(value: string): string {
    return value.replace(/'/g, "''");
}

interface UserGroupSearchProps {
    onSelectionChange: (principals: Principal[]) => void;
    initialSelected?: Principal[];
}

export function UserGroupSearch({ onSelectionChange, initialSelected = [] }: UserGroupSearchProps) {
    const { instance, accounts } = useMsal();
    const [searchTerm, setSearchTerm] = useState("");
    const [results, setResults] = useState<Principal[]>([]);
    const [selected, setSelected] = useState<Principal[]>(initialSelected);
    const [loading, setLoading] = useState(false);

    // Update selected when initialSelected changes
    useEffect(() => {
        setSelected(initialSelected);
    }, [initialSelected]);

    // Auto-search with debouncing
    useEffect(() => {
        const timer = setTimeout(() => {
            if (searchTerm.length >= 3) {
                searchDirectory(searchTerm);
            } else {
                setResults([]);
            }
        }, 500); // 500ms debounce

        return () => clearTimeout(timer);
    }, [searchTerm]);

    const searchDirectory = async (term: string) => {
        if (!term || term.length < 3) return;
        setLoading(true);

        try {
            const request = {
                scopes: ["User.Read.All", "Group.Read.All"],
                account: accounts[0],
            };
            const response = await instance.acquireTokenSilent(request);

            const graphClient = Client.init({
                authProvider: (done) => done(null, response.accessToken),
            });

            // Search Users - using $search for better results if consistencyLevel is set
            // Note: $search requires ConsistencyLevel: eventual header
            const [usersRes, groupsRes] = await Promise.all([
                withRetry(() => graphClient.api("/users")
                    .header("ConsistencyLevel", "eventual")
                    .search(`"displayName:${term}" OR "userPrincipalName:${term}"`)
                    .select("id,displayName,userPrincipalName")
                    .top(5)
                    .get(), 3, 1000, "UserGroupSearch users $search"),
                withRetry(() => graphClient.api("/groups")
                    .header("ConsistencyLevel", "eventual")
                    .search(`"displayName:${term}"`)
                    .select("id,displayName,groupTypes")
                    .top(5)
                    .get(), 3, 1000, "UserGroupSearch groups $search"),
            ]);

            const foundUsers: Principal[] = (usersRes.value || []).map((u: any) => ({
                id: u.id,
                displayName: u.displayName,
                userPrincipalName: u.userPrincipalName,
                type: "user"
            }));

            const foundGroups: Principal[] = (groupsRes.value || []).map((g: any) => ({
                id: g.id,
                displayName: g.displayName,
                groupTypes: g.groupTypes,
                type: "group"
            }));

            setResults([...foundUsers, ...foundGroups]);

        } catch (error) {
            Logger.error("UserGroupSearch", "Search failed", error);
            // Fallback to simple filter if search fails (e.g. if complex query not supported)
            try {
                const request = {
                    scopes: ["User.Read.All", "Group.Read.All"],
                    account: accounts[0],
                };
                const response = await instance.acquireTokenSilent(request);
                const graphClient = Client.init({
                    authProvider: (done) => done(null, response.accessToken),
                });

                // Escape user input to prevent OData injection attacks
                const escapedTerm = escapeODataString(term);

                const [usersRes, groupsRes] = await Promise.all([
                    withRetry(() => graphClient.api("/users")
                        .filter(`startswith(displayName,'${escapedTerm}') or startswith(userPrincipalName,'${escapedTerm}')`)
                        .select("id,displayName,userPrincipalName")
                        .top(5)
                        .get(), 3, 1000, "UserGroupSearch users $filter"),
                    withRetry(() => graphClient.api("/groups")
                        .filter(`startswith(displayName,'${escapedTerm}')`)
                        .select("id,displayName,groupTypes")
                        .top(5)
                        .get(), 3, 1000, "UserGroupSearch groups $filter"),
                ]);

                const foundUsers: Principal[] = (usersRes.value || []).map((u: any) => ({
                    id: u.id,
                    displayName: u.displayName,
                    userPrincipalName: u.userPrincipalName,
                    type: "user"
                }));

                const foundGroups: Principal[] = (groupsRes.value || []).map((g: any) => ({
                    id: g.id,
                    displayName: g.displayName,
                    groupTypes: g.groupTypes,
                    type: "group"
                }));
                setResults([...foundUsers, ...foundGroups]);

            } catch (fallbackError) {
                Logger.error("UserGroupSearch", "Fallback search failed", fallbackError);
            }
        } finally {
            setLoading(false);
        }
    };

    const handleSelect = useCallback((principal: Principal) => {
        if (!selected.find(p => p.id === principal.id)) {
            const newSelected = [...selected, principal];
            setSelected(newSelected);
            onSelectionChange(newSelected);
        }
        setSearchTerm("");
        setResults([]);
    }, [selected, onSelectionChange]);

    const handleRemove = useCallback((id: string) => {
        const newSelected = selected.filter(p => p.id !== id);
        setSelected(newSelected);
        onSelectionChange(newSelected);
    }, [selected, onSelectionChange]);

    return (
        <div className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-lg shadow-md p-6 border border-zinc-200 dark:border-zinc-800">
            <h2 className="text-xl font-semibold mb-4 text-zinc-900 dark:text-zinc-100">Assign to Users/Groups</h2>

            <div className="relative mb-4">
                <input
                    type="text"
                    placeholder="Search users or groups... (min 3 characters)"
                    className="w-full px-4 py-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
                {loading && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        <div className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full"></div>
                    </div>
                )}

                {/* Search Results Dropdown */}
                {results.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md shadow-lg max-h-60 overflow-y-auto">
                        {results.map(res => (
                            <div
                                key={res.id}
                                onClick={() => handleSelect(res)}
                                className="flex items-center p-3 hover:bg-zinc-100 dark:hover:bg-zinc-700 cursor-pointer"
                            >
                                {res.type === 'user' ? <User className="h-4 w-4 mr-3 text-zinc-500" /> : <Users className="h-4 w-4 mr-3 text-zinc-500" />}
                                <div>
                                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{res.displayName}</p>
                                    <p className="text-xs text-zinc-500">{res.userPrincipalName || "Group"}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Selected Principals */}
            <div className="space-y-2">
                {selected.map(p => (
                    <div key={p.id} className="flex items-center justify-between p-2 bg-zinc-50 dark:bg-zinc-800 rounded border border-zinc-200 dark:border-zinc-700">
                        <div className="flex items-center">
                            {p.type === 'user' ? <User className="h-4 w-4 mr-3 text-blue-500" /> : <Users className="h-4 w-4 mr-3 text-green-500" />}
                            <span className="text-sm text-zinc-900 dark:text-zinc-100">{p.displayName}</span>
                        </div>
                        <button onClick={() => handleRemove(p.id)} className="text-zinc-400 hover:text-red-500">
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                ))}
                {selected.length === 0 && (
                    <p className="text-sm text-zinc-500 italic">No users or groups selected.</p>
                )}
            </div>
        </div>
    );
}
