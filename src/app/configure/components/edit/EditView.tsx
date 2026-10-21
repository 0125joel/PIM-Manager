"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { StatusBox } from "@/components/ui/StatusBox";
import { useConfigureBasket, useConfigureBasketActions } from "@/contexts/ConfigureBasketContext";
import type { ConfigureUrlActions } from "@/hooks/useConfigureUrlState";
import type { ConfigureUrlState } from "@/utils/configureUrlState";
import type { ConfigureTab, Target } from "@/types/configure.types";
import type { RoleDetailData } from "@/types/directoryRole.types";
import type { PimGroupData } from "@/types/pimGroup.types";
import type { AuthenticationContext } from "@/types/shared.types";
import type { AccessModelCatalog } from "@/utils/accessModelCatalog";
import { countsByTab, targetKey } from "@/utils/configureBasket";
import { ACTIVATION_CATEGORIES, ASSIGNMENT_CATEGORIES, ASSIGNMENT_NOTE, NOT_UNDER_PIM_SETTINGS, contextWarning, readTargetSettings } from "@/utils/configureSettingRows";
import type { PrincipalSearchFn } from "@/hooks/useUserSearch";
import {
    EDIT_TABS,
    buildGroupRow,
    buildRoleRow,
    buildTargetList,
    defaultTargetId,
    describeGroupHead,
    describeRoleHead,
    roleLock,
    toggleChip,
    type TargetChip,
    type TargetListContext,
    type TargetRow,
} from "@/utils/configureTargets";
import type { WriteAccess } from "@/utils/writeAccess";
import { describePlan, groupEntry, planSeveral, roleEntry, type SeveralDraft, type SeveralEntry } from "@/utils/settingValues";
import { buildGroupWhoRows, buildRoleWhoRows, type FormTarget, type WhoRow } from "@/utils/assignmentForm";
import { AddPeopleForm, type ScopeLoaders } from "./AddPeopleForm";
import { CopySettingsDialog } from "./CopySettingsDialog";
import { PendingAdds, WhoHasIt } from "./WhoHasIt";
import { NotificationTab, SeveralNotificationTab } from "./NotificationTab";
import { DetailHead } from "./DetailHead";
import { EditTabs } from "./EditTabs";
import { SettingsTab } from "./SettingsTab";
import { SeveralHead } from "./SeveralHead";
import { SeveralSettings } from "./SeveralSettings";
import { TargetList } from "./TargetList";

export interface EditData {
    roles: RoleDetailData[];
    groups: PimGroupData[];
    access: WriteAccess | null;
    catalog: AccessModelCatalog | null;
    authenticationContexts: AuthenticationContext[];
    isRolesLoading: boolean;
    /** The policies of the roles are still arriving */
    isPoliciesLoading: boolean;
    isGroupsLoading: boolean;
    isGroupsConsented: boolean;
    onEnableGroups: () => void;
    tenantName: string;
    /** The tenant's custom extensions; null unless the list is read (see `customExtensionsStatus`) */
    customExtensions: ReadonlyArray<{ id: string; displayName: string }> | null;
    customExtensionsStatus: "ready" | "checking" | "unavailable" | "noConsent";
    onGrantCustomExtensions: () => void;
    /** Reads the policy of one target again after it failed */
    onRetryPolicy: (target: Target) => void;
    /** Per authentication context id what Conditional Access does with it; null when it cannot be read */
    contextStates: Readonly<Record<string, "enabled" | "reportOnly" | "off" | "none">> | null;
    /** Users and groups by name: Graph in the app (`usePrincipalSearchFn`), the fixture's own list on its page */
    searchPrincipals: PrincipalSearchFn;
    /** The roles could not be read */
    rolesError: string | null;
    onRetryRoles: () => void;
    /** The groups could not be read (the error phase of the workload) */
    groupsError: string | null;
    onRetryGroups: () => void;
    /** Ticked when Select several starts from the URL; the app passes none, the fixture shows several targets with it */
    initialTicks?: readonly string[];
    /** Emergency access accounts (lower-case ids) for the tag in Who has it */
    emergencyAccountIds: ReadonlySet<string>;
    /** Administrative units and applications for the scope of a new role assignment (spec 5.7) */
    scopes: ScopeLoaders;
    /** Now, to the minute: ends, expired rows and the policy maximum of a new assignment */
    now: Date;
}

