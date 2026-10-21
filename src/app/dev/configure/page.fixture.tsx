"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { notFound, useRouter, useSearchParams } from "next/navigation";
import { FIXTURES_ENABLED } from "@/config/fixtures";
import { useTheme } from "@/components/ThemeProvider";
import { ShellFrame, type ShellMenu } from "@/components/shell/ShellFrame";
import { RefreshButtonView } from "@/components/ui/RefreshButton";
import { ConfigureBasketProvider, useConfigureBasket, useConfigureBasketActions } from "@/contexts/ConfigureBasketContext";
import { useConfigureUrlState } from "@/hooks/useConfigureUrlState";
import { touchedTargets } from "@/utils/configureBasket";
import { describeAccess, describeLastApplies } from "@/utils/configureStart";
import { CONFIGURE_MODES } from "@/utils/configureUrlState";
import { ConfigureView } from "@/app/configure/components/ConfigureView";
import type { EditData } from "@/app/configure/components/edit/EditView";
import type { ModelData } from "@/app/configure/components/model/ModelPage";
import type { GroupPlacement } from "@/utils/authContextSlug";
import type { GuidedState } from "@/utils/guidedRoute";
import { buildPreflight } from "@/utils/configurePreflight";
import { approverRoleHolders, buildTargetStates, describeReview, dryRunItems, targetName, type ReviewData } from "@/utils/configureReview";
import bundledCatalog from "@/config/accessModel/eam-catalog.json";
import { parseAccessModelCatalog } from "@/utils/accessModelCatalog";
import { PEOPLE, REPORT_AUTH_CONTEXTS, REPORT_EMERGENCY_IDS, REPORT_EXTENSIONS, buildReportGroups, buildReportRoles } from "@/__tests__/fixtures/reportFixture";
import type { Client } from "@microsoft/microsoft-graph-client";
import { newImportSession, type ImportIo, type ImportSession } from "@/app/configure/components/import/importSession";
import type { ImportKind } from "@/utils/importDetect";
import type { PrincipalRef } from "@/types/configure.types";
import { applyScreens, useConfigureApply } from "@/hooks/useConfigureApply";
import { getHistoryEntry, saveHistoryEntry, type HistoryEntry, type UndoCurrentState } from "@/utils/configureHistory";
import { currentState } from "@/hooks/useConfigureApply";
import type { FreshState } from "@/utils/applyPlan";
import type { BasketAdd, BasketSetting, Change, Target } from "@/types/configure.types";
import { LiveValue } from "@/utils/liveValue";
import { applySettingChanges } from "@/utils/policyRules";
import type { ApplyRun } from "@/utils/configureResult";
import { changeId } from "@/utils/configureBasket";
import { undoBlockedReason } from "@/utils/configureResult";
import { buildBackup } from "@/utils/exportBackup";
import { IMPORT_ACCESS_MODEL_JSON, IMPORT_GROUP_POLICIES_CSV, IMPORT_ROLE_POLICIES_CSV, IMPORT_EXTRA_PEOPLE, IMPORT_GROUP_ASSIGNMENTS_CSV, IMPORT_OLDER_REMOVALS_CSV, IMPORT_ROLE_ASSIGNMENTS_CSV, IMPORT_UNKNOWN_CSV, CONFIGURE_CATALOG_ROLES, CONFIGURE_HISTORY, CONFIGURE_NOW, CONFIGURE_TENANT_ID, FIXTURE_ACCESS, buildFixtureAccess, buildFixtureBasket, buildFixtureRun, buildReviewBasket, type FixtureAccess } from "@/__tests__/fixtures/configureFixture";

