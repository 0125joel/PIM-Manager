"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGraphClient } from "@/hooks/usePimSelectors";
import { searchPrincipals, searchUsers, type FoundPrincipal, type FoundUser } from "@/services/userSearchService";
import { getErrorMessage } from "@/utils/errorUtils";

export type { FoundPrincipal, FoundUser };

const MIN_LENGTH = 3;
const DEBOUNCE_MS = 400;

export type UserSearchFn = (term: string) => Promise<FoundUser[]>;
export type PrincipalSearchFn = (term: string, options?: { onlyRoleAssignableGroups?: boolean }) => Promise<FoundPrincipal[]>;

/**
 * Debounced user search for a combobox: needs 3 characters, ignores answers that arrive after a newer term,
 * leaves out the ids in `excludeIds` (already marked accounts). `search` can be injected for the fixture page.
 */
export function useUserSearch(excludeIds: ReadonlySet<string>, search?: UserSearchFn) {
    const getGraphClient = useGraphClient();
    const run = useCallback(async (term: string) => (search ? search(term) : searchUsers(await getGraphClient(), term)), [search, getGraphClient]);
    return useDebouncedSearch(excludeIds, run);
}

/**
 * The search over users and groups of Configure (approvers, Add people) for the data container; the view gets the
 * function as a prop, so the fixture page can pass its own without a Graph client.
 */
export function usePrincipalSearchFn(): PrincipalSearchFn {
    const getGraphClient = useGraphClient();
    return useCallback(async (term: string, options?: { onlyRoleAssignableGroups?: boolean }) => searchPrincipals(await getGraphClient(), term, options), [getGraphClient]);
}

/** Debounced search for a combobox over any search function (3 characters, stale answers ignored, `excludeIds` left out) */
export function useDebouncedSearch<T extends { id: string }>(excludeIds: ReadonlySet<string>, run: (term: string) => Promise<T[]>) {
    const [term, setTerm] = useState("");
    const [found, setFound] = useState<{ term: string; users: T[] } | null>(null);
    const [loadingTerm, setLoadingTerm] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const latest = useRef("");

    useEffect(() => {
        latest.current = term;
        if (term.trim().length < MIN_LENGTH) return;

        const timer = setTimeout(async () => {
            setLoadingTerm(term);
            setError(null);
            try {
                const users = await run(term);
                if (latest.current === term) setFound({ term, users });
            } catch (err: unknown) {
                if (latest.current === term) setError(getErrorMessage(err) || "The search failed.");
            } finally {
                setLoadingTerm((current) => (current === term ? null : current));
            }
        }, DEBOUNCE_MS);

        return () => clearTimeout(timer);
    }, [term, run]);

    const isShort = term.trim().length < MIN_LENGTH;
    const results = useMemo(
        () => (isShort || !found || found.term !== term ? [] : found.users.filter((u) => !excludeIds.has(u.id.toLowerCase()))),
        [isShort, found, term, excludeIds],
    );

    return {
        term,
        setTerm,
        results,
        isSearching: !isShort && (loadingTerm === term || found?.term !== term) && !error,
        error: isShort ? null : error,
        minLength: MIN_LENGTH,
        reset: () => {
            setTerm("");
            setFound(null);
            setError(null);
        },
    };
}
