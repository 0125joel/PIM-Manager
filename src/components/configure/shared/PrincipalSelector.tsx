import React, { useState, useEffect, useCallback } from 'react';
import { Search, Loader2, Users, UserCheck, X } from 'lucide-react';
import { useGraphClient } from '@/hooks/usePimSelectors';
import { Logger } from '@/utils/logger';

// Generic Principal type (User, Group, or Manager)
export interface Principal {
    id: string;
    type: "user" | "group" | "manager"; // manager = requestor's manager (PIM approval)
    displayName?: string;
    mail?: string;
}

// SECURITY: Escape single quotes for OData filter strings to prevent injection
// OData standard: single quotes must be escaped as two single quotes
function escapeODataString(value: string): string {
    return value.replace(/'/g, "''");
}

interface PrincipalSelectorProps {
    selectedPrincipals: Principal[];
    onChange: (principals: Principal[]) => void;
    label?: string;
    description?: string;
    addLabel?: string;
    maxSelections?: number;
}

export function PrincipalSelector({
    selectedPrincipals,
    onChange,
    label = "Select principals",
    description,
    addLabel = "+ Add",
    maxSelections
}: PrincipalSelectorProps) {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<Principal[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    // Use selector hook - stable reference, won't cause re-renders
    const getGraphClient = useGraphClient();

    const searchUsersAndGroups = useCallback(async (query: string) => {
        if (!query || query.length < 2) {
            setSearchResults([]);
            return;
        }

        setIsSearching(true);
        try {
            const client = await getGraphClient();

            // SECURITY: Escape user input to prevent OData filter injection
            const escapedQuery = escapeODataString(query);

            // Search users
            const usersResponse = await client
                .api('/users')
                .filter(`startswith(displayName,'${escapedQuery}') or startswith(mail,'${escapedQuery}')`)
                .select('id,displayName,mail')
                .top(10)
                .get();

            // Search groups
            const groupsResponse = await client
                .api('/groups')
                .filter(`startswith(displayName,'${escapedQuery}')`)
                .select('id,displayName')
                .top(10)
                .get();

            const users: Principal[] = (usersResponse.value || []).map((u: { id: string; displayName: string; mail?: string }) => ({
                id: u.id,
                displayName: u.displayName,
                type: "user" as const,
                mail: u.mail
            }));

            const groups: Principal[] = (groupsResponse.value || []).map((g: { id: string; displayName: string }) => ({
                id: g.id,
                displayName: g.displayName,
                type: "group" as const
            }));

            setSearchResults([...users, ...groups]);
        } catch (error) {
            Logger.error("PrincipalSelector", "Search error", error);
            setSearchResults([]);
        } finally {
            setIsSearching(false);
        }
    }, [getGraphClient]);

    useEffect(() => {
        const debounce = setTimeout(() => {
            if (searchQuery) {
                searchUsersAndGroups(searchQuery);
            }
        }, 300);
        return () => clearTimeout(debounce);
    }, [searchQuery, searchUsersAndGroups]);

    const addPrincipal = (result: Principal) => {
        if (!selectedPrincipals.some(p => p.id === result.id)) {
            if (maxSelections && selectedPrincipals.length >= maxSelections) {
                return; // Prevent adding if max reached
            }

            onChange([...selectedPrincipals, {
                id: result.id,
                type: result.type,
                displayName: result.displayName,
                mail: result.mail
            }]);
        }
        setSearchQuery("");
        setSearchResults([]);
    };

    const removePrincipal = (id: string) => {
        onChange(selectedPrincipals.filter(p => p.id !== id));
    };

    return (
        <>
            <div className="p-3 bg-zinc-100 dark:bg-zinc-700/50 rounded-lg border border-zinc-200 dark:border-zinc-600">
                <div className="flex items-center gap-2 mb-2">
                    <UserCheck className="w-4 h-4 text-blue-500" />
                    <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        {label}
                    </span>
                </div>
                {description && (
                    <p className="text-xs text-zinc-500 mb-3">
                        {description}
                    </p>
                )}

                {/* Selected items */}
                {selectedPrincipals.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-3">
                        {selectedPrincipals.map((p, index) => (
                            <div
                                key={`${p.id}-${index}`}
                                className="flex items-center gap-1 px-2 py-1 bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200 rounded-full text-xs"
                            >
                                <Users className="w-3 h-3" />
                                {p.displayName}
                                <button
                                    onClick={() => removePrincipal(p.id)}
                                    className="ml-1 hover:text-red-600"
                                >
                                    <X className="w-3 h-3" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                <button
                    onClick={() => setIsModalOpen(true)}
                    disabled={!!maxSelections && selectedPrincipals.length >= maxSelections}
                    className="px-3 py-1.5 text-sm border border-dashed border-zinc-300 dark:border-zinc-600 rounded-md text-zinc-600 dark:text-zinc-400 hover:border-blue-500 hover:text-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {addLabel}
                </button>
            </div>

            {/* Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="bg-white dark:bg-zinc-800 rounded-xl shadow-xl w-full max-w-md mx-auto">
                        <div className="flex items-center justify-between p-4 border-b dark:border-zinc-700">
                            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                                {label}
                            </h3>
                            <button
                                onClick={() => setIsModalOpen(false)}
                                className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="p-4">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Search users or groups..."
                                    className="w-full pl-10 pr-4 py-2 border border-zinc-200 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 focus:ring-2 focus:ring-blue-500 outline-none"
                                    autoFocus
                                />
                                {isSearching && (
                                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-zinc-400" />
                                )}
                            </div>

                            {/* Results */}
                            <div className="mt-3 max-h-60 overflow-y-auto">
                                {searchResults.length === 0 && searchQuery.length >= 2 && !isSearching && (
                                    <div className="text-center py-4 text-zinc-500 text-sm">
                                        No results found
                                    </div>
                                )}
                                {searchQuery.length < 2 && (
                                    <div className="text-center py-4 text-zinc-500 text-sm">
                                        Type at least 2 characters to search
                                    </div>
                                )}
                                {searchResults.map((result, index) => (
                                    <button
                                        key={`${result.id}-${index}`}
                                        onClick={() => addPrincipal(result)}
                                        disabled={selectedPrincipals.some(p => p.id === result.id)}
                                        className="w-full flex items-center gap-3 p-2 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white ${result.type === 'user' ? 'bg-blue-500' : 'bg-green-500'
                                            }`}>
                                            {result.type === 'user' ? 'U' : 'G'}
                                        </div>
                                        <div className="text-left flex-1 overflow-hidden">
                                            <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                                                {result.displayName}
                                            </div>
                                            {result.mail && (
                                                <div className="text-xs text-zinc-500 truncate">{result.mail}</div>
                                            )}
                                        </div>
                                        <span className="ml-auto text-xs text-zinc-400 capitalize whitespace-nowrap">
                                            {result.type}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="flex justify-end p-4 border-t dark:border-zinc-700">
                            <button
                                onClick={() => setIsModalOpen(false)}
                                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                            >
                                Done
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
