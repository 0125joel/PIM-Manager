"use client";

import { announceShellRefresh } from "@/utils/refreshEvents";
import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useMsal } from "@azure/msal-react";
import { HelpPanel, type HelpView } from "@/components/shell/HelpPanel";
import { requestTourRestart } from "@/hooks/useOnboarding";
import { useTheme } from "@/components/ThemeProvider";
import { useUnifiedActions } from "@/contexts/UnifiedPimContext";
import { useLoadingSnapshot } from "@/hooks/useLoadingSnapshot";
import { useSignOut } from "@/hooks/useSignOut";
import { useTenantName } from "@/hooks/useTenantName";
import { useUpdateCheck } from "@/hooks/useUpdateCheck";
import { useWhatsNew } from "@/hooks/useWhatsNew";
import { REDIRECT_BRIDGE_PATH } from "@/config/authConfig";
import { getInitials } from "@/utils/shellNavigation";
import { OPEN_HELP_EVENT, type OpenHelpDetail } from "@/utils/helpEvents";
import { ShellFrame, type ShellMenu } from "./ShellFrame";
import { DemoBanner } from "./DemoBanner";
import { useDemoMode } from "@/contexts/DemoModeContext";

/**
 * Container of the app shell: reads MSAL, the loading state and the theme, owns the account menu and the help panel in the
 * dock, and renders `ShellFrame`. Visitors who are not signed in, the landing page and the MSAL redirect bridge get no shell.
 */
export function AppShell({ children }: { children: ReactNode }) {
    const pathname = usePathname();
    const router = useRouter();
    const { accounts } = useMsal();
    const { theme, setTheme } = useTheme();
    const { refreshAllWorkloads } = useUnifiedActions();
    const snapshot = useLoadingSnapshot();
    // Same flags the pages use to disable their own Refresh buttons
    const isGlobalLoading = snapshot.rolesLoading || snapshot.policiesLoading || snapshot.groupsLoading;
    const signOut = useSignOut();
    const updateInfo = useUpdateCheck();
    const whatsNew = useWhatsNew();
    const [openMenu, setOpenMenu] = useState<ShellMenu>(null);
    const [showHelp, setShowHelp] = useState(false);
    const [helpView, setHelpView] = useState<HelpView>("help");
    const [helpTerm, setHelpTerm] = useState<string | undefined>(undefined);
    const isDemo = useDemoMode();

    // A page can ask for the help at a term (the Report's Preview tag)
    useEffect(() => {
        const onOpen = (event: Event) => {
            setHelpTerm((event as CustomEvent<OpenHelpDetail>).detail?.term);
            setHelpView("help");
            setShowHelp(true);
        };
        window.addEventListener(OPEN_HELP_EVENT, onOpen);
        return () => window.removeEventListener(OPEN_HELP_EVENT, onOpen);
    }, []);

    const account = accounts[0];
    const tenantName = useTenantName(account?.tenantId);

    const isShellPage = pathname !== "/" && pathname !== REDIRECT_BRIDGE_PATH;
    if (!account || !isShellPage) {
        return <>{children}</>;
    }

    const user = {
        displayName: account.name || account.username,
        userPrincipalName: account.username,
        initials: getInitials(account.name, account.username),
    };

    return (
        <>
            <ShellFrame
                currentPath={pathname ?? ""}
                account={{
                    user,
                    tenantName,
                    tenantId: account.tenantId,
                    theme,
                    onThemeChange: setTheme,
                    updateInfo,
                    appVersion: whatsNew.version,
                    hasUnseenWhatsNew: whatsNew.hasUnseen,
                    onOpenWhatsNew: () => {
                        whatsNew.markSeen();
                        setHelpView("whatsNew");
                        setShowHelp(true);
                    },
                    onOpenHelp: () => {
                        setHelpView("help");
                        setShowHelp(true);
                    },
                    onSignOut: signOut,
                    signOutLabel: isDemo ? "Exit demo" : undefined,
                }}
                banner={isDemo ? <DemoBanner /> : undefined}
                isRefreshing={isGlobalLoading}
                onRefresh={() => { announceShellRefresh(); void refreshAllWorkloads(false); }}
                openMenu={openMenu}
                onOpenMenuChange={setOpenMenu}
                dock={showHelp ? (
                    <HelpPanel
                        pathname={pathname ?? ""}
                        view={helpView}
                        onViewChange={(view) => {
                            if (view === "whatsNew") whatsNew.markSeen();
                            setHelpView(view);
                        }}
                        term={helpTerm}
                        onClose={() => {
                            setHelpTerm(undefined);
                            setShowHelp(false);
                        }}
                        onOpenGuide={() => {
                            setHelpTerm(undefined);
                            setShowHelp(false);
                            router.push("/help");
                        }}
                        onStartTour={() => {
                            setHelpTerm(undefined);
                            setShowHelp(false);
                            requestTourRestart();
                        }}
                        appVersion={whatsNew.version}
                    />
                ) : undefined}
            >
                {children}
            </ShellFrame>
        </>
    );
}
