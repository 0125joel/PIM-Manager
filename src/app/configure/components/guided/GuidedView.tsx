"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type Dispatch, type ReactNode } from "react";
import { Icon } from "@/components/icons/Icon";
import { Button } from "@/components/ui/Button";
import { useConfigureBasket, useConfigureBasketActions } from "@/contexts/ConfigureBasketContext";
import type { ConfigureUrlActions } from "@/hooks/useConfigureUrlState";
import type { ConfigureTab, GroupAccess } from "@/types/configure.types";
import { contextsMeetingLabel, proposeGroupPlacement } from "@/utils/accessModelCatalog";
import { groupPlacementRows, labelName } from "@/utils/accessModelView";
import { matchContext } from "@/utils/authContextSlug";
import { addChanges, changeId, countsByTab, leaveOut as withoutChanges } from "@/utils/configureBasket";
import { targetName } from "@/utils/configureReview";
import { contextWarning, readTargetSettings } from "@/utils/configureSettingRows";
import { buildGroupRow, buildRoleRow, buildTargetList, roleLock, type TargetChip, type TargetListContext } from "@/utils/configureTargets";
import { getRolesHeldByGroups, type RoleHeldByGroup } from "@/utils/groupsOutsidePim";
import {
    GUIDED_STEPS,
    NOTHING_TO_REVIEW,
    describeSteps,
    draftOf,
    droppedByChoice,
    guidedEntries,
    guidedReducer,
    heldBackReviewNotes,
    nextStep,
    overridesFrom,
    planGuided,
    previousStep,
    reachableStep,
    settingsBlocks,
    settingsParts,
    startProblem,
    targetsProblem,
    unmatchedReviewNotes,
    type GuidedAction,
    type GuidedState,
    type GuidedStep,
    type GuidedWorkload,
} from "@/utils/guidedRoute";
import { groupEntry, roleEntry } from "@/utils/settingValues";
import type { FormTarget } from "@/utils/assignmentForm";
import type { EditData } from "../edit/EditView";
import type { ModelData } from "../model/ModelPage";
import { PeopleStep } from "./PeopleStep";
import { SettingsStep } from "./SettingsStep";
import { StartStep, type StartChoices } from "./StartStep";
import { StepsBar } from "./StepsBar";
import { TargetsStep } from "./TargetsStep";

interface GuidedViewProps {
    url: ConfigureUrlActions;
    data: EditData;
    model: ModelData;
    state: GuidedState;
    dispatch: Dispatch<GuidedAction>;
}

/**
 * Guided (spec 6, NG-70): five steps over the parts of Edit. The route's state lives in `ConfigureView` (it survives
 * the review); the URL holds only `gstep`. Settings reach the basket when the admin moves on from step 3, people from
 * the form of step 4; step 5 is the shared review.
 */
