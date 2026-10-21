"use client";

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Button } from "@/components/ui/Button";
import { StatusBox } from "@/components/ui/StatusBox";
import { useConfigureBasket, useConfigureBasketActions } from "@/contexts/ConfigureBasketContext";
import type { ConfigureUrlActions } from "@/hooks/useConfigureUrlState";
import { changeId } from "@/utils/configureBasket";
import {
    EMPTY_PRINCIPALS, changesOfRows, checkAssignmentRows, knownPrincipals, mergePrincipals, neededLookups,
} from "@/utils/importAssignments";
import { readImportFile, type ImportKind } from "@/utils/importDetect";
import { approverIdsToLookUp, approverNameIndex, compareAccessModel, compareSettingsRows } from "@/utils/importSettings";
import { contextsMeetingLabel, proposeGroupPlacement } from "@/utils/accessModelCatalog";
import { parseAccessModelFile } from "@/utils/accessModelFile";
import { matchContext } from "@/utils/authContextSlug";
import { getRolesHeldByGroup } from "@/utils/groupsOutsidePim";
import type { ModelData } from "../model/ModelPage";
import type { EditData } from "../edit/EditView";
import { AccessModelChoices } from "./AccessModelChoices";
import { AssignmentRows } from "./AssignmentRows";
import { DropZone } from "./DropZone";
import { FileReference } from "./FileReference";
import { RecognisedFile } from "./RecognisedFile";
import { SettingsCompare } from "./SettingsCompare";
import { newImportSession, type ImportIo, type ImportSession } from "./importSession";

interface ImportViewProps {
    url: ConfigureUrlActions;
    data: EditData;
    io: ImportIo;
    session: ImportSession | null;
    setSession: Dispatch<SetStateAction<ImportSession | null>>;
    /** The fixture opens one type of the reference */
    referenceOpen?: ImportKind | null;
    /** The catalog, the admin's choices and placements: the label to context matching of an access model file */
    model: ModelData;
}

/**
 * Import a file (spec 7, NG-71): choose a file, see how it was recognised, check every row of an assignment file against
 * the tenant, and put the rows that survive into the basket. The file and the ticks live in `ConfigureView`, so the
 * review and "Back to changes" keep them. Settings files and the access model file are compared in NG-72.
 */
