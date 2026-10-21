"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * True in a demo tab (`src/demo`). Components read it to disable what needs a real tenant (applying changes) and to
 * explain why; everything else in the demo is the real app. False everywhere else, including the fixture routes.
 */
const DemoModeContext = createContext(false);

export function DemoModeProvider({ children }: { children: ReactNode }) {
    return <DemoModeContext.Provider value={true}>{children}</DemoModeContext.Provider>;
}

export function useDemoMode(): boolean {
    return useContext(DemoModeContext);
}

/** The one sentence every disabled demo action shows */
export const DEMO_DISABLED_REASON = "Not available in the demo environment. Sign in with your own tenant to make changes.";