export function GuidedView({ url, data, model, state, dispatch }: GuidedViewProps) {
    const { basket } = useConfigureBasket();
    const basketActions = useConfigureBasketActions();
    // A choice in Start takes the basket changes that depend on it along (spec 6), never those of Edit or Import
    const choose = (action: GuidedAction) => {
        const dropped = droppedByChoice(state, guidedReducer(state, action), basket);
        if (dropped.length > 0) basketActions.leaveOut(dropped);
        dispatch(action);
    };
    const [chips, setChips] = useState<ReadonlySet<TargetChip>>(() => new Set());
    const [query, setQuery] = useState("");
    const isGroups = state.workload === "groups";
    const noun = isGroups ? "groups" : "roles";

    const ctx: TargetListContext = useMemo(
        () => ({ access: data.access, basket, authenticationContexts: data.authenticationContexts, isPoliciesLoading: data.isPoliciesLoading }),
        [data.access, basket, data.authenticationContexts, data.isPoliciesLoading]
    );
    const loading = useMemo(() => ({ isRolesLoading: data.isRolesLoading || data.isPoliciesLoading, isGroupsLoading: data.isGroupsLoading }), [data.isRolesLoading, data.isPoliciesLoading, data.isGroupsLoading]);

    // Start: what the admin may change per workload
    const roleRows = useMemo(() => data.roles.map((r) => buildRoleRow(r, ctx)), [data.roles, ctx]);
    const groupRows = useMemo(() => (data.isGroupsConsented ? data.groups.map((g) => buildGroupRow(g, ctx)) : []), [data.groups, data.isGroupsConsented, ctx]);
    const openRoles = roleRows.filter((r) => r.lock === null);
    const openGroups = groupRows.filter((r) => r.lock === null);
    const workloadLock: Record<GuidedWorkload, string | null> = {
        roles: openRoles.length > 0 ? null : data.isRolesLoading && data.roles.length === 0 ? "Loading roles…" : roleLock(data.access) ?? "You cannot change roles",
        groups: !data.isGroupsConsented ? "Turn on PIM for Groups in Settings" : openGroups.length > 0 ? null : data.isGroupsLoading ? "Loading groups…" : "You cannot change groups",
    };
    const side: GroupAccess = state.side === "owner" ? "owner" : "member";
    const copySources = useMemo(() => {
        if (isGroups) {
            return openGroups.filter((r) => r.section === "main").map((r) => data.groups.find((g) => g.group.id === r.id)!)
                .filter((g) => readTargetSettings(g.policies?.[side]?.rules) !== null).map((g) => ({ id: g.group.id, name: g.group.displayName }));
        }
        return openRoles.map((r) => data.roles.find((x) => x.definition.id === r.id)!)
            .filter((r) => readTargetSettings(r.policy?.details?.rules) !== null).map((r) => ({ id: r.definition.id, name: r.definition.displayName }));
    }, [isGroups, openGroups, openRoles, data.groups, data.roles, side]);
    const outsideOpen = openGroups.filter((r) => r.section === "notUnderPim").length;
    const choices: StartChoices = {
        rolesLine: `You can change ${openRoles.length} of ${data.roles.length}`,
        groupsLine: outsideOpen > 0 ? `You can change ${openGroups.length}, including groups not under PIM yet` : `You can change ${openGroups.length}`,
        workloadLock,
        copySources,
    };

    // An admin who may change groups but not roles starts on the groups, decided once (as Edit)
    const hasDecided = useRef(false);
    useEffect(() => {
        if (hasDecided.current || !data.access) return;
        hasDecided.current = true;
        if (workloadLock.roles && !workloadLock.groups && state.workload === "roles" && state.ticks.length === 0 && state.routeChanges.length === 0) dispatch({ type: "workload", workload: "groups", copySourceId: null });
    }, [data.access, workloadLock.roles, workloadLock.groups, state.workload, state.ticks.length, state.routeChanges.length, dispatch]);

    // Targets: the open ticks (a target that became locked or is gone is left out)
    const allRows = isGroups ? groupRows : roleRows;
    const openIds = new Set(allRows.filter((r) => r.lock === null).map((r) => r.id));
    // One array per set of open ticks, so what depends on it is not recomputed on every render (U-02)
    const tickedKey = state.ticks.filter((id) => openIds.has(id) && !(state.from === "copy" && id === state.copySourceId)).join("\n");
    const tickedOpen = useMemo(() => (tickedKey ? tickedKey.split("\n") : []), [tickedKey]);
    const tickSet = useMemo(() => new Set(state.ticks), [state.ticks]);
    const list = useMemo(() => {
        const built = buildTargetList(state.workload, data.roles, data.groups, ctx, chips, query);
        const notSource = (r: { id: string }) => !(state.from === "copy" && r.id === state.copySourceId);
        return { ...built, rows: built.rows.filter(notSource), notUnderPim: built.notUnderPim.filter(notSource) };
    }, [state.workload, data.roles, data.groups, ctx, chips, query, state.from, state.copySourceId]);

    const catalog = model.loaded?.catalog ?? data.catalog;
    // The roles every ticked group holds, read once per roles array and ticks (U-03), not once per call
    const templateOf = useMemo(() => new Map(data.roles.map((r) => [r.definition.id, r.definition.templateId ?? r.definition.id])), [data.roles]);
    const heldBy = useMemo(() => (isGroups && catalog ? getRolesHeldByGroups(data.roles, tickedOpen) : new Map<string, RoleHeldByGroup[]>()), [isGroups, catalog, data.roles, tickedOpen]);
    const placementOf = useCallback((groupId: string) => {
        const own = model.groupPlacements[groupId];
        if (own) return own;
        if (!catalog) return null;
        const proposal = proposeGroupPlacement(catalog, (heldBy.get(groupId.toLowerCase()) ?? []).map((h) => templateOf.get(h.roleId) ?? h.roleId));
        return proposal ? { plane: proposal.plane, securityLevel: proposal.securityLevel } : null;
    }, [model.groupPlacements, catalog, heldBy, templateOf]);
    const placementRows = isGroups && state.from === "model" && catalog
        ? groupPlacementRows(catalog, tickedOpen.map((id) => data.groups.find((g) => g.group.id === id)).filter((g) => g !== undefined), data.roles, model.groupPlacements)
        : null;
    const unplaced = (placementRows ?? []).filter((r) => !r.placement && !r.proposal).map((r) => r.name);

    // Settings: the entries per side, the blocks and their values
    const entries = useMemo(() => guidedEntries(state, tickedOpen, (id, access) => {
        if (state.workload === "roles") {
            const role = data.roles.find((r) => r.definition.id === id);
            return role ? roleEntry(role, loading) : null;
        }
        const group = data.groups.find((g) => g.group.id === id);
        return group ? groupEntry(group, access, loading) : null;
    }), [state, tickedOpen, data.roles, data.groups, loading]);
    const copySource = useMemo(() => {
        if (state.from !== "copy" || !state.copySourceId) return null;
        if (isGroups) {
            const g = data.groups.find((x) => x.group.id === state.copySourceId);
            return g ? groupEntry(g, side, loading) : null;
        }
        const r = data.roles.find((x) => x.definition.id === state.copySourceId);
        return r ? roleEntry(r, loading) : null;
    }, [state.from, state.copySourceId, isGroups, data.groups, data.roles, side, loading]);
    const resolveContext = useCallback((slug: string): string | null => {
        const label = catalog?.authContexts.find((c) => c.slug === slug);
        const byPolicy = label && model.conditionalAccessPolicies ? contextsMeetingLabel(label, model.conditionalAccessPolicies) : undefined;
        const match = matchContext(slug, data.authenticationContexts, model.contextChoices, byPolicy);
        return match.kind === "chosen" || match.kind === "byName" || match.kind === "byPolicy" ? match.contextId : null;
    }, [catalog, model.conditionalAccessPolicies, model.contextChoices, data.authenticationContexts]);
    const nameOfLabel = (slug: string) => (catalog ? labelName(slug, catalog) : slug);
    // The blocks and the plan only change with the route, the data and the basket (U-02): not on every render
    const { blocks, plan } = useMemo(() => {
        const built = settingsBlocks(state, entries, {
            catalog,
            templateOf: (id) => templateOf.get(id) ?? id,
            placementOf,
            resolveContext,
            labelName: (slug: string) => (catalog ? labelName(slug, catalog) : slug),
            tenantName: data.tenantName,
            copySource,
            basket,
        });
        return { blocks: built, plan: planGuided(state, built, basket) };
    }, [state, entries, catalog, templateOf, placementOf, resolveContext, data.tenantName, copySource, basket]);

    // The step shown: never past an incomplete step (a reload keeps only gstep)
    const startIssue = startProblem(state, { workloadLock }) ?? (state.from === "model" && !catalog ? "The access model is still being read." : null);
    const targetsIssue = targetsProblem(state, tickedOpen, unplaced);
    const step = reachableStep(url.state.gstep, state, { start: startIssue, targets: targetsIssue });
    const { update } = url;
    useEffect(() => {
        if ((url.state.gstep ?? 1) !== step) update((s) => (s.mode === "guided" && !s.step ? { ...s, gstep: step === 1 ? undefined : step } : s));
    }, [url.state.gstep, step, update]);

    const next = nextStep(step, state);
    // What the basket holds after Next: from Settings the route's earlier changes give way to the plan
    const basketAfter = step === 3 ? addChanges(withoutChanges(basket, plan.leaveOut), plan.add).changes.length : basket.changes.length;
    const isEmptyForReview = next === 5 && basketAfter === 0;
    const waitReason = step === 1 ? startIssue : step === 2 ? targetsIssue : step === 3 ? plan.problem ?? (isEmptyForReview ? NOTHING_TO_REVIEW : null) : isEmptyForReview ? NOTHING_TO_REVIEW : null;

    const bodyRef = useRef<HTMLDivElement>(null);
    const goTo = (to: GuidedStep) => {
        dispatch({ type: "clearNotice" });
        if (to === 5) {
            update((s) => ({ ...s, gstep: 5 }));
            url.openReview();
            return;
        }
        update((s) => ({ ...s, gstep: to === 1 ? undefined : to }));
        window.scrollTo(0, 0);
        bodyRef.current?.focus({ preventScroll: true });
    };
    const onNext = () => {
        if (waitReason) return;
        if (step === 3) {
            if (plan.leaveOut.length > 0) basketActions.leaveOut(plan.leaveOut);
            if (plan.add.length > 0) basketActions.add(plan.add);
            dispatch({ type: "planned", ids: plan.add.map(changeId), reviewNotes: [...unmatchedReviewNotes(blocks, { labelName: nameOfLabel, tenantName: data.tenantName }), ...heldBackReviewNotes(plan.heldBack, basket, (t) => targetName(t, data.roles, data.groups))] });
        }
        goTo(next);
    };

    const counts = useMemo(() => {
        const total: Record<ConfigureTab, number> = { activation: 0, assignment: 0, notification: 0, who: 0 };
        for (const entry of entries) {
            const one = countsByTab(basket, entry.target);
            for (const key of Object.keys(total) as ConfigureTab[]) total[key] += one[key];
        }
        return total;
    }, [entries, basket]);
    const names = tickedOpen.map((id) => (isGroups ? data.groups.find((g) => g.group.id === id)?.group.displayName : data.roles.find((r) => r.definition.id === id)?.definition.displayName) ?? id);
    const words = useMemo(() => ({ contexts: data.authenticationContexts, extensions: data.customExtensions }), [data.authenticationContexts, data.customExtensions]);

    let body: ReactNode;
    if (step === 1) {
        body = (
            <StartStep
                state={state}
                choices={choices}
                onWorkload={(workload) => {
                    const first = workload === "groups"
                        ? groupRows.find((r) => r.lock === null && r.section === "main")?.id ?? null
                        : roleRows.find((r) => r.lock === null)?.id ?? null;
                    setChips(new Set());
                    setQuery("");
                    choose({ type: "workload", workload, copySourceId: first });
                }}
                onSide={(value) => choose({ type: "side", side: value })}
                onFrom={(from) => choose({ type: "from", from, copySourceId: from === "copy" ? copySources[0]?.id ?? null : null })}
                onCopySource={(id) => choose({ type: "copySource", id })}
                onPart={(part) => choose({ type: "part", part })}
            />
        );
    } else if (step === 2) {
        const loadingList = isGroups ? data.isGroupsLoading && data.groups.length === 0 : data.isRolesLoading && data.roles.length === 0;
        const message = loadingList ? <p className="p-4 text-sm text-body">{`Loading ${noun}…`}</p>
            : list.rows.length === 0 && list.notUnderPim.length === 0 ? (
                <div className="p-4 text-sm text-body">
                    <p>{list.total === 0 && list.outsideTotal === 0 ? `No ${noun} to show.` : `No ${noun} match the search and filters.`}</p>
                    {(chips.size > 0 || query) && <button type="button" onClick={() => { setChips(new Set()); setQuery(""); }} className="mt-2 text-[13px] font-medium text-accent hover:underline">Clear search and filters</button>}
                </div>
            ) : undefined;
        const sideName = state.side === "both" ? "Member and Owner" : state.side === "owner" ? "Owner" : "Member";
        body = (
            <TargetsStep
                workload={state.workload}
                chosenLine={isGroups ? `Groups · ${sideName} settings` : "Roles"}
                onChangeStart={() => goTo(1)}
                list={list}
                chips={chips}
                onChipsChange={setChips}
                query={query}
                onQueryChange={setQuery}
                ticks={tickSet}
                selectedCount={tickedOpen.length}
                onTick={(row) => choose({ type: "tick", id: row.id })}
                onTickAll={(ids) => dispatch({ type: "tickAll", ids })}
                message={message}
                copySource={copySource ? { name: copySource.name } : null}
                placements={placementRows}
                onPlace={model.onPlaceGroup}
            />
        );
    } else if (step === 3) {
        body = (
            <SettingsStep
                names={names}
                noun={noun}
                parts={settingsParts(state)}
                blocks={blocks}
                draftOf={(block) => draftOf(block, state.overrides[block.key], state.parts)}
                onDraftChange={(block, draft) => dispatch({ type: "overrides", key: block.key, overrides: overridesFrom(block.prefill, draft) })}
                counts={counts}
                copySourceName={state.from === "copy" ? copySource?.name ?? null : null}
                tenantName={data.tenantName}
                words={words}
                contextWarning={(id) => contextWarning(data.contextStates?.[id])}
                searchPrincipals={data.searchPrincipals}
                labelName={nameOfLabel}
                contexts={data.authenticationContexts}
                onChooseContext={model.onChooseContext}
            />
        );
    } else {
        const targets: FormTarget[] = tickedOpen.flatMap((id): FormTarget[] => {
            if (!isGroups) {
                const role = data.roles.find((r) => r.definition.id === id);
                return role ? [{ target: { kind: "role", id }, name: role.definition.displayName, settings: readTargetSettings(role.policy?.details?.rules) }] : [];
            }
            const g = data.groups.find((x) => x.group.id === id);
            if (!g) return [];
            const sides = { member: readTargetSettings(g.policies?.member?.rules), owner: readTargetSettings(g.policies?.owner?.rules) };
            return [{ target: { kind: "group", id, access: side }, name: g.group.displayName, settings: sides[side], sides }];
        });
        body = (
            <PeopleStep
                targets={targets}
                names={names}
                access={side}
                search={data.searchPrincipals}
                scopes={data.scopes}
                now={data.now}
                source="guided"
                nameOf={(t) => (t.kind === "role" ? data.roles.find((r) => r.definition.id === t.id)?.definition.displayName : data.groups.find((g) => g.group.id === t.id)?.group.displayName) ?? t.id}
                formKey={`${state.workload}|${tickedOpen.join(",")}`}
            />
        );
    }

    const reasonId = useId();
    const stepName = GUIDED_STEPS[step - 1].name;
    return (
        <div>
            <StepsBar steps={describeSteps(state, step)} current={step} onOpen={goTo} />
            {state.notice && (
                <p role="status" className="mb-4 flex items-start gap-1.5 rounded border border-line bg-surface px-3 py-2.5 text-[13px] leading-[18px] text-body">
                    <Icon name="info" size={16} className="mt-px shrink-0 text-accent" />
                    {state.notice}
                </p>
            )}
            <div ref={bodyRef} tabIndex={-1} aria-label={`Step ${step} of ${GUIDED_STEPS.length}: ${stepName}`} className="outline-none">
                {body}
            </div>
            <div className="mt-4 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                    <Button onClick={() => goTo(previousStep(step, state))} disabled={step === 1}>Back</Button>
                    <Button variant="primary" onClick={onNext} disabled={!!waitReason} aria-describedby={waitReason ? reasonId : undefined}>{`Next: ${GUIDED_STEPS[next - 1].name}`}</Button>
                </div>
                {waitReason && <p id={reasonId} className="text-right text-[13px] text-body">{waitReason}</p>}
            </div>
        </div>
    );
}
