import React, { useState, useEffect, useCallback } from 'react';
import { Search, Loader2, Users, UserCheck, X, Info } from 'lucide-react';
import { useGraphClient } from '@/hooks/usePimSelectors';
import { Logger } from '@/utils/logger';

export interface Principal {
    id: string;
    type: "user" | "group" | "manager";
    displayName?: string;
    mail?: string;
    isAssignableToRole?: boolean; // groups only: false = not eligible for directory role assignment
}

// SECURITY: Escape single quotes for OData filter strings to prevent injection
function escapeODataString(value: string): string {
    return value.replace(/'/g, "''");
}

type FilterType = "all" | "users" | "groups";

interface PrincipalSelectorProps {
    selectedPrincipals: Principal[];
    onChange: (principals: Principal[]) => void;
    label?: string;
    description?: string;
    addLabel?: string;
    maxSelections?: number;
    /** Show "Not role-assignable" warning for groups. Enable only in directory role assignment context. */
    showRoleAssignableWarning?: boolean;
}

export function PrincipalSelector({
    selectedPrincipals,
    onChange,
    label = "Select principals",
    description,
    addLabel = "+ Add",
    maxSelections,
    showRoleAssignableWarning = false,
}: PrincipalSelectorProps) {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<Principal[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [activeFilter, setActiveFilter] = useState<FilterType>("all");
    const [onlyRoleAssignable, setOnlyRoleAssignable] = useState(false);
    const [modalMaxHeightPx, setModalMaxHeightPx] = useState<number | undefined>(undefined);
    const getGraphClient = useGraphClient();

    const fetchResults = useCallback(async (query: string, filter: FilterType, roleAssignableOnly: boolean) => {
        setIsSearching(true);
        try {
            const client = await getGraphClient();
            const hasQuery = query.length >= 2;
            const fetchUsers = filter !== "groups";
            const fetchGroups = filter !== "users";

            const [usersRes, groupsRes] = await Promise.all([
                fetchUsers
                    ? (() => {
                        const req = client.api('/users').select('id,displayName,mail').top(10);
                        return hasQuery
                            ? req.filter(`startswith(displayName,'${escapeODataString(query)}') or startswith(mail,'${escapeODataString(query)}')`).get()
                            : req.get();
                    })()
                    : Promise.resolve({ value: [] }),
                fetchGroups
                    ? (() => {
                        const fields = showRoleAssignableWarning ? 'id,displayName,isAssignableToRole' : 'id,displayName';
                        const req = client.api('/groups').select(fields).top(25);
                        const baseFilter = roleAssignableOnly ? `isAssignableToRole eq true` : undefined;
                        const queryFilter = hasQuery ? `startswith(displayName,'${escapeODataString(query)}')` : undefined;
                        const combinedFilter = [baseFilter, queryFilter].filter(Boolean).join(' and ');
                        return combinedFilter ? req.filter(combinedFilter).get() : req.get();
                    })()
                    : Promise.resolve({ value: [] }),
            ]);

            const users: Principal[] = (usersRes.value || []).map((u: { id: string; displayName: string; mail?: string }) => ({
                id: u.id,
                displayName: u.displayName,
                type: "user" as const,
                mail: u.mail,
            }));

            const groups: Principal[] = (groupsRes.value || []).map((g: { id: string; displayName: string; isAssignableToRole?: boolean }) => ({
                id: g.id,
                displayName: g.displayName,
                type: "group" as const,
                isAssignableToRole: g.isAssignableToRole === true,
            }));

            setSearchResults([...users, ...groups]);
        } catch (error) {
            Logger.error("PrincipalSelector", "Search error", error);
            setSearchResults([]);
        } finally {
            setIsSearching(false);
        }
    }, [getGraphClient, showRoleAssignableWarning]);

    // Reload when modal opens, filter changes, role-assignable toggle, or query changes (debounced for queries)
    useEffect(() => {
        if (!isModalOpen) return;
        if (searchQuery.length === 1) {
            setSearchResults([]);
            return;
        }
        const delay = searchQuery.length >= 2 ? 300 : 0;
        const timer = setTimeout(() => {
            fetchResults(searchQuery, activeFilter, onlyRoleAssignable && activeFilter === "groups");
        }, delay);
        return () => clearTimeout(timer);
    }, [isModalOpen, activeFilter, searchQuery, onlyRoleAssignable, fetchResults]);

    const addPrincipal = (result: Principal) => {
        if (selectedPrincipals.some(p => p.id === result.id)) return;
        if (maxSelections && selectedPrincipals.length >= maxSelections) return;
        onChange([...selectedPrincipals, {
            id: result.id,
            type: result.type,
            displayName: result.displayName,
            mail: result.mail,
            isAssignableToRole: result.isAssignableToRole,
        }]);
        setSearchQuery("");
    };

    const removePrincipal = (id: string) => {
        onChange(selectedPrincipals.filter(p => p.id !== id));
    };

    const openModal = () => {
        const wizardCard = document.getElementById('wizard-card');
        setModalMaxHeightPx(wizardCard ? wizardCard.offsetHeight * 0.8 : undefined);
        setSearchQuery("");
        setActiveFilter("all");
        setOnlyRoleAssignable(false);
        setSearchResults([]);
        setIsModalOpen(true);
    };

    const closeModal = () => {
        setSearchQuery("");
        setSearchResults([]);
        setIsModalOpen(false);
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
                    <p className="text-xs text-zinc-500 mb-3">{description}</p>
                )}
                {selectedPrincipals.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-3">
                        {selectedPrincipals.map((p, index) => (
                            <div
                                key={`${p.id}-${index}`}
                                className="flex items-center gap-1 px-2 py-1 bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200 rounded-full text-xs"
                            >
                                <Users className="w-3 h-3" />
                                {p.displayName}
                                <button onClick={() => removePrincipal(p.id)} className="ml-1 hover:text-red-600">
                                    <X className="w-3 h-3" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
                <button
                    onClick={openModal}
                    disabled={!!maxSelections && selectedPrincipals.length >= maxSelections}
                    className="px-3 py-1.5 text-sm border border-dashed border-zinc-300 dark:border-zinc-600 rounded-md text-zinc-600 dark:text-zinc-400 hover:border-blue-500 hover:text-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {addLabel}
                </button>
            </div>

            {isModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div
                        className="bg-white dark:bg-zinc-800 rounded-xl shadow-xl w-full max-w-2xl mx-auto flex flex-col"
                        style={{ maxHeight: modalMaxHeightPx ?? '85vh' }}
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between p-5 border-b dark:border-zinc-700 flex-shrink-0">
                            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{label}</h3>
                            <button onClick={closeModal} className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="p-5 space-y-3 flex flex-col flex-1 overflow-hidden">
                            {/* Search */}
                            <div className="relative flex-shrink-0">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Search users or groups..."
                                    className="w-full pl-10 pr-10 py-2.5 border border-zinc-200 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                                    autoFocus
                                />
                                {isSearching && (
                                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-zinc-400" />
                                )}
                            </div>

                            {/* Filter toggles */}
                            <div className="flex flex-wrap items-center gap-1.5 flex-shrink-0">
                                {(["all", "users", "groups"] as FilterType[]).map((f) => (
                                    <button
                                        key={f}
                                        onClick={() => { setActiveFilter(f); if (f !== "groups") setOnlyRoleAssignable(false); }}
                                        className={`px-3 py-1 rounded-full text-xs font-medium transition-colors capitalize ${
                                            activeFilter === f
                                                ? "bg-blue-600 text-white"
                                                : "bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-600"
                                        }`}
                                    >
                                        {f}
                                    </button>
                                ))}
                                {showRoleAssignableWarning && activeFilter === "groups" && (
                                    <button
                                        onClick={() => setOnlyRoleAssignable(v => !v)}
                                        className={`ml-1 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                                            onlyRoleAssignable
                                                ? "bg-emerald-600 text-white"
                                                : "bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-600"
                                        }`}
                                    >
                                        Only role-assignable
                                    </button>
                                )}
                            </div>

                            {/* Results */}
                            <div className="flex-1 overflow-y-auto -mx-1 px-1">
                                {isSearching && searchResults.length === 0 && (
                                    <div className="text-center py-6 text-zinc-500 text-sm">Searching...</div>
                                )}
                                {!isSearching && searchResults.length === 0 && searchQuery.length !== 1 && (
                                    <div className="text-center py-6 text-zinc-500 text-sm">No results found</div>
                                )}
                                {searchQuery.length === 1 && (
                                    <div className="text-center py-6 text-zinc-500 text-sm">Type at least 2 characters to search</div>
                                )}
                                {searchResults.map((result, index) => {
                                    const isNonAssignable = showRoleAssignableWarning && result.type === "group" && !result.isAssignableToRole;
                                    const isSelected = selectedPrincipals.some(p => p.id === result.id);

                                    return (
                                        <button
                                            key={`${result.id}-${index}`}
                                            onClick={() => addPrincipal(result)}
                                            disabled={isSelected}
                                            className="w-full flex items-center gap-3 px-2 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                        >
                                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 ${
                                                result.type === 'user' ? 'bg-blue-500' : 'bg-emerald-500'
                                            }`}>
                                                {result.type === 'user' ? 'U' : 'G'}
                                            </div>
                                            <div className="text-left flex-1 min-w-0">
                                                <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                                                    {result.displayName}
                                                </div>
                                                {result.mail && (
                                                    <div className="text-xs text-zinc-500 truncate">{result.mail}</div>
                                                )}
                                                {isNonAssignable && (
                                                    <div className="flex items-center gap-1 mt-0.5">
                                                        <Info className="w-3 h-3 text-amber-500 flex-shrink-0" />
                                                        <span className="text-xs text-amber-500">Not role-assignable. Assignment will fail.</span>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex-shrink-0">
                                                <span className="text-xs text-zinc-400 capitalize">{result.type}</span>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="flex justify-end p-4 border-t dark:border-zinc-700">
                            <button
                                onClick={closeModal}
                                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
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
