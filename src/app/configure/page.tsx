"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMsal } from "@azure/msal-react";
import { ConfigureBasketProvider, useConfigureBasket, useConfigureBasketActions } from "@/contexts/ConfigureBasketContext";
import { useUnifiedActions, useUnifiedData, useUnifiedLoading } from "@/contexts/UnifiedPimContext";
import { useAccessModelCatalog } from "@/hooks/useAccessModelCatalog";
import { useConditionalAccess } from "@/hooks/useConditionalAccess";
import { applyScreens, currentState, useConfigureApply } from "@/hooks/useConfigureApply";
import { SHELL_REFRESH_EVENT } from "@/utils/refreshEvents";
import { useConfigureReview } from "@/hooks/useConfigureReview";
import { useConfigureUrlState } from "@/hooks/useConfigureUrlState";
import { useEmergencyAccounts } from "@/hooks/useEmergencyAccounts";
import { useCustomExtensions } from "@/hooks/useCustomExtensions";
import { usePrincipalSearchFn } from "@/hooks/useUserSearch";
import { useGraphClient } from "@/hooks/usePimSelectors";
import { fetchAdministrativeUnits, searchApplications } from "@/services/scopeOptionsService";
import { lookupPrincipals } from "@/services/principalLookupService";
import { useIncrementalConsent } from "@/hooks/useIncrementalConsent";
import { useNow } from "@/hooks/useNow";
import { useRolesActions, useRolesData, useRolesLoading } from "@/hooks/usePimData";
import { useTenantName } from "@/hooks/useTenantName";
import { useWriteAccess } from "@/hooks/useWriteAccess";
import { RefreshButtonView } from "@/components/ui/RefreshButton";
import { groupsOutsideLoad } from "@/utils/writeAccess";
import { touchedTargets } from "@/utils/configureBasket";
import { setWorkloadVisible } from "@/utils/workloadPreferences";
import { getHistoryEntry, listHistory } from "@/utils/configureHistory";
import { undoBlockedReason } from "@/utils/configureResult";
import { targetName } from "@/utils/configureReview";
import { buildBackup } from "@/utils/exportBackup";
import { summarizeContextPolicies } from "@/utils/configurePreflight";
import { describeAccess, describeLastApplies } from "@/utils/configureStart";
import { LiveValue } from "@/utils/liveValue";
import { ConfigureView } from "./components/ConfigureView";
import type { EditData } from "./components/edit/EditView";
import type { ModelData } from "./components/model/ModelPage";
import { readContextChoices, readGroupPlacements, writeContextChoice, writeGroupPlacement, type GroupPlacement } from "@/utils/authContextSlug";

/** localStorage, or null where it cannot be used (a private window, blocked site data) */
function safeLocalStorage(): Storage | null {
    try {
        return typeof localStorage === "undefined" ? null : localStorage;
    } catch {
        return null;
    }
}

/** sessionStorage, or null where it cannot be used */
function safeSessionStorage(): Storage | null {
    try {
        return typeof sessionStorage === "undefined" ? null : sessionStorage;
    } catch {
        return null;
    }
}

function readHistory(tenantId: string) {
    try {
        return listHistory(typeof localStorage === "undefined" ? null : localStorage, tenantId);
    } catch {
        return [];
    }
}