/**
 * The new Configure with the Contoso data of the renders and no sign-in (NG-62). Only with NEXT_PUBLIC_FIXTURES=1.
 * Query: `screen` = start | edit | guided | import | model (turned into the real `mode` once), `admin` = pra (default) |
 * groups | owner | eligible | none | consent, `state` = checking | failed, `basket` = number of changes, or `review` for the four changes of the review render (seeds an empty
 * basket; the basket is kept in sessionStorage, so a reload restores it), `history=0` for no Last applies. Edit lists
 * the roles and groups of the Report fixture; `groups=off` shows Groups without consent, `groups=failed` and `roles=failed` a failed read, `data=loading` the lists loading, `catalog=fallback` the bundled catalog line; the review (`step=review`) runs the real pre-flight on the fixture basket, `dryRun=fail` refuses the new assignments, `confirm=1` opens the removal confirmation, Apply runs the real engine on a fake client (`apply=progress` shows the progress list, `step=result` the result render, `import=assignments|groups|removals|unknown|policies|groupPolicies|model` Import with that file already chosen (`mode=import`), `undo=fixture-result` the undo review of that run with a value changed meanwhile), `ticks=id,id` the targets ticked in Select several (`select=several`).
 */
const ROLES = buildReportRoles();
const GROUPS = buildReportGroups();
const GROUP_LIKES = GROUPS.map((g) => ({ id: g.group.id, displayName: g.group.displayName, isAssignableToRole: g.group.isAssignableToRole ?? null, isUnderPim: g.isManaged !== false }));
const parsedCatalog = parseAccessModelCatalog(bundledCatalog);
const CATALOG = parsedCatalog.ok ? parsedCatalog.catalog : null;
/** Contexts of the access model fixture: one label matched by name, one not */
const MODEL_CONTEXTS = [{ id: "c-sif", displayName: "Phish-resistant SIF" }, ...REPORT_AUTH_CONTEXTS.map((c) => ({ id: c.id, displayName: c.displayName }))];
/** People and groups of the Report fixture for the approver search, without Graph */
const SEARCH = async (term: string, options?: { onlyRoleAssignableGroups?: boolean }) => {
    const t = term.toLowerCase();
    const people = Object.values(PEOPLE).filter((p) => p.displayName.toLowerCase().includes(t)).map((p) => ({ id: p.id, kind: "user" as const, displayName: p.displayName, userPrincipalName: "userPrincipalName" in p ? String(p.userPrincipalName) : "" }));
    const found = GROUPS.filter((g) => g.group.displayName.toLowerCase().includes(t) && (!options?.onlyRoleAssignableGroups || g.group.isAssignableToRole === true))
        .map((g) => ({ id: g.group.id, kind: "group" as const, displayName: g.group.displayName, userPrincipalName: "", isAssignableToRole: g.group.isAssignableToRole === true }));
    return [...people, ...found].slice(0, 8);
};
/** The roles with the template ids of the catalog (by name), for the access model in Guided (`guided=model`) */
const ROLES_IN_CATALOG = ROLES.map((r) => {
    const entry = CATALOG?.roles.find((c) => c.displayName === r.definition.displayName);
    return entry && !r.definition.templateId ? { ...r, definition: { ...r.definition, templateId: entry.templateId } } : r;
});
/** Guided at a step with the choices of a screen: `guided=render` is the render `guided-settings` (with `gstep=3`) */
const GUIDED_PRESETS: Record<string, Partial<GuidedState>> = {
    render: { ticks: ["role-ga", "role-sec", "role-ua"], overrides: { all: { set: { maxActivationDuration: "PT2H" }, kept: [] } } },
    copy: { from: "copy", copySourceId: "role-pra", parts: ["activation", "assignment"], ticks: ["role-sec", "role-exo"] },
    model: { from: "model", parts: ["activation", "assignment"], ticks: ["role-ga", "role-pra", "role-sec", "role-exo", "role-dev"] },
    "groups-start": { workload: "groups", side: "both" },
    groups: { workload: "groups", side: "both", from: "model", parts: ["activation", "assignment"], ticks: ["g-tier0", "g-helpdesk1"] },
    people: { parts: ["activation", "people"], ticks: ["role-ga", "role-ua"] },
};
/** Administrative units and applications without Graph */
const FIXTURE_SCOPES = {
    loadAdministrativeUnits: async () => [{ id: "au-nl", displayName: "Netherlands" }, { id: "au-de", displayName: "Germany" }],
    searchApplications: async (term: string) => [{ id: "app-payroll", displayName: "Payroll" }, { id: "app-portal", displayName: "Partner portal" }].filter((a) => a.displayName.toLowerCase().includes(term.toLowerCase())),
};
/**
 * The apply of the fixture without Graph: every write answers after 350 ms, the rule of the maximum activation
 * duration answers 400 InvalidPolicy (the failed row of the result render), reads find nothing.
 */
