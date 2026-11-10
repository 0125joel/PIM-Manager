"use client";

import { createContext, useContext, type ReactNode } from "react";

/** Whether the Report shows its details (calm details spec 2.2). Without a provider: true, so fixtures and other pages are unchanged. */
const DetailsContext = createContext(true);

export function DetailsProvider({ isDetailed, children }: { isDetailed: boolean; children: ReactNode }) {
    return <DetailsContext.Provider value={isDetailed}>{children}</DetailsContext.Provider>;
}

export function useIsDetailed(): boolean {
    return useContext(DetailsContext);
}
