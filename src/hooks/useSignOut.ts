"use client";

import { useCallback } from "react";
import { useMsal } from "@azure/msal-react";
import { useUnifiedActions } from "@/contexts/UnifiedPimContext";
import { clearPimSessionCaches } from "@/utils/cacheUtils";
import { clearCustomExtensionsCache } from "@/hooks/useCustomExtensions";
import { clearStoredBaskets } from "@/utils/configureBasket";
import { clearConfigureHistory } from "@/utils/configureHistory";

/** Clears the cached Graph data (see utils/cacheUtils.ts), the Configure basket and history and the loaded data, then signs out of Microsoft Entra ID. */
export function useSignOut(): () => void {
    const { instance } = useMsal();
    const { clearWorkload } = useUnifiedActions();

    return useCallback(() => {
        clearPimSessionCaches();
        clearStoredBaskets(typeof sessionStorage === "undefined" ? null : sessionStorage);
        // Reading localStorage itself throws when site data is blocked
        let local: Storage | null = null;
        try { local = typeof localStorage === "undefined" ? null : localStorage; } catch { /* blocked: nothing stored */ }
        clearConfigureHistory(local, typeof sessionStorage === "undefined" ? null : sessionStorage);
        clearCustomExtensionsCache();
        clearWorkload("directoryRoles");
        clearWorkload("pimGroups");
        instance.logoutRedirect({ postLogoutRedirectUri: window.location.origin });
    }, [instance, clearWorkload]);
}