const FAKE_CLIENT = {
    api: (url: string) => {
        const request = {
            version: () => request,
            filter: () => request,
            get: async () => ({ value: [] }),
            patch: async () => {
                await new Promise((done) => setTimeout(done, 350));
                if (url.endsWith("/rules/Expiration_EndUser_Assignment")) throw Object.assign(new Error("The policy is invalid."), { statusCode: 400, code: "InvalidPolicy", body: JSON.stringify({ code: "InvalidPolicy", message: "The policy is invalid." }) });
                return {};
            },
            post: async () => {
                await new Promise((done) => setTimeout(done, 350));
                return { isValidationOnly: false };
            },
        };
        return request;
    },
} as unknown as Client;

/** The fixture's look-up of people: the Report fixture's people and Megan Bowen, never Graph */
const FIXTURE_IO: ImportIo = {
    lookupPrincipals: async ({ ids, upns }) => {
        const all: PrincipalRef[] = [
            ...Object.values(PEOPLE).map((p) => ({ id: p.id, kind: "user" as const, displayName: p.displayName, userPrincipalName: "userPrincipalName" in p ? String(p.userPrincipalName) : undefined })),
            ...IMPORT_EXTRA_PEOPLE,
        ];
        const byId = new Map(all.filter((p) => ids.some((i) => i.toLowerCase() === p.id.toLowerCase())).map((p) => [p.id.toLowerCase(), p]));
        const byUpn = new Map(all.filter((p) => p.userPrincipalName && upns.some((u) => u.toLowerCase() === p.userPrincipalName!.toLowerCase())).map((p) => [p.userPrincipalName!.toLowerCase(), p]));
        return { byId, byUpn };
    },
    loadExample: async (fileName) => {
        const response = await fetch(`/examples/${encodeURIComponent(fileName)}`);
        if (!response.ok) throw new Error("The example could not be loaded.");
        return response.text();
    },
};
/** `import=assignments|groups|removals|unknown|policies|groupPolicies|model`: Import starts with that file read (the renders of the check) */
const IMPORT_PRESETS: Record<string, ImportSession> = {
    assignments: newImportSession("pim-bulk-role-assignments.csv", IMPORT_ROLE_ASSIGNMENTS_CSV),
    groups: newImportSession("pim-bulk-group-assignments.csv", IMPORT_GROUP_ASSIGNMENTS_CSV),
    removals: newImportSession("role-removals.csv", IMPORT_OLDER_REMOVALS_CSV),
    unknown: newImportSession("people.csv", IMPORT_UNKNOWN_CSV),
    policies: newImportSession("pim-bulk-role-policies.csv", IMPORT_ROLE_POLICIES_CSV),
    groupPolicies: newImportSession("pim-bulk-group-policies.csv", IMPORT_GROUP_POLICIES_CSV),
    model: newImportSession("pim-access-model.json", IMPORT_ACCESS_MODEL_JSON),
};

/** The history of the fixture in memory, seeded with the Last applies line */
function memoryStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
    const map = new Map<string, string>();
    return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}