export function ImportView({ url, data, io, session, setSession, referenceOpen, model }: ImportViewProps) {
    const basketActions = useConfigureBasketActions();
    // Parsed once per file and chosen type: a tick or a filter replaces the session, not the file
    const text = session?.text;
    const fileName = session?.fileName;
    const chosenKind = session?.chosenKind ?? null;
    const file = useMemo(() => (text !== undefined && fileName !== undefined ? readImportFile(text, fileName, chosenKind) : null), [text, fileName, chosenKind]);
    const isAssignments = file?.kind === "roleAssignments" || file?.kind === "groupAssignments";
    const isSettings = file?.kind === "rolePolicies" || file?.kind === "groupPolicies";
    const isModel = file?.kind === "accessModel";
    const isChoices = file?.kind === "accessModelChoices";
    // The choices of a PIM Manager access model file: read once per file, checked against the tenant on screen
    const choices = useMemo(() => (isChoices && file ? parseAccessModelFile(file.json) : null), [isChoices, file]);
    const known = useMemo(() => knownPrincipals(data.roles, data.groups), [data.roles, data.groups]);
    const principals = useMemo(() => mergePrincipals(session?.lookups ?? EMPTY_PRINCIPALS, known), [session?.lookups, known]);
    // The failures belong to one chosen file: another file starts clean
    const [lookupFailedFor, setLookupFailedFor] = useState<number | null>(null);
    const [unitsFailedFor, setUnitsFailedFor] = useState<number | null>(null);
    const [isChecking, setIsChecking] = useState(false);
    // "Other file" brings the focus back to the file input (I-12)
    const [isOtherFile, setIsOtherFile] = useState(false);
    const checkingKey = useRef<string | null>(null);
    const [attempt, setAttempt] = useState(0);
    const asked = useRef(new Set<string>());

    // People no loaded assignment names, asked once per file (a failed ask is asked again by "Try again")
    const rows = file?.csv?.rows;
    const sessionId = session?.id;
    const lookupFailed = sessionId !== undefined && lookupFailedFor === sessionId;
    const unitsFailed = sessionId !== undefined && unitsFailedFor === sessionId;
    // Ask for people only when the loaded assignments are in: they name most of them already
    const isLoaded = !data.isRolesLoading && !data.isPoliciesLoading && ((file?.kind !== "groupAssignments" && file?.kind !== "groupPolicies") || !data.isGroupsLoading);
    const approverNames = useMemo(() => approverNameIndex(data.roles, data.groups, principals.byId), [data.roles, data.groups, principals.byId]);
    useEffect(() => {
        if (sessionId === undefined || !(isAssignments || isSettings) || !rows || !isLoaded) return;
        const key = `${sessionId}|${chosenKind}|${attempt}`;
        if (asked.current.has(key)) return;
        const needed = isAssignments
            ? neededLookups(rows, mergePrincipals(session?.lookups ?? EMPTY_PRINCIPALS, known))
            : { ids: approverIdsToLookUp(rows, approverNames), upns: [] as string[] };
        if (needed.ids.length === 0 && needed.upns.length === 0) return;
        asked.current.add(key);
        // eslint-disable-next-line react-hooks/set-state-in-effect -- the read is the effect
        setIsChecking(true);
        checkingKey.current = key;
        io.lookupPrincipals(needed)
            .then((found) => setSession((s) => (s && s.id === sessionId ? { ...s, lookups: mergePrincipals(s.lookups ?? EMPTY_PRINCIPALS, found) } : s)))
            .catch(() => setLookupFailedFor(sessionId))
            // Only the look-up of the file on screen ends the checking (I-05): an older one settling late changes nothing
            .finally(() => { if (checkingKey.current === key) setIsChecking(false); });
    }, [sessionId, chosenKind, attempt, isAssignments, isSettings, isLoaded, rows, known, approverNames, session?.lookups, io, setSession]);
    const needsUnits = isAssignments && file?.kind === "roleAssignments" && (rows ?? []).some((r) => typeof r.scopeId === "string" && /^\/administrativeUnits\//i.test(r.scopeId.trim()));
    useEffect(() => {
        if (!sessionId || !needsUnits || session?.units || unitsFailed) return;
        void data.scopes.loadAdministrativeUnits()
            .then((units) => setSession((s) => (s && s.id === sessionId ? { ...s, units: new Map(units.map((u) => [u.id.toLowerCase(), u.displayName])) } : s)))
            // Units that could not be read are not checked: the row is judged on the rest, never "no such unit"
            .catch(() => setUnitsFailedFor(sessionId));
    }, [sessionId, needsUnits, session?.units, unitsFailed, data.scopes, setSession]);

    // What Edit and Guided put in the basket is never replaced from here
    const { basket } = useConfigureBasket();
    const addedIds = session?.addedIds;
    // A change is the import's own when it still comes from an import and either the last press added it or it came
    // from a file of the same name (I-03: choosing the corrected file again replaces its earlier changes). An Edit change
    // that replaced it under the same id is Edit's, never taken out again from here
    const mineIds = useMemo(() => {
        const added = new Set(addedIds ?? []);
        return basket.changes.filter((c) => c.source.from === "import" && (added.has(changeId(c)) || (!!fileName && c.source.file === fileName))).map(changeId);
    }, [basket.changes, addedIds, fileName]);
    const otherChangeIds = useMemo(() => {
        const mine = new Set(mineIds);
        return new Set(basket.changes.map(changeId).filter((id) => !mine.has(id)));
    }, [basket.changes, mineIds]);
    const isGroupFile = file?.kind === "groupAssignments" || file?.kind === "groupPolicies";
    const tenantProblem = isGroupFile
        ? (!data.isGroupsConsented ? "Turn on PIM for Groups in Settings to check the rows of a group file." : data.groupsError ? "The groups could not be read, so the rows cannot be checked yet." : null)
        : data.rolesError ? "The roles could not be read, so the rows cannot be checked yet." : null;
    const isTenantReady = !tenantProblem && !data.isRolesLoading && !data.isPoliciesLoading && (!isGroupFile || !data.isGroupsLoading);
    const isModelReady = isModel && !data.rolesError && !data.isRolesLoading && !data.isPoliciesLoading && (!data.isGroupsConsented || (!data.isGroupsLoading && !data.groupsError));
    const isReady = (isAssignments || isSettings) && isTenantReady && !isChecking && (!lookupFailed || isSettings) && (!needsUnits || session?.units !== null || unitsFailed);
    const checked = useMemo(() => {
        if (!isReady || !isAssignments || !file?.csv || !file.kind) return null;
        return checkAssignmentRows({
            kind: file.kind === "roleAssignments" ? "role" : "group",
            rows: file.csv.rows,
            rowNumbers: file.csv.rowNumbers,
            errors: file.csv.errors,
            isOlderRemoval: file.detected.isOlderRemoval,
            fileName: file.fileName,
            roles: data.roles,
            groups: data.groups,
            access: data.access,
            principals,
            administrativeUnits: session?.units ?? null,
            tenantName: data.tenantName,
            now: data.now,
            otherChangeIds,
        });
    }, [isReady, isAssignments, file, data.roles, data.groups, data.access, principals, session?.units, data.tenantName, data.now, otherChangeIds]);

    // Settings files and the access model file: every filled cell against the policy as read
    const compared = useMemo(() => {
        const context = {
            fileName: file?.fileName ?? "",
            roles: data.roles,
            groups: data.groups,
            access: data.access,
            tenantName: data.tenantName,
            loading: { isRolesLoading: data.isRolesLoading || data.isPoliciesLoading, isGroupsLoading: data.isGroupsLoading },
            words: { contexts: data.authenticationContexts, extensions: data.customExtensions },
            contexts: data.authenticationContexts,
            otherBasket: { changes: basket.changes.filter((c) => !mineIds.includes(changeId(c))) },
            names: approverNames,
        };
        if (isReady && isSettings && file?.csv && file.kind) {
            return compareSettingsRows({ ...context, kind: file.kind === "rolePolicies" ? "role" : "group", rows: file.csv.rows, rowNumbers: file.csv.rowNumbers, errors: file.csv.errors, headers: file.csv.headers });
        }
        if (isModelReady && file && file.json !== null) {
            const catalog = model.loaded?.catalog ?? data.catalog;
            const templateOf = new Map(data.roles.map((r) => [r.definition.id, r.definition.templateId ?? r.definition.id]));
            return compareAccessModel(file.json, {
                ...context,
                resolveContext: (slug) => {
                    const label = catalog?.authContexts.find((c) => c.slug === slug);
                    const byPolicy = label && model.conditionalAccessPolicies ? contextsMeetingLabel(label, model.conditionalAccessPolicies) : undefined;
                    const match = matchContext(slug, data.authenticationContexts, model.contextChoices, byPolicy);
                    return match.kind === "chosen" || match.kind === "byName" || match.kind === "byPolicy" ? match.contextId : null;
                },
                templateOf: (id) => templateOf.get(id),
                placementOf: (groupId) => {
                    const own = model.groupPlacements[groupId];
                    if (own) return own;
                    if (!catalog) return null;
                    const proposal = proposeGroupPlacement(catalog, getRolesHeldByGroup(data.roles, groupId).map((h) => templateOf.get(h.roleId) ?? h.roleId));
                    return proposal ? { plane: proposal.plane, securityLevel: proposal.securityLevel } : null;
                },
            });
        }
        return null;
    }, [isReady, isModelReady, isSettings, file, data.roles, data.groups, data.access, data.tenantName, data.isRolesLoading, data.isPoliciesLoading, data.isGroupsLoading, data.authenticationContexts, data.customExtensions, data.catalog, model.loaded, model.conditionalAccessPolicies, model.contextChoices, model.groupPlacements, basket.changes, mineIds, approverNames]);

    if (!session || !file) {
        return (
            <div className="flex flex-col gap-4">
                <DropZone
                    onFile={(name, text) => setSession(newImportSession(name, text))}
                    onExample={async (name) => setSession(newImportSession(name, await io.loadExample(name)))}
                    takeFocus={isOtherFile}
                />
                <FileReference initialOpen={referenceOpen} />
            </div>
        );
    }

    const unchecked = new Set(session.unchecked);
    const patch = (change: Partial<ImportSession>) => setSession((s) => (s ? { ...s, ...change } : s));
    const uncheckedKeys = new Set(session.uncheckedKeys);
    const review = () => {
        if (!checked && !compared) return;
        const changes = checked ? changesOfRows(checked, unchecked) : (compared?.diffs ?? []).filter((d) => !uncheckedKeys.has(d.key)).map((d) => d.change);
        // Nothing ticked after an earlier press: the press takes that press's changes out of the basket and stays
        if (changes.length === 0) {
            basketActions.leaveOut(mineIds);
            patch({ addedIds: [] });
            return;
        }
        // The press replaces what the last press added; changes made in Edit or Guided are never touched
        if (mineIds.length > 0) basketActions.leaveOut(mineIds);
        basketActions.add(changes);
        patch({ addedIds: changes.map(changeId) });
        url.openReview();
    };

    const groupsReady = data.isGroupsConsented && !data.isGroupsLoading && !data.groupsError;
    const groupsNote = !data.isGroupsConsented
        ? "Turn on PIM for Groups in Settings to place the groups of this file."
        : data.groupsError ? "The groups could not be read, so their placements are not offered." : data.isGroupsLoading ? "Reading the groups…" : null;
    const groupRefs = model.groups.map((g) => ({ id: g.group.id, displayName: g.group.displayName }));
    // The contexts come with the roles: until they are read, a label cannot be matched to one
    const contextsReady = !data.isRolesLoading && !data.rolesError;

    return (
        <div className="flex flex-col gap-4">
            <RecognisedFile
                file={file}
                onChooseKind={(kind: ImportKind | null) => patch({ chosenKind: kind, unchecked: [], uncheckedKeys: [], filter: "all", addedIds: session.addedIds })}
                onOtherFile={() => { setIsOtherFile(true); setSession(null); }}
            />
            {isAssignments && lookupFailed && (
                <StatusBox variant="error" title="Could not look up the people" action={<Button onClick={() => { setLookupFailedFor(null); setAttempt((n) => n + 1); }}>Try again</Button>}>
                    Microsoft Graph did not answer the look-up of the people in this file, so the rows are not checked. Nobody is reported as missing because of it.
                </StatusBox>
            )}
            {(isAssignments || isSettings || isModel) && !checked && !compared && !(isAssignments && lookupFailed) && (
                <p role="status" className="rounded border border-line bg-surface px-4 py-6 text-sm text-body">
                    {(isModel ? (data.rolesError ? "The roles could not be read, so the file cannot be compared yet." : null) : tenantProblem) ?? ((isModel ? !isModelReady : !isTenantReady) ? `Reading ${isGroupFile ? "groups" : "roles"} and their settings before the file is compared…` : "Checking the file…")}
                </p>
            )}
            <p role="status" className="sr-only">{compared || checked ? "The file is checked. The rows are below." : ""}</p>
            {isChoices && choices && !choices.ok && (
                <StatusBox variant="error" title="The file cannot be read">{choices.reason}</StatusBox>
            )}
            {isChoices && choices?.ok && !contextsReady && (
                <p role="status" className="rounded border border-line bg-surface px-4 py-6 text-sm text-body">
                    {data.rolesError ? "The roles could not be read, so the file cannot be matched to the tenant yet." : "Reading the authentication contexts before the file is matched…"}
                </p>
            )}
            {isChoices && choices?.ok && contextsReady && (
                <AccessModelChoices
                    file={choices.file}
                    tenantId={model.tenantId}
                    skipped={choices.skipped}
                    contexts={model.contexts}
                    groups={groupRefs}
                    groupsReady={groupsReady}
                    groupsNote={groupsNote}
                    contextChoices={model.contextChoices}
                    groupPlacements={model.groupPlacements}
                    onChooseContext={model.onChooseContext}
                    onPlaceGroup={model.onPlaceGroup}
                    unchecked={uncheckedKeys}
                    onToggle={(key) => patch({ uncheckedKeys: uncheckedKeys.has(key) ? session.uncheckedKeys.filter((k) => k !== key) : [...session.uncheckedKeys, key] })}
                />
            )}
            {compared && (
                <SettingsCompare
                    result={compared}
                    tenantName={data.tenantName}
                    unchecked={uncheckedKeys}
                    onToggle={(key) => patch({ uncheckedKeys: uncheckedKeys.has(key) ? session.uncheckedKeys.filter((k) => k !== key) : [...session.uncheckedKeys, key] })}
                    onToggleAll={(keys, isChecked) => patch({ uncheckedKeys: isChecked ? session.uncheckedKeys.filter((k) => !keys.includes(k)) : [...new Set([...session.uncheckedKeys, ...keys])] })}
                    onReview={review}
                    hasAdded={session.addedIds.length > 0}
                />
            )}
            {checked && (
                <AssignmentRows
                    rows={checked}
                    unchecked={unchecked}
                    filter={session.filter}
                    onFilter={(filter) => patch({ filter })}
                    onToggle={(line) => patch({ unchecked: unchecked.has(line) ? session.unchecked.filter((l) => l !== line) : [...session.unchecked, line] })}
                    onToggleAll={(lines, isChecked) => patch({ unchecked: isChecked ? session.unchecked.filter((l) => !lines.includes(l)) : [...new Set([...session.unchecked, ...lines])] })}
                    onReview={review}
                    hasAdded={session.addedIds.length > 0}
                />
            )}
        </div>
    );
}
