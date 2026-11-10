"use client";

import { useCallback, useEffect, useState } from "react";
import { readDetailsPreference, readPageDetails, resolveDetails, writePageDetails, type DetailsPage, type DetailsPreference } from "@/utils/detailsPreference";

/**
 * "Show more details" of one page or view (calm details spec 2.2). Starts with details off and no storage read, then reads
 * the setting and the page's own choice after mount. `setDetailed` stores the page's choice; with "more" it does nothing.
 */
export function useShowDetails(page: DetailsPage): { isDetailed: boolean; canToggle: boolean; setDetailed: (isDetailed: boolean) => void } {
    const [preference, setPreference] = useState<DetailsPreference>("fewer");
    const [pageChoice, setPageChoice] = useState(false);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration-safe one-time read of localStorage
        setPreference(readDetailsPreference());
        setPageChoice(readPageDetails(page));
    }, [page]);

    const setDetailed = useCallback((isDetailed: boolean) => {
        if (preference === "more") return;
        setPageChoice(isDetailed);
        writePageDetails(page, isDetailed);
    }, [page, preference]);

    return { ...resolveDetails(preference, pageChoice), setDetailed };
}
