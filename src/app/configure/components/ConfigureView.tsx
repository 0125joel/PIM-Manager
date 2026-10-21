"use client";

import { Skeleton } from "@/components/ui/Skeleton";
import { useEffect, useReducer, useState, type ReactNode } from "react";
import type { ConfigureUrlActions } from "@/hooks/useConfigureUrlState";
import { Button } from "@/components/ui/Button";
import { useLeaveGuard } from "@/hooks/useLeaveGuard";
import type { AccessView, LastApplyLine } from "@/utils/configureStart";
import type { ConfigureMode } from "@/utils/configureUrlState";
import { AccessModelPanel } from "./AccessModelPanel";
import { AccessRow } from "./AccessRow";
import { BasketBar } from "./BasketBar";
import { ConfigureHead } from "./ConfigureHead";
import { EditView, type EditData } from "./edit/EditView";
import { GuidedView } from "./guided/GuidedView";
import { ImportView } from "./import/ImportView";
import type { ImportIo, ImportSession } from "./import/importSession";
import type { ImportKind } from "@/utils/importDetect";
import { GUIDED_STEPS, INITIAL_GUIDED_STATE, guidedAddIds, guidedReducer, type GuidedState } from "@/utils/guidedRoute";
import { useConfigureBasket } from "@/contexts/ConfigureBasketContext";
import { ModelPage, type ModelData } from "./model/ModelPage";
import { ResultPage, type ResultData } from "./result/ResultPage";
import { ReviewPage, type ReviewData } from "./review/ReviewPage";
import { EntryCards } from "./EntryCards";
import { LastApplies } from "./LastApplies";
import { LeaveDialog } from "./LeaveDialog";
import { ModeBar } from "./ModeBar";

export interface ConfigureViewProps {
    tenantName: string;
    url: ConfigureUrlActions;
    access: AccessView;
    onRetryAccess: () => void;
    onGrant: () => void;
    isGranting: boolean;
    /** The Refresh of the head (hidden below 640, where the compact header has it) */
    refresh: ReactNode;
    catalogRoleCount: number | null;
    lastApplies: LastApplyLine[];
    undoBlockedReason: (runId: string) => string | null;
    onUndo: (runId: string) => void;
    /** An undo that stopped (Last applies says it) */
    undoNotice?: string | null;
    basket: { changeCount: number; targetCount: number };
    onDiscard: () => void;
    reportHref: string;
    /** The roles, groups and lists Edit shows */
    edit: EditData;
    /** The catalog and what the access model page compares it with */
    model: ModelData;
    /** The review of the basket (step "review" of a mode) */
    review: ReviewData;
    /** The result of the last apply (step "result" of a mode) */
    result: ResultData;
    /** The fixture starts Guided with these choices; the app starts it fresh */
    guidedPreset?: Partial<GuidedState>;
    /** Graph look-ups and the bundled examples of Import (the fixture passes its own) */
    importIo: ImportIo;
    /** The fixture starts Import with this file; the app starts it empty */
    importPreset?: ImportSession | null;
    /** The fixture opens this type in "What can I import?" */
    importReferenceOpen?: ImportKind | null;
}

const HEADS: Record<ConfigureMode, (n: number | null, tenant: string) => { title: string; subtitle: string }> = {
    edit: () => ({ title: "Change roles and groups", subtitle: "Pick a role or group, or switch on Select several. Every change waits in the bar below." }),
    guided: () => ({ title: "Guided", subtitle: "The same rules on several roles or groups, in the right order." }),
    import: (_n, tenant) => ({ title: "Import a file", subtitle: `Every row is checked against ${tenant} before it becomes a change. Nothing is written until you review and apply.` }),
    model: (n) => ({ title: "The PIM Monitor access model", subtitle: `How PIM Monitor sorts all ${n !== null ? `${n} ` : ""}Entra roles into planes and levels, and the settings it recommends per level. Configure uses it as a template; you always review before anything is written.` }),
};