const FIXTURE_HISTORY = memoryStorage();
function historyEntryOf(run: ApplyRun): HistoryEntry {
    return {
        runId: run.runId, at: run.startedAt, by: "Alex Wilber", changes: run.changes, targetCount: run.targetCount,
        results: Object.fromEntries(Object.entries(run.progress).filter(([, v]) => typeof v === "object")) as HistoryEntry["results"],
        snapshot: { schemaVersion: 1, app: { name: "PIM Manager", version: "3.2.0" }, tenant: { id: CONFIGURE_TENANT_ID, displayName: "Contoso" }, readAt: {}, exportedAt: run.startedAt, workloads: ["directoryRoles"], lists: { authenticationContexts: [], customExtensions: [] } },
    };
}
for (const entry of [...CONFIGURE_HISTORY].reverse()) saveHistoryEntry(FIXTURE_HISTORY, CONFIGURE_TENANT_ID, entry);
for (const entry of [historyEntryOf(buildFixtureRun(true))]) saveHistoryEntry(FIXTURE_HISTORY, CONFIGURE_TENANT_ID, entry);

/**
 * The tenant of the fixture after an apply: the Report fixture with the written changes of the run shown (or of the
 * result render's run) on top, so the read again matches; before an undo someone else has switched Privileged Role
 * Administrator's activation requirement off, so the undo review warns "changed by someone else".
 */
const FIXTURE_APPLIED = new LiveValue<Change[]>([]);
function fixtureState(meanwhile: boolean): FreshState & UndoCurrentState {
    const done = FIXTURE_APPLIED.get();
    const base = currentState(ROLES, GROUPS, ROLES.map((r) => ({ kind: "role" as const, id: r.definition.id })));
    const key = (t: Target) => JSON.stringify(t);
    const settings = (t: Target) => {
        const read = base.settings(t);
        if (!read) return null;
        const next = applySettingChanges(read, done.filter((c): c is BasketSetting => c.kind === "setting" && key(c.target) === key(t)).map((c) => ({ field: c.field, to: c.to })));
        return meanwhile && t.kind === "role" && t.id === "role-pra" ? { ...next, activationRequirement: "none" as const, authenticationContextId: undefined } : next;
    };
    const assignments = (t: Target) => [
        ...base.assignments(t).filter((a) => !done.some((c) => c.kind === "remove" && key(c.target) === key(t) && c.schedule.principal.id === a.principalId && c.schedule.type === a.type)),
        ...done.filter((c): c is BasketAdd => c.kind === "add" && key(c.target) === key(t)).map((c) => ({ principalId: c.principal.id, type: c.type, scope: c.scope, start: CONFIGURE_NOW.toISOString(), end: c.end })),
    ];
    return {
        settings,
        assignments,
        assignment: (t, principalId, scope, type) => {
            const found = assignments(t).find((a) => a.principalId === principalId && (a.scope || "/") === (scope || "/") && a.type === type);
            return found ? { end: found.end } : null;
        },
    };
}
const FIXTURE_FRESH: FreshState = { settings: (t) => fixtureState(false).settings(t), assignment: (...a) => fixtureState(false).assignment(...a) };
const FIXTURE_BEFORE_UNDO: UndoCurrentState = { settings: (t) => fixtureState(true).settings(t), assignments: (t) => fixtureState(true).assignments(t) };