interface EditViewProps {
    url: ConfigureUrlActions;
    data: EditData;
}

const WIDE_QUERY = "(min-width: 1024px)";
const NO_TICKS: ReadonlySet<string> = new Set();
const SEVERAL_LABELS: Partial<Record<ConfigureTab, string>> = { who: "Add people" };

function subscribeWide(listener: () => void) {
    const query = window.matchMedia(WIDE_QUERY);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
}

/** From 1024 up list and detail sit side by side */
function useIsWide(): boolean {
    return useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE_QUERY).matches, () => false);
}

/**
 * Edit roles and groups (spec 5.1 to 5.4): the list 360 wide and the detail beside it from 1024 up; below 1024 the list
 * is the page and a selected target replaces it with a back button, as the Report. Without a selection the first
 * target that can be changed is shown from 1024 up (not written to the URL).
 */
export function EditView({ url, data }: EditViewProps) {
    const { basket } = useConfigureBasket();
    const basketActions = useConfigureBasketActions();
    const { view, roleId, groupId, access: side, select: isSeveral } = url.state;
    const tab = url.state.tab ?? "activation";
    const [chips, setChips] = useState<ReadonlySet<TargetChip>>(() => new Set());
    const [query, setQuery] = useState("");

    const ctx: TargetListContext = useMemo(
        () => ({ access: data.access, basket, authenticationContexts: data.authenticationContexts, isPoliciesLoading: data.isPoliciesLoading }),
        [data.access, basket, data.authenticationContexts, data.isPoliciesLoading]
    );
    const list = useMemo(() => buildTargetList(view, data.roles, data.groups, ctx, chips, query), [view, data.roles, data.groups, ctx, chips, query]);

    const urlId = view === "roles" ? roleId : groupId;
    const fallbackId = useMemo(() => defaultTargetId(list), [list]);
    const isWide = useIsWide();
    const shownKey = urlId ?? fallbackId;
    const role = view === "roles" ? data.roles.find((r) => r.definition.id === shownKey) : undefined;
    const group = view === "groups" ? data.groups.find((g) => g.group.id === shownKey) : undefined;
    // Select several shows list and detail together at every width: nothing is "opened" then
    const hasSelection = !isSeveral && urlId !== undefined && (role !== undefined || group !== undefined);
    const shownId = role?.definition.id ?? group?.group.id;
    const head = useMemo(
        () => (role ? describeRoleHead(role, data.catalog, ctx) : group ? describeGroupHead(group, side, ctx) : null),
        [role, group, side, data.catalog, ctx]
    );
    const counts = useMemo(() => (head ? countsByTab(basket, head.target) : null), [basket, head]);
    const rules = role ? role.policy?.details?.rules : group?.policies?.[side]?.rules;
    const settings = useMemo(() => readTargetSettings(rules), [rules]);
    const isOutsidePim = group?.isManaged === false;
    // A role's policy arrives in the background phase, a group's with the group's own read; until then "Loading", never a
    // default. Once nothing is loading any more a missing policy failed (a role's `configError`, a group's absent policy).
    const isSettingsLoading = settings === null && (role ? (data.isRolesLoading || data.isPoliciesLoading) && !role.configError : data.isGroupsLoading);
    const isSettingsFailed = settings === null && !isSettingsLoading && (role !== undefined || (group !== undefined && !isOutsidePim));
    const words = useMemo(() => ({ contexts: data.authenticationContexts, extensions: data.customExtensions }), [data.authenticationContexts, data.customExtensions]);
    // The target shown without a selection is pinned in the URL as soon as something of it changes (side, tab)
    const pin = (s: ConfigureUrlState): ConfigureUrlState => (view === "roles" ? { ...s, roleId: s.roleId ?? shownId } : { ...s, groupId: s.groupId ?? shownId });

    // An admin who may change groups but not roles (an owner, a Groups Administrator, no write permission for roles)
    // starts on the groups: decided once, when the access check is first known, so choosing Roles afterwards stays
    const { update } = url;
    const hasDecidedView = useRef(false);
    const access = data.access;
    useEffect(() => {
        if (hasDecidedView.current || !access) return;
        hasDecidedView.current = true;
        if (roleLock(access) !== null && access.overall === "open") update((s) => (s.view === "roles" && !s.roleId ? { ...s, view: "groups" } : s));
    }, [access, update]);

    // Select several (spec 5.6): the ticked targets in the order they were ticked, the rows set (Keep is absent) and
    // what the last "Add" did. The choices stay while ticks change; Add or switching off clears them.
    const [ticked, setTicked] = useState<readonly string[]>(() => (isSeveral ? data.initialTicks ?? [] : []));
    const [draft, setDraft] = useState<SeveralDraft>({});
    const [status, setStatus] = useState("");
    // Entering or leaving Select several (the switch, or Back and Forward) starts clean; the switch seeds the target opened
    const [seed, setSeed] = useState<readonly string[] | null>(null);
    const [wasSeveral, setWasSeveral] = useState(isSeveral);
    if (wasSeveral !== isSeveral) {
        setWasSeveral(isSeveral);
        setTicked(isSeveral ? seed ?? [] : []);
        setDraft({});
        setStatus("");
        setSeed(null);
    }
    const tickedSet = useMemo(() => (isSeveral ? new Set(ticked) : NO_TICKS), [isSeveral, ticked]);
    const loading = useMemo(() => ({ isRolesLoading: data.isRolesLoading || data.isPoliciesLoading, isGroupsLoading: data.isGroupsLoading }), [data.isRolesLoading, data.isPoliciesLoading, data.isGroupsLoading]);
    const entries = useMemo<SeveralEntry[]>(() => {
        if (!isSeveral) return [];
        // A tick whose target became locked (the access check read again) is not changed
        if (view === "roles") return ticked.map((id) => data.roles.find((r) => r.definition.id === id)).filter((r) => r !== undefined && buildRoleRow(r, ctx).lock === null).map((r) => roleEntry(r!, loading));
        return ticked.map((id) => data.groups.find((g) => g.group.id === id)).filter((g) => g !== undefined && buildGroupRow(g, ctx).lock === null).map((g) => groupEntry(g!, side, loading));
    }, [isSeveral, view, ticked, data.roles, data.groups, side, loading, ctx]);
    const severalPlan = useMemo(() => planSeveral(draft, entries, basket), [draft, entries, basket]);
    const severalCounts = useMemo(() => {
        const total: Record<ConfigureTab, number> = { activation: 0, assignment: 0, notification: 0, who: 0 };
        for (const entry of entries) {
            const one = countsByTab(basket, entry.target);
            for (const key of Object.keys(total) as ConfigureTab[]) total[key] += one[key];
        }
        return total;
    }, [entries, basket]);
    const setSeveral = (on: boolean) => {
        // The target the admin opened becomes the first tick, when it may be changed (below 1024 nothing is open until
        // a row is chosen, so the fallback target is not ticked there)
        const shownRow = hasSelection || isWide ? [...list.rows, ...list.notUnderPim].find((r) => r.id === shownId) : undefined;
        setSeed(on && shownRow && shownRow.lock === null ? [shownRow.id] : []);
        url.update((s) => ({ ...s, select: on }));
    };
    const addSeveral = () => {
        const { add, leaveOut, problem } = severalPlan;
        if (problem || entries.length === 0) return;
        if (leaveOut.length > 0) basketActions.leaveOut(leaveOut);
        if (add.length > 0) basketActions.add(add);
        const effect = describePlan(severalPlan, view, "past");
        const left = severalPlan.skipped.length > 0 ? ` Left alone, they do not have this setting read: ${severalPlan.skipped.join(", ")}.` : "";
        const dropped = leaveOut.length > 0 ? ` Left out ${leaveOut.length} waiting approvers ${leaveOut.length === 1 ? "change" : "changes"}.` : "";
        setStatus(effect
            ? `${effect.charAt(0).toUpperCase()}${effect.slice(1)}.${dropped}${left}`
            : dropped
                ? `${dropped.trim()}${left}`
                : `Nothing added: the selected ${view} already have these values.${left}`);
        setDraft({});
    };

    // "Copy settings to…" (spec 5.8): the target shown, to every other target of the same kind the admin may change
    const [isCopyOpen, setIsCopyOpen] = useState(false);
    const copySource = useMemo(() => (role ? roleEntry(role, loading) : group ? groupEntry(group, side, loading) : null), [role, group, side, loading]);
    const copyCandidates = useMemo(() => {
        if (!isCopyOpen || !copySource) return [];
        const open = buildTargetList(view, data.roles, data.groups, ctx, new Set(), "").rows.filter((r) => r.lock === null && r.id !== copySource.target.id);
        return view === "roles"
            ? open.map((r) => data.roles.find((x) => x.definition.id === r.id)).filter((x) => x !== undefined).map((x) => roleEntry(x, loading))
            : open.map((r) => data.groups.find((x) => x.group.id === r.id)).filter((x) => x !== undefined).map((x) => groupEntry(x, side, loading));
    }, [isCopyOpen, copySource, view, data.roles, data.groups, ctx, side, loading]);
    const copyDisabledReason = !copySource || copySource.settings === null
        ? isOutsidePim ? "This group has no PIM settings to copy yet." : "The settings of this target are not read yet."
        : null;

    // Who has it and Add people (spec 5.7): the rows of the target shown, and the targets of the form with their policy
    const nowMs = data.now.getTime();
    const whoRows = useMemo<WhoRow[]>(() => {
        const ctxWho = { basket, emergencyAccountIds: data.emergencyAccountIds, now: new Date(nowMs) };
        if (role) return buildRoleWhoRows(role, data.groups, ctxWho);
        if (group) return buildGroupWhoRows(group, ctxWho);
        return [];
    }, [role, group, data.groups, basket, data.emergencyAccountIds, nowMs]);
    const sidesOf = (g: PimGroupData) => ({ member: readTargetSettings(g.policies?.member?.rules), owner: readTargetSettings(g.policies?.owner?.rules) });
    const formTargets = (): FormTarget[] => {
        if (isSeveral) {
            return entries.map((e) => {
                const g = e.target.kind === "group" ? data.groups.find((x) => x.group.id === e.target.id) : undefined;
                return { target: e.target, name: e.name, settings: e.settings, ...(g ? { sides: sidesOf(g) } : {}) };
            });
        }
        if (role) return [{ target: { kind: "role", id: role.definition.id }, name: role.definition.displayName, settings }];
        if (group) {
            const sides = sidesOf(group);
            return [{ target: { kind: "group", id: group.group.id, access: side }, name: group.group.displayName, settings: sides[side], sides }];
        }
        return [];
    };
    const settingsOfRow = (row: WhoRow) => (row.target.kind === "group" && group ? readTargetSettings(group.policies?.[row.target.access]?.rules) : settings);
    const openGroup = (groupId: string) => url.update((s) => ({ ...s, view: "groups", roleId: undefined, groupId, access: "member", tab: "who" }));

    // Selecting the open group again keeps its side; in Select several a click ticks or unticks
    const select = (row: TargetRow) => {
        if (isSeveral) {
            setTicked((current) => (current.includes(row.id) ? current.filter((id) => id !== row.id) : [...current, row.id]));
            setStatus("");
            return;
        }
        url.update((s) => (row.kind === "role" ? { ...s, roleId: row.id } : { ...s, groupId: row.id, access: s.groupId === row.id ? s.access : "member" }));
    };
    const clearSelection = () => url.update((s) => ({ ...s, roleId: undefined, groupId: undefined }));
    const changeView = (next: "roles" | "groups") => {
        if (next === view) return;
        setChips(new Set());
        setTicked([]);
        setDraft({});
        setStatus("");
        url.update((s) => ({ ...s, view: next, roleId: undefined, groupId: undefined, access: "member" }));
    };

    // Below 1024 the detail is the page: it starts at its top with focus on the back button, and the list comes back
    // where it was with focus on the row that was open
    const backRef = useRef<HTMLButtonElement>(null);
    const listRef = useRef<HTMLElement>(null);
    const listScroll = useRef(0);
    const wasSelected = useRef(hasSelection);
    const lastSelectedId = useRef<string | undefined>(undefined);
    useEffect(() => {
        if (hasSelection) lastSelectedId.current = shownId;
    }, [hasSelection, shownId]);
    useEffect(() => {
        const remember = () => {
            if (!wasSelected.current && listRef.current?.offsetParent !== null) listScroll.current = window.scrollY;
        };
        window.addEventListener("scroll", remember, { passive: true });
        return () => window.removeEventListener("scroll", remember);
    }, []);
    useEffect(() => {
        if (wasSelected.current === hasSelection) return;
        wasSelected.current = hasSelection;
        if (window.matchMedia(WIDE_QUERY).matches) return;
        window.scrollTo(0, hasSelection ? 0 : listScroll.current);
        if (hasSelection) backRef.current?.focus({ preventScroll: true });
        else if (lastSelectedId.current) listRef.current?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(lastSelectedId.current)}"]`)?.focus({ preventScroll: true });
    }, [hasSelection]);

    const noun = view === "roles" ? "roles" : "groups";
    let message: ReactNode = undefined;
    if (view === "groups" && !data.isGroupsConsented) {
        message = (
            <div className="p-4">
                <StatusBox
                    variant="consent"
                    title="PIM for Groups is off"
                    action={<button type="button" onClick={data.onEnableGroups} className="inline-flex h-[34px] items-center rounded border border-line bg-surface px-3 text-[13px] font-medium text-ink hover:bg-page max-sm:h-11">Turn on PIM for Groups</button>}
                >
                    Turn it on to change the settings and assignments of groups.
                </StatusBox>
            </div>
        );
    } else if (view === "roles" ? data.rolesError && data.roles.length === 0 : data.groupsError && data.groups.length === 0) {
        message = (
            <div className="p-4">
                <StatusBox
                    variant="error"
                    title={`Could not read the ${noun}`}
                    action={<button type="button" onClick={view === "roles" ? data.onRetryRoles : data.onRetryGroups} className="inline-flex h-[34px] items-center rounded border border-line bg-surface px-3 text-[13px] font-medium text-ink hover:bg-page max-sm:h-11">Try again</button>}
                >
                    {view === "roles" ? data.rolesError : data.groupsError}
                </StatusBox>
            </div>
        );
    } else if ((view === "roles" ? data.isRolesLoading && data.roles.length === 0 : data.isGroupsLoading && data.groups.length === 0)) {
        message = <p className="p-4 text-sm text-body">{`Loading ${noun}…`}</p>;
    } else if (list.rows.length === 0 && list.notUnderPim.length === 0) {
        const onlyOutside = view === "groups" && list.total === 0 && list.outsideTotal > 0 && !chips.has("notUnderPim");
        message = (
            <div className="p-4 text-sm text-body">
                <p>{onlyOutside ? "No groups are under PIM yet." : list.total === 0 && list.outsideTotal === 0 ? `No ${noun} to show.` : `No ${noun} match the search and filters.`}</p>
                {onlyOutside ? (
                    <button type="button" onClick={() => setChips(new Set<TargetChip>(["notUnderPim"]))} className="mt-2 text-[13px] font-medium text-accent hover:underline">{`Show the ${list.outsideTotal} groups not under PIM`}</button>
                ) : (list.total > 0 || list.outsideTotal > 0) && (
                    <button type="button" onClick={() => { setChips(new Set()); setQuery(""); }} className="mt-2 text-[13px] font-medium text-accent hover:underline">Clear search and filters</button>
                )}
            </div>
        );
    }

    return (
        <div className="grid items-start gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
            <section ref={listRef} aria-label={view === "roles" ? "Roles" : "Groups"} className={hasSelection ? "max-lg:hidden" : ""}>
                <TargetList
                    view={view}
                    onViewChange={changeView}
                    roleCount={data.isRolesLoading && data.roles.length === 0 ? null : data.roles.length}
                    groupCount={!data.isGroupsConsented ? undefined : data.isGroupsLoading && data.groups.length === 0 ? null : data.groups.filter((g) => g.isManaged !== false).length}
                    list={list}
                    chips={chips}
                    onToggleChip={(chip) => setChips((current) => toggleChip(current, chip, view))}
                    query={query}
                    onQueryChange={setQuery}
                    // Below 1024 nothing is current until a target is opened; from 1024 up the shown one is
                    currentId={hasSelection || isWide ? shownId : undefined}
                    onSelect={select}
                    message={message}
                    isSeveral={isSeveral}
                    onSeveralChange={setSeveral}
                    checkedIds={tickedSet}
                />
            </section>
            <section aria-label="Detail" className={`min-w-0 ${isSeveral || hasSelection ? "" : "max-lg:hidden"}`}>
                {isSeveral ? (
                    <article className="overflow-hidden rounded border border-line bg-surface">
                        <SeveralHead
                            names={entries.map((e) => e.name)}
                            noun={noun}
                            setCount={Object.keys(draft).length}
                            problem={severalPlan.problem}
                            onAdd={addSeveral}
                            status={status}
                            access={view === "groups" ? side : undefined}
                            // Values chosen against one side's Now are not carried to the other side
                            onAccessChange={view === "groups" ? (access) => { setDraft({}); setStatus(""); url.update((s) => ({ ...s, access })); } : undefined}
                        />
                        {entries.length > 0 && (
                            <EditTabs tab={tab} onTabChange={(next) => url.update((s) => ({ ...s, tab: next }))} counts={severalCounts} labels={SEVERAL_LABELS} ariaLabel="Settings of the selected targets">
                                {tab === "activation" || tab === "assignment" ? (
                                    <SeveralSettings
                                        entries={entries}
                                        noun={noun}
                                        tenantName={data.tenantName}
                                        categories={tab === "activation" ? ACTIVATION_CATEGORIES : ASSIGNMENT_CATEGORIES}
                                        note={tab === "assignment" ? ASSIGNMENT_NOTE : undefined}
                                        draft={draft}
                                        onDraftChange={(next) => { setDraft(next); setStatus(""); }}
                                        words={words}
                                        contextWarning={(id) => contextWarning(data.contextStates?.[id])}
                                        searchPrincipals={data.searchPrincipals}
                                    />
                                ) : tab === "notification" ? (
                                    <SeveralNotificationTab entries={entries} noun={noun} draft={draft} onDraftChange={(next) => { setDraft(next); setStatus(""); }} />
                                ) : tab === "who" ? (
                                    <div className="flex flex-col gap-5">
                                        <AddPeopleForm
                                            key={`${view}|${side}|${ticked.join(",")}`}
                                            targets={formTargets()}
                                            access={side}
                                            search={data.searchPrincipals}
                                            scopes={data.scopes}
                                            now={data.now}
                                        />
                                        <PendingAdds targets={entries.map((e) => e.target)} nameOf={(t) => entries.find((e) => e.target.id === t.id)?.name ?? t.id} />
                                    </div>
                                ) : (
                                    <p className="rounded border border-dashed border-line bg-page px-4 py-6 text-sm text-body">
                                        {`The ${SEVERAL_LABELS[tab] ?? EDIT_TABS.find((t) => t.value === tab)?.label ?? ""} rows for several targets are still being built.`}
                                    </p>
                                )}
                            </EditTabs>
                        )}
                    </article>
                ) : head && counts ? (
                    <article className="overflow-hidden rounded border border-line bg-surface">
                        <DetailHead
                            head={head}
                            onAccessChange={(access) => url.update((s) => ({ ...pin(s), access }))}
                            backLabel={view === "roles" ? "Roles" : "Groups"}
                            onBack={clearSelection}
                            backRef={backRef}
                            onCopy={() => setIsCopyOpen(true)}
                            copyDisabledReason={copyDisabledReason}
                        />
                        {copySource && (
                            <CopySettingsDialog isOpen={isCopyOpen} onClose={() => setIsCopyOpen(false)} source={copySource} candidates={copyCandidates} noun={noun} />
                        )}
                        {head.lock ? (
                            <div className="p-4 sm:p-5"><StatusBox variant="warn" title="You cannot change this">{head.lock}</StatusBox></div>
                        ) : (
                            <EditTabs tab={tab} onTabChange={(next) => url.update((s) => ({ ...pin(s), tab: next }))} counts={counts}>
                                {(tab === "activation" || tab === "assignment" || tab === "notification") && isOutsidePim ? (
                                    <p className="rounded border border-line bg-page px-4 py-4 text-sm text-body">{NOT_UNDER_PIM_SETTINGS}</p>
                                ) : tab === "activation" || tab === "assignment" ? (
                                    <SettingsTab
                                        // A new target starts with its own pending state (a group's approval waiting for an approver)
                                        key={`${targetKey(head.target)}|${tab}`}
                                        target={head.target}
                                        tenantName={data.tenantName}
                                        categories={tab === "activation" ? ACTIVATION_CATEGORIES : ASSIGNMENT_CATEGORIES}
                                        note={tab === "assignment" ? ASSIGNMENT_NOTE : undefined}
                                        settings={settings}
                                        isLoading={isSettingsLoading}
                                        words={words}
                                        contextWarning={(id) => contextWarning(data.contextStates?.[id])}
                                        searchPrincipals={data.searchPrincipals}
                                        rules={rules}
                                        failed={isSettingsFailed ? { onRetry: () => data.onRetryPolicy(head.target) } : null}
                                        extensionsStatus={data.customExtensionsStatus}
                                        onGrantExtensions={data.onGrantCustomExtensions}
                                    />
                                ) : tab === "notification" ? (
                                    <NotificationTab
                                        key={targetKey(head.target)}
                                        target={head.target}
                                        tenantName={data.tenantName}
                                        settings={settings}
                                        isLoading={isSettingsLoading}
                                        failed={isSettingsFailed ? { onRetry: () => data.onRetryPolicy(head.target) } : null}
                                    />
                                ) : tab === "who" ? (
                                    <div className="flex flex-col gap-5">
                                        <WhoHasIt rows={whoRows} settingsOf={settingsOfRow} isOutsidePim={isOutsidePim} onOpenGroup={openGroup} now={data.now} targets={head.target.kind === "group" ? [{ ...head.target, access: "member" }, { ...head.target, access: "owner" }] : [head.target]} />
                                        <AddPeopleForm
                                            key={targetKey(head.target)}
                                            targets={formTargets()}
                                            role={role?.definition}
                                            access={side}
                                            search={data.searchPrincipals}
                                            scopes={data.scopes}
                                            now={data.now}
                                        />
                                    </div>
                                ) : (
                                    <p className="rounded border border-dashed border-line bg-page px-4 py-6 text-sm text-body">
                                        {`The ${EDIT_TABS.find((t) => t.value === tab)?.label ?? ""} rows are still being built.`}
                                    </p>
                                )}
                            </EditTabs>
                        )}
                    </article>
                ) : (
                    <p className="rounded border border-line bg-surface px-4 py-6 text-sm text-body max-lg:hidden">{`Pick one of the ${noun} to change it.`}</p>
                )}
            </section>
        </div>
    );
}