/**
 * The Configure page (spec 2, 4): the start page, or a mode with its bar; the basket bar under every view. Props only,
 * so the fixture route renders it without sign-in. The bodies of the modes come with their own packages; until then a
 * mode shows its head and one line.
 */
export function ConfigureView(props: ConfigureViewProps) {
    const { tenantName, url, access, basket, refresh } = props;
    const { mode, step } = url.state;
    const guard = useLeaveGuard(basket.changeCount);
    const isOpen = access.row.kind === "open";
    // The route of Guided lives here, so the review (a step of the mode) and "Back to changes" keep it (plan NG-70)
    const [guided, dispatchGuided] = useReducer(guidedReducer, props.guidedPreset, (preset) => ({ ...INITIAL_GUIDED_STATE, ...preset }));
    const { basket: basketState } = useConfigureBasket();
    // The file of Import lives here too, so the review and "Back to changes" keep it
    const [importSession, setImportSession] = useState<ImportSession | null>(props.importPreset ?? null);
    const openMode = (m: Exclude<ConfigureMode, "model">) => {
        if (m === "import") setImportSession(null);
        if (m === "guided") dispatchGuided({ type: "reset", state: { inheritedAdds: guidedAddIds(basketState) } });
        url.setMode(m);
    };
    // "Use as a template" (spec 8): Guided at step 2 with the access model; for groups the admin chooses Groups first
    const openTemplate = () => {
        dispatchGuided({ type: "reset", state: { from: "model", parts: ["activation", "assignment"], inheritedAdds: guidedAddIds(basketState) } });
        url.setMode("guided", 2);
    };
    // An apply ends the route: its changes are written, an undo or a retry opens the review on a fresh route
    const isResult = step === "result";
    useEffect(() => {
        if (isResult) dispatchGuided({ type: "reset", state: { inheritedAdds: guidedAddIds(basketState) } });
        // eslint-disable-next-line react-hooks/exhaustive-deps -- once when the result step opens
    }, [isResult]);

    let body: ReactNode;
    // The review draws its own content and bar as children of the column (its bar replaces the basket bar, spec 12.3)
    const isReview = !!mode && mode !== "model" && step === "review" && isOpen;
    if (!mode) {
        body = (
            <>
                <ConfigureHead title="Configure" subtitle={`Change PIM settings and assignments in ${tenantName}. Nothing is written until you review and apply.`} actions={refresh} />
                <AccessRow view={access} onRetry={props.onRetryAccess} onGrant={props.onGrant} isGranting={props.isGranting} reportHref={props.reportHref} />
                <EntryCards tenantName={tenantName} lock={access.entries} onOpen={openMode} />
                {access.entries.kind === "checking" ? (
                    // Spec 15: during the core load the panels below the entries are skeleton cards (C3-01)
                    <div className="grid gap-4 min-[900px]:grid-cols-2" aria-hidden="true">
                        <Skeleton height={168} className="rounded" />
                        <Skeleton height={168} className="rounded" />
                    </div>
                ) : (
                    <div className="grid gap-4 min-[900px]:grid-cols-2">
                        <AccessModelPanel roleCount={props.catalogRoleCount} onOpen={() => url.setMode("model")} />
                        <LastApplies lines={props.lastApplies} undoBlockedReason={props.undoBlockedReason} onUndo={props.onUndo} notice={props.undoNotice} />
                    </div>
                )}
            </>
        );
    } else {
        const head = step === "result"
            ? { title: props.result.view?.title ?? "Result", subtitle: props.result.view?.subline ?? "The result of an apply shows here until you leave it." }
            : step === "review" && props.review.progress
            ? { title: "Applying changes", subtitle: `Writing to ${tenantName}. Leaving the page asks first; Stop finishes the write in flight.` }
            : step === "review"
            ? { title: "Review changes", subtitle: basket.changeCount === 0 ? "Nothing has been written yet." : `${basket.changeCount} ${basket.changeCount === 1 ? "change" : "changes"} for ${basket.targetCount} ${basket.targetCount === 1 ? "target" : "targets"}. Nothing has been written yet.` }
            : HEADS[mode](props.catalogRoleCount, tenantName);
        // The access model is always readable; a mode that writes needs the access row open (spec 3.4)
        const isLocked = mode !== "model" && !isOpen && step !== "result";
        const actions = mode === "edit" && !step ? (
            <>
                <button type="button" onClick={() => url.setMode("model")} className="inline-flex h-[34px] items-center rounded border border-line bg-surface px-3 text-[13px] font-medium text-ink hover:bg-page max-sm:h-11">
                    Start from the access model
                </button>
                {refresh}
            </>
        ) : mode === "model" ? (
            // The access model has no basket and nothing to refresh here: its one action is the template (spec 8, render)
            <Button variant="primary" onClick={openTemplate} disabled={!props.model.loaded} title={props.model.loaded ? undefined : "The catalog is being read."}>Use as a template</Button>
        ) : step === "result" ? (
            <Button onClick={props.result.onBack}>Back to Configure</Button>
        ) : step || mode === "guided" || mode === "import" ? null : refresh;
        body = (
            <>
                <ModeBar
                    mode={mode}
                    step={step}
                    changeCount={basket.changeCount}
                    onLeave={() => guard.request(() => url.setMode(null))}
                    stepLabel={mode === "guided" ? `Step ${url.state.gstep ?? 1} of ${GUIDED_STEPS.length}: ${GUIDED_STEPS[(url.state.gstep ?? 1) - 1].name}` : mode === "import" ? (importSession ? "Check the file" : "Choose a file") : undefined}
                />
                <ConfigureHead title={head.title} subtitle={head.subtitle} actions={actions} />
                {isLocked ? (
                    <AccessRow view={access} onRetry={props.onRetryAccess} onGrant={props.onGrant} isGranting={props.isGranting} reportHref={props.reportHref} />
                ) : step === "review" ? null : step === "result" ? (
                    <ResultPage data={props.result} />
                ) : mode === "edit" && !step ? (
                    <EditView url={url} data={props.edit} />
                ) : mode === "guided" && !step ? (
                    <GuidedView url={url} data={props.edit} model={props.model} state={guided} dispatch={dispatchGuided} />
                ) : mode === "import" && !step ? (
                    <ImportView url={url} data={props.edit} io={props.importIo} session={importSession} setSession={setImportSession} referenceOpen={props.importReferenceOpen} model={props.model} />
                ) : mode === "model" ? (
                    <ModelPage data={props.model} />
                ) : (
                    <p className="rounded border border-dashed border-line bg-surface px-4 py-6 text-sm text-body">This part of the new Configure is still being built.</p>
                )}
            </>
        );
    }

    // A column as tall as the viewport under the bars, so the basket bar sits at the bottom also on a short page
    return (
        <div className="flex min-h-[calc(100dvh-3.5rem-3rem)] flex-col max-sm:min-h-[calc(100dvh-3.5rem-1.5rem-88px-env(safe-area-inset-bottom))]">
            <div className={isReview ? "" : "mb-6"}>{body}</div>
            {isReview && mode === "guided" && guided.reviewNotes.length > 0 && !props.review.progress && (
                <section aria-label="From the access model" className="mb-4 rounded border border-line border-l-2 border-l-warn-fill bg-surface px-4 py-3">
                    <h2 className="text-[13px] font-semibold text-ink">From the access model</h2>
                    {guided.reviewNotes.map((note) => <p key={note} className="mt-1 text-[13px] leading-[18px] text-body">{note}</p>)}
                </section>
            )}
            {isReview && <ReviewPage data={props.review} />}
            {/* In the review its own bar (spec 12.3) replaces the basket bar */}
            {/* Guided moves on with its own Next; its last step is the review (spec 6.5) */}
            {!step && mode !== "guided" && <BasketBar changeCount={basket.changeCount} targetCount={basket.targetCount} onDiscard={props.onDiscard} onReview={url.openReview} isReviewing={false} />}
            <LeaveDialog isOpen={guard.isAsking} changeCount={basket.changeCount} onStay={guard.cancel} onLeave={guard.confirm} />
        </div>
    );
}