function ConfigureFixtureBody() {
    const params = useSearchParams();
    const router = useRouter();
    const url = useConfigureUrlState();
    const { basket, isReady: isBasketReady } = useConfigureBasket();
    const { discard } = useConfigureBasketActions();

    useEffect(() => {
        const screen = params.get("screen");
        if (!screen) return;
        const next = new URLSearchParams(params.toString());
        next.delete("screen");
        if ((CONFIGURE_MODES as readonly string[]).includes(screen)) next.set("mode", screen);
        router.replace(`/dev/configure${next.toString() ? `?${next}` : ""}`, { scroll: false });
        // Once: the screen parameter is gone after this
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // `admin`, not `access`: `access` is the page's own Member or Owner parameter (spec 2)
    const kind = (FIXTURE_ACCESS as readonly string[]).includes(params.get("admin") ?? "") ? (params.get("admin") as FixtureAccess) : "pra";
    const state = params.get("state");
    const status = state === "checking" ? "checking" : state === "failed" ? "failed" : "ready";
    const access = useMemo(() => describeAccess(status, status === "ready" ? buildFixtureAccess(kind) : null, CONFIGURE_NOW, CONFIGURE_NOW), [status, kind]);
    const lastApplies = useMemo(() => (params.get("history") === "0" ? [] : describeLastApplies(CONFIGURE_HISTORY, ["Alex Wilber"], CONFIGURE_NOW)), [params]);
    const isLoading = params.get("data") === "loading";
    const isGroupsFailed = params.get("groups") === "failed";
    const isRolesFailed = params.get("roles") === "failed";
    const guidedName = params.get("guided");
    const edit: EditData = useMemo(() => ({
        roles: isLoading || isRolesFailed ? [] : guidedName === "model" ? ROLES_IN_CATALOG : ROLES,
        groups: isLoading || isGroupsFailed ? [] : GROUPS,
        access: status === "ready" ? buildFixtureAccess(kind, { groups: GROUP_LIKES, ownedGroup: { id: "g-helpdesk1", displayName: "Helpdesk Tier 1" } }) : null,
        catalog: CATALOG,
        tenantName: "Contoso",
        customExtensions: REPORT_EXTENSIONS,
        customExtensionsStatus: "ready",
        onGrantCustomExtensions: () => undefined,
        onRetryPolicy: () => undefined,
        contextStates: { c1: "reportOnly" },
        searchPrincipals: SEARCH,
        authenticationContexts: REPORT_AUTH_CONTEXTS,
        isRolesLoading: isLoading,
        isPoliciesLoading: isLoading,
        isGroupsLoading: isLoading,
        isGroupsConsented: params.get("groups") !== "off",
        onEnableGroups: () => undefined,
        rolesError: isRolesFailed ? "Microsoft Graph did not answer." : null,
        onRetryRoles: () => undefined,
        groupsError: isGroupsFailed ? "Microsoft Graph did not answer." : null,
        onRetryGroups: () => undefined,
        initialTicks: params.get("ticks")?.split(",").filter(Boolean),
        emergencyAccountIds: new Set(REPORT_EMERGENCY_IDS),
        scopes: FIXTURE_SCOPES,
        now: CONFIGURE_NOW,
    }), [isLoading, isGroupsFailed, isRolesFailed, status, kind, params, guidedName]);
    const [contextChoices, setContextChoices] = useState<Record<string, string>>({});
    // `guided=groups` has one group placed by the admin; Tier 0 Admins is proposed from the role it holds
    const [groupPlacements, setGroupPlacements] = useState<Record<string, GroupPlacement>>((): Record<string, GroupPlacement> => (params.get("guided") === "groups" ? { "g-helpdesk1": { plane: "Management", securityLevel: "Specialized" } } : {}));
    const catalogState = params.get("catalog");
    const model: ModelData = useMemo(() => ({
        loaded: CATALOG ? { catalog: CATALOG, origin: catalogState === "fallback" ? "bundled" as const : "live" as const, fallbackReason: catalogState === "fallback" ? "unreachable" as const : undefined, readAt: new Date(2026, 9, 4, 11, 40) } : null,
        status: "ready",
        onRetry: () => undefined,
        tenantId: CONFIGURE_TENANT_ID,
        tenantName: "Contoso",
        tenantDisplayName: "Contoso",
        roles: ROLES,
        groups: GROUPS,
        contexts: MODEL_CONTEXTS,
        contextChoices,
        onChooseContext: (slug, contextId) => setContextChoices((current) => {
            const next = { ...current };
            if (contextId) next[slug] = contextId;
            else delete next[slug];
            return next;
        }),
        conditionalAccessPolicies: null,
        groupPlacements,
        onPlaceGroup: (groupId, placement) => setGroupPlacements((current) => {
            const next = { ...current };
            if (placement) next[groupId] = placement;
            else delete next[groupId];
            return next;
        }),
        now: CONFIGURE_NOW,
    }), [catalogState, groupPlacements, contextChoices]);
    // The review of the fixture basket through the real pre-flight; the dry run accepts every add (`dryRun=fail` refuses them)
    const isReviewing = url.state.step === "review" && url.state.mode !== null && url.state.mode !== "model";
    const dryRunFails = params.get("dryRun") === "fail";
    const { leaveOut, replace, add, rebase } = useConfigureBasketActions();
    // `step=result` shows the result render, `apply=progress` the progress list; Apply runs the engine on a fake client
    const [initialRun] = useState(() => (params.get("step") === "result" ? buildFixtureRun(true) : params.get("apply") === "progress" ? buildFixtureRun(false) : undefined));
    const apply = useConfigureApply({
        tenantId: CONFIGURE_TENANT_ID,
        by: "Alex Wilber",
        basket,
        roles: ROLES,
        groups: GROUPS,
        getClient: async () => FAKE_CLIENT,
        makeBackup: (targets) => buildBackup({
            roles: ROLES.filter((r) => targets.some((t) => t.kind === "role" && t.id === r.definition.id)),
            groups: GROUPS.filter((g) => targets.some((t) => t.kind === "group" && t.id === g.group.id)),
            tenant: { id: CONFIGURE_TENANT_ID, displayName: "Contoso" },
            readAt: {},
            appVersion: "3.2.0",
            workloads: ["directoryRoles", "pimGroups"],
            authenticationContexts: REPORT_AUTH_CONTEXTS,
            customExtensions: REPORT_EXTENSIONS,
        }),
        refresh: async () => undefined,
        isBasketReady,
        recheckAccess: async () => edit.access,
        replaceBasket: (changes) => replace({ changes }),
        addToBasket: (changes) => add(changes),
        rebaseBasket: rebase,
        nameOf: (t) => targetName(t, ROLES, GROUPS),
        showResult: () => url.update((s) => ({ ...s, step: "result" })),
        openReview: url.openReview,
        history: FIXTURE_HISTORY,
        session: null,
        initialRun,
        freshOverride: FIXTURE_FRESH,
        currentOverride: FIXTURE_BEFORE_UNDO,
    });
    const reviewView = useMemo(() => {
        if (!isReviewing) return null;
        const states = buildTargetStates(ROLES, GROUPS, touchedTargets(basket));
        const adds = dryRunItems(basket);
        const checks = buildPreflight({
            basket,
            targets: states.preflight,
            me: { userId: "u-alex", access: edit.access },
            emergencyAccounts: new Map(REPORT_EMERGENCY_IDS.map((id) => [id, id === "u-bg1" ? "Break Glass 1" : "Break Glass 2"])),
            approverRoles: approverRoleHolders(ROLES, new Map()),
            conditionalAccess: { status: "ready", contexts: { c1: { state: "reportOnly", authenticationStrengthIds: [], signInFrequencyEveryTime: false, compliantDevice: false } } },
            contextNames: Object.fromEntries(REPORT_AUTH_CONTEXTS.map((c) => [c.id, c.displayName])),
            customExtensionIds: new Set(REPORT_EXTENSIONS.map((e) => e.id)),
            dryRun: Object.fromEntries(adds.map((a) => [a.id, dryRunFails ? { ok: false as const, message: "The policy does not allow an eligible assignment without an end.", transient: false } : { ok: true as const }])),
            now: CONFIGURE_NOW,
            undoWarnings: apply.undoWarnings,
        });
        return describeReview({ basket, checks, nameOf: (t) => targetName(t, ROLES, GROUPS), words: { contexts: REPORT_AUTH_CONTEXTS, extensions: REPORT_EXTENSIONS } });
    }, [isReviewing, basket, edit.access, dryRunFails, apply.undoWarnings]);
    // The fixture's tenant after an apply: the written changes of the run shown, else of the result render's run
    useEffect(() => {
        const run = apply.run ?? buildFixtureRun(true);
        FIXTURE_APPLIED.set(run.changes.filter((c) => { const r = run.progress[changeId(c)]; return typeof r === "object" && r.status === "done"; }));
    }, [apply.run]);
    // `undo={runId}` starts "Undo this apply" once (the undo review of the visual check)
    const undoParam = params.get("undo");
    const { undo } = apply;
    useEffect(() => {
        if (undoParam) undo(undoParam);
        // Once on mount
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const blocked = access.row.kind === "open" ? null : access.row.kind === "consent" ? "PIM Manager may not write yet." : "You cannot change these roles now.";
    const blockedUndo = (runId: string) => blocked ?? undoBlockedReason(getHistoryEntry(FIXTURE_HISTORY, CONFIGURE_TENANT_ID, runId) ?? (apply.run?.runId === runId ? { changes: apply.run.changes, results: apply.run.progress as never } : null), { access: edit.access, basketCount: basket.changes.length, isRunning: apply.isRunning });
    const screens = applyScreens(apply, {
        nameOf: (t) => targetName(t, ROLES, GROUPS),
        words: { contexts: REPORT_AUTH_CONTEXTS, extensions: REPORT_EXTENSIONS },
        tenantName: "Contoso",
        reportHref: () => "/dev/report",
        undoBlockedReason: blockedUndo,
        onBack: () => url.setMode(null),
    });
    const review: ReviewData = {
        view: reviewView,
        onLeaveOut: leaveOut,
        onBack: () => url.setStep(null),
        onApply: apply.apply,
        applyBlockedReason: apply.isRunning ? "An apply is running." : null,
        progress: screens.progress,
        onFix: () => undefined,
        startConfirming: params.get("confirm") === "1",
    };

    return (
        <ConfigureView
            guidedPreset={guidedName ? GUIDED_PRESETS[guidedName] : undefined}
            importIo={FIXTURE_IO}
            importReferenceOpen={(params.get("reference") as ImportKind | null) ?? null}
            importPreset={params.get("import") ? IMPORT_PRESETS[params.get("import") as string] ?? null : null}
            tenantName="Contoso"
            url={url}
            access={access}
            onRetryAccess={() => undefined}
            onGrant={() => undefined}
            isGranting={false}
            refresh={<RefreshButtonView isDisabled={false} onRefresh={() => undefined} className="max-sm:hidden" />}
            catalogRoleCount={CONFIGURE_CATALOG_ROLES}
            lastApplies={lastApplies}
            undoBlockedReason={blockedUndo}
            onUndo={apply.undo}
            basket={{ changeCount: basket.changes.length, targetCount: touchedTargets(basket).length }}
            onDiscard={discard}
            reportHref="/dev/report"
            edit={edit}
            model={model}
            review={review}
            result={screens.result}
        />
    );
}

function ConfigureFixture() {
    const { theme, setTheme } = useTheme();
    const params = useSearchParams();
    const [openMenu, setOpenMenu] = useState<ShellMenu>(null);
    const seed = useMemo(() => (params.get("basket") === "review" ? buildReviewBasket() : buildFixtureBasket(Number(params.get("basket") ?? 0))), [params]);
    return (
        <ShellFrame
            currentPath="/configure"
            account={{
                user: { displayName: "Alex Wilber", userPrincipalName: "alexw@contoso.com", initials: "AW" },
                tenantName: "Contoso",
                tenantId: CONFIGURE_TENANT_ID,
                theme,
                onThemeChange: setTheme,
                updateInfo: null,
                appVersion: "v3.2.0",
                hasUnseenWhatsNew: false,
                onOpenWhatsNew: () => undefined,
                onOpenHelp: () => undefined,
                onSignOut: () => undefined,
            }}
            isRefreshing={false}
            onRefresh={() => undefined}
            openMenu={openMenu}
            onOpenMenuChange={setOpenMenu}
        >
            <ConfigureBasketProvider tenantId={`fixture-${CONFIGURE_TENANT_ID}`} initialBasket={seed}>
                <ConfigureFixtureBody />
            </ConfigureBasketProvider>
        </ShellFrame>
    );
}

export default function ConfigureFixturePage() {
    if (!FIXTURES_ENABLED) notFound();
    return (
        <Suspense fallback={null}>
            <ConfigureFixture />
        </Suspense>
    );
}