/** The data container of the new Configure (NG-62): MSAL, the loaded data, the access check, the catalog, the history */
function ConfigureContent({ tenantId }: { tenantId: string }) {
    const { accounts } = useMsal();
    const account = accounts[0];
    const tenantName = useTenantName(tenantId);
    const now = useNow();
    const url = useConfigureUrlState();
    const writeAccess = useWriteAccess();
    const catalog = useAccessModelCatalog();
    const { basket, isReady: isBasketReady } = useConfigureBasket();
    const { discard, replace, add: addToBasket, rebase: rebaseBasket } = useConfigureBasketActions();
    const { requestWriteConsent, requestConsent } = useIncrementalConsent();
    const { refreshAllWorkloads, enableWorkload, refreshWorkload } = useUnifiedActions();
    const { isWorkloadLoading, workloads: workloadLoading } = useUnifiedLoading();
    const { workloads } = useUnifiedData();
    const { rolesData, error, authenticationContexts } = useRolesData();
    const { loading, policiesLoading } = useRolesLoading();
    const { fetchData, fetchPolicyForRole } = useRolesActions();
    const [isGranting, setIsGranting] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);

    // Page mount: fetchData honours the 60 minute TTL and the session cache, as the Dashboard and the Report do
    useEffect(() => {
        if (rolesData.length === 0 && !loading && !error) fetchData();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- once on mount
    }, []);

    // One list per read of the contexts, so the model page's memos hold between loading ticks (U-06)
    const modelContexts = useMemo(() => authenticationContexts.map((c) => ({ id: c.id, displayName: c.displayName })), [authenticationContexts]);
    const access = useMemo(() => describeAccess(writeAccess.status, writeAccess.access, writeAccess.checkedAt, now), [writeAccess.status, writeAccess.access, writeAccess.checkedAt, now]);

    const onGrant = useCallback(async () => {
        if (access.row.kind !== "consent") return;
        setIsGranting(true);
        try {
            for (const workload of access.row.workloads) await requestWriteConsent(workload);
            // The page stays during the popup (NG-60), so the check is read again here
            await writeAccess.recheck();
        } finally {
            setIsGranting(false);
        }
    }, [access.row, requestWriteConsent, writeAccess]);

    const isBusy = isWorkloadLoading("directoryRoles") || isWorkloadLoading("pimGroups");
    // After a Refresh the waiting setting changes start from what the tenant holds now, and a change that now
    // matches leaves the basket (N-043); the rebase runs once the reads of that Refresh are in
    // The data as it was when the Refresh was pressed: the rebase waits for data newer than this
    const rebaseAfterRead = useRef<{ roles: unknown; groups: unknown } | null>(null);
    const dataRef = useRef({ roles: rolesData as unknown, groups: workloads.pimGroups.data as unknown });
    useEffect(() => { dataRef.current = { roles: rolesData, groups: workloads.pimGroups.data }; }, [rolesData, workloads.pimGroups.data]);
    const onRefresh = useCallback(async () => {
        setIsRefreshing(true);
        rebaseAfterRead.current = { ...dataRef.current };
        try {
            await refreshAllWorkloads(false);
            await writeAccess.recheck();
        } finally {
            setIsRefreshing(false);
        }
    }, [refreshAllWorkloads, writeAccess]);
    // The shell's Refresh (the only one below 640) reads the access check again and rebases too (N-044)
    const recheckRef = useRef(writeAccess.recheck);
    useEffect(() => { recheckRef.current = writeAccess.recheck; }, [writeAccess.recheck]);
    useEffect(() => {
        const onShellRefresh = () => {
            rebaseAfterRead.current = { ...dataRef.current };
            void recheckRef.current();
        };
        window.addEventListener(SHELL_REFRESH_EVENT, onShellRefresh);
        return () => window.removeEventListener(SHELL_REFRESH_EVENT, onShellRefresh);
    }, []);
    const busyForRebase = isWorkloadLoading("directoryRoles") || isWorkloadLoading("pimGroups") || policiesLoading;
    const basketRef = useRef(basket);
    useEffect(() => { basketRef.current = basket; }, [basket]);
    useEffect(() => {
        const pressed = rebaseAfterRead.current;
        if (!pressed || busyForRebase) return;
        if (pressed.roles === rolesData && pressed.groups === workloads.pimGroups.data) return;
        rebaseAfterRead.current = null;
        const now = currentState(rolesData, workloads.pimGroups.data, touchedTargets(basketRef.current));
        rebaseBasket((t, field) => now.value(t, field));
    }, [busyForRebase, rolesData, workloads.pimGroups.data, rebaseBasket]);

    const customExtensions = useCustomExtensions();
    const searchPrincipals = usePrincipalSearchFn();
    const extensionsStatus = customExtensions.status === "granted"
        ? customExtensions.loading ? "checking" : customExtensions.error ? "unavailable" : "ready"
        : customExtensions.status === "checking" ? "checking" : customExtensions.status === "noConsent" ? "noConsent" : "unavailable";
    const conditionalAccess = useConditionalAccess();
    const contextStates = useMemo(() => {
        if (conditionalAccess.status !== "ready" || !conditionalAccess.policies) return null;
        const summary = summarizeContextPolicies(conditionalAccess.policies, authenticationContexts.map((c) => c.id));
        return Object.fromEntries(Object.entries(summary).map(([id, s]) => [id, s.state]));
    }, [conditionalAccess.status, conditionalAccess.policies, authenticationContexts]);

    // The admin's label choices and group placements of the access model, kept per tenant (spec 9.3, 9.4)
    const [contextChoices, setContextChoices] = useState(() => readContextChoices(safeLocalStorage(), tenantId));
    const onChooseContext = useCallback((slug: string, contextId: string | null) => {
        writeContextChoice(safeLocalStorage(), tenantId, slug, contextId);
        setContextChoices(readContextChoices(safeLocalStorage(), tenantId));
    }, [tenantId]);
    const [groupPlacements, setGroupPlacements] = useState(() => readGroupPlacements(safeLocalStorage(), tenantId));
    const onPlaceGroup = useCallback((groupId: string, placement: GroupPlacement | null) => {
        writeGroupPlacement(safeLocalStorage(), tenantId, groupId, placement);
        setGroupPlacements(readGroupPlacements(safeLocalStorage(), tenantId));
    }, [tenantId]);
    const model: ModelData = {
        loaded: catalog.loaded ?? null,
        status: catalog.status,
        onRetry: catalog.retry,
        tenantId,
        tenantName: tenantName ?? "your tenant",
        tenantDisplayName: tenantName ?? null,
        roles: rolesData,
        groups: workloads.pimGroups.data,
        contexts: modelContexts,
        contextChoices,
        groupPlacements,
        onPlaceGroup,
        onChooseContext,
        conditionalAccessPolicies: conditionalAccess.status === "ready" ? conditionalAccess.policies : null,
        now,
    };

    const groupsPhase = workloadLoading.pimGroups.phase;
    const emergency = useEmergencyAccounts();
    const emergencyAccountIds = useMemo(() => new Set(emergency.accounts.map((a) => a.id.toLowerCase())), [emergency.accounts]);
    // The scopes of a new role assignment, read only when Add people needs them (spec 5.7)
    const getGraphClient = useGraphClient();
    const scopes = useMemo(() => ({
        loadAdministrativeUnits: async () => fetchAdministrativeUnits(await getGraphClient()),
        searchApplications: async (term: string) => searchApplications(await getGraphClient(), term),
    }), [getGraphClient]);
    const importIo = useMemo(() => ({
        lookupPrincipals: async (query: { ids: string[]; upns: string[] }) => lookupPrincipals(await getGraphClient(), query),
        loadExample: async (fileName: string) => {
            const response = await fetch(`/examples/${encodeURIComponent(fileName)}`);
            if (!response.ok) throw new Error(`The example ${fileName} could not be loaded.`);
            return response.text();
        },
    }), [getGraphClient]);
    const edit: EditData = {
        emergencyAccountIds,
        scopes,
        now,
        roles: rolesData,
        groups: workloads.pimGroups.data,
        access: writeAccess.access,
        catalog: catalog.loaded?.catalog ?? null,
        tenantName: tenantName ?? "your tenant",
        // A list that failed to read would show every linked extension as missing: only a read list counts
        customExtensions: extensionsStatus === "ready" ? customExtensions.extensions : null,
        customExtensionsStatus: extensionsStatus,
        onGrantCustomExtensions: () => void customExtensions.requestPermission(),
        onRetryPolicy: (target) => void (target.kind === "role" ? fetchPolicyForRole(target.id) : refreshWorkload("pimGroups", false)),
        contextStates,
        searchPrincipals,
        authenticationContexts,
        isRolesLoading: loading,
        isPoliciesLoading: policiesLoading,
        isGroupsLoading: groupsPhase === "fetching" || groupsPhase === "processing" || groupsPhase === "consent" || groupsPhase === "idle",
        isGroupsConsented: workloads.pimGroups.consent.consented,
        rolesError: error ?? null,
        onRetryRoles: () => void refreshWorkload("directoryRoles", true),
        groupsError: groupsPhase === "error" ? (workloadLoading.pimGroups.error ?? "Microsoft Graph did not answer.") : null,
        onRetryGroups: () => void refreshWorkload("pimGroups", false),
        // The consent popup first (enableWorkload assumes it happened), then the workload is switched on and read, as the Report
        onEnableGroups: () => {
            void requestConsent("pimGroups").then(async (isGranted) => {
                if (!isGranted) return;
                await enableWorkload("pimGroups");
                setWorkloadVisible("pimGroups", true);
            });
        },
    };

    const emergencyAccounts = useMemo(() => new Map(emergency.accounts.map((a) => [a.id, a.displayName])), [emergency.accounts]);
    const contextNames = useMemo(() => Object.fromEntries(authenticationContexts.map((c) => [c.id, c.displayName])), [authenticationContexts]);
    const extensionIds = useMemo(() => (edit.customExtensions ? new Set(edit.customExtensions.map((e) => e.id)) : null), [edit.customExtensions]);
    const words = useMemo(() => ({ contexts: authenticationContexts, extensions: edit.customExtensions }), [authenticationContexts, edit.customExtensions]);
    // A read is done when the blocking phase and the background (the role policies) are both finished: the apply
    // compares and the undo plans on the policies as read again (spec 13.3, 14.3)
    const [loadingLive] = useState(() => new LiveValue(workloadLoading));
    const [failedRolesLive] = useState(() => new LiveValue<string[]>([]));
    useEffect(() => {
        loadingLive.set(workloadLoading);
        failedRolesLive.set(workloads.directoryRoles.extras.failedRoleIds ?? []);
    });
    const readAgain = useCallback(async (list: ("directoryRoles" | "pimGroups")[], force: boolean, roleIds: readonly string[] = []) => {
        const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));
        for (const w of list) {
            await refreshWorkload(w, force);
            const deadline = Date.now() + 180_000;
            let quiet = 0;
            // Two quiet looks in a row: the background phase may start just after the blocking phase resolves
            while (quiet < 2) {
                if (Date.now() > deadline) throw new Error("Reading again took too long.");
                await pause(250);
                const state = loadingLive.get()[w];
                const busy = state.phase === "fetching" || state.phase === "processing" || state.phase === "policies" || state.background?.running === true;
                quiet = busy ? 0 : quiet + 1;
            }
            const state = loadingLive.get()[w];
            if (state.phase === "error") throw new Error(state.error ?? "Microsoft Graph did not answer.");
            // A role policy that failed in the background keeps its older copy: that is no read again
            const failed = failedRolesLive.get().filter((id) => roleIds.includes(id));
            if (w === "directoryRoles" && failed.length > 0) throw new Error(`${failed.length === 1 ? "a role policy" : `${failed.length} role policies`} could not be read`);
        }
    }, [refreshWorkload, loadingLive, failedRolesLive]);

    // The apply (NG-69): one run per click, the snapshot first, the result kept for this tab
    const roleReadAt = workloads.directoryRoles.lastFetched;
    const groupReadAt = workloads.pimGroups.lastFetched;
    const configureGroups = useMemo(() => [...workloads.pimGroups.data, ...groupsOutsideLoad(writeAccess.access, workloads.pimGroups.data)], [workloads.pimGroups.data, writeAccess.access]);
    const apply = useConfigureApply({
        tenantId,
        by: account?.name || account?.username || "",
        basket,
        isBasketReady,
        roles: rolesData,
        groups: configureGroups,
        getClient: getGraphClient,
        recheckAccess: writeAccess.recheck,
        makeBackup: (targets) => {
            const roleIds = new Set(targets.filter((t) => t.kind === "role").map((t) => t.id));
            const groupIds = new Set(targets.filter((t) => t.kind === "group").map((t) => t.id));
            return buildBackup({
                roles: rolesData.filter((r) => roleIds.has(r.definition.id)),
                groups: configureGroups.filter((g) => groupIds.has(g.group.id)),
                tenant: { id: tenantId, displayName: tenantName ?? undefined },
                readAt: {
                    ...(roleReadAt ? { directoryRoles: new Date(roleReadAt).toISOString() } : {}),
                    ...(groupReadAt ? { pimGroups: new Date(groupReadAt).toISOString() } : {}),
                },
                appVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? "",
                workloads: [...(roleIds.size ? ["directoryRoles" as const] : []), ...(groupIds.size ? ["pimGroups" as const] : [])],
                authenticationContexts,
                customExtensions: edit.customExtensions,
            });
        },
        refresh: readAgain,
        replaceBasket: (changes) => replace({ changes }),
        addToBasket: (changes) => addToBasket(changes),
        rebaseBasket,
        nameOf: (t) => targetName(t, rolesData, workloads.pimGroups.data),
        // Only from the review: an admin who went back to the mode keeps it, the result waits in the store
        showResult: () => url.update((s) => (s.step === "review" ? { ...s, step: "result" } : s)),
        openReview: url.openReview,
        history: safeLocalStorage(),
        session: safeSessionStorage(),
    });
    const history = useMemo(() => readHistory(tenantId),
        // Read again when an apply ends or an undo starts
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [tenantId, apply.run?.finishedAt, apply.undoingRunId]);
    const lastApplies = useMemo(() => describeLastApplies(history, [account?.name ?? "", account?.username ?? ""], now), [history, account?.name, account?.username, now]);
    const blockedUndo = (runId: string) => apply.undoingRunId ? "Reading the targets again…" : undoBlockedReason(getHistoryEntry(safeLocalStorage(), tenantId, runId), { access: writeAccess.access, basketCount: basket.changes.length, isRunning: apply.isRunning, isLoading: isBusy });
    const screens = applyScreens(apply, {
        nameOf: (t) => targetName(t, rolesData, workloads.pimGroups.data),
        words,
        tenantName: tenantName ?? "your tenant",
        reportHref: (t) => (t ? (t.kind === "role" ? `/report?role=${encodeURIComponent(t.id)}` : `/report?view=groups&group=${encodeURIComponent(t.id)}`) : "/report"),
        undoBlockedReason: blockedUndo,
        onBack: () => url.setMode(null),
    });
    // The result stays until the admin leaves it: leaving the result step forgets it
    const { step } = url.state;
    const { forget: forgetRun } = apply;
    // A finished run waits in the store (Back during the run, a reload while it wrote): the review shows its result
    const { run: applyRun } = apply;
    const { update: updateUrl } = url;
    // Once per run: a result the admin has seen (the result step) is not opened again from the review
    const seenRunId = useRef<string | null>(null);
    useEffect(() => {
        if (step === "result" && applyRun) seenRunId.current = applyRun.runId;
        if (step === "review" && applyRun?.finishedAt && applyRun.runId !== seenRunId.current && basket.changes.length === 0) {
            seenRunId.current = applyRun.runId;
            updateUrl((s) => (s.step === "review" ? { ...s, step: "result" } : s));
        }
    }, [step, applyRun, basket.changes.length, updateUrl]);
    const previousStep = useRef(step);
    useEffect(() => {
        if (previousStep.current === "result" && step !== "result") forgetRun();
        previousStep.current = step;
    }, [step, forgetRun]);

    const review = useConfigureReview({
        isReviewing: url.state.step === "review" && url.state.mode !== null && url.state.mode !== "model",
        roles: rolesData,
        groups: configureGroups,
        userId: account?.localAccountId ?? null,
        access: writeAccess.access,
        recheck: writeAccess.recheck,
        emergencyAccounts,
        conditionalAccess,
        words,
        contextNames,
        customExtensionIds: extensionIds,
        onBack: () => url.setStep(null),
        onGrant: (workloads) => {
            void (async () => {
                for (const workload of workloads) await requestWriteConsent(workload);
                await writeAccess.recheck();
            })();
        },
        onApply: apply.apply,
        applyBlockedReason: apply.isRunning ? "An apply is running." : null,
        progress: screens.progress,
        undoWarnings: apply.undoWarnings,
        emptyReason: apply.emptyReason,
    });

    return (
        <ConfigureView
            tenantName={tenantName ?? "your tenant"}
            url={url}
            access={access}
            onRetryAccess={() => void writeAccess.recheck()}
            onGrant={() => void onGrant()}
            isGranting={isGranting}
            refresh={<RefreshButtonView isDisabled={isBusy || isRefreshing} isLoading={isRefreshing} onRefresh={() => void onRefresh()} className="max-sm:hidden" />}
            catalogRoleCount={catalog.loaded?.catalog.roles.length ?? null}
            lastApplies={lastApplies}
            undoBlockedReason={blockedUndo}
            onUndo={apply.undo}
            undoNotice={apply.undoError?.message ?? null}
            basket={{ changeCount: basket.changes.length, targetCount: touchedTargets(basket).length }}
            onDiscard={discard}
            reportHref="/report"
            edit={edit}
            importIo={importIo}
            model={model}
            review={review}
            result={{ ...screens.result, notice: apply.undoError && apply.undoError.runId === apply.run?.runId ? apply.undoError.message : null }}
        />
    );
}

function ConfigureSwitch() {
    const { accounts } = useMsal();
    const tenantId = accounts[0]?.tenantId ?? "";
    return (
        <ConfigureBasketProvider tenantId={tenantId}>
            <ConfigureContent tenantId={tenantId} />
        </ConfigureBasketProvider>
    );
}

export default function ConfigurePage() {
    return (
        <Suspense fallback={null}>
            <ConfigureSwitch />
        </Suspense>
    );
}
