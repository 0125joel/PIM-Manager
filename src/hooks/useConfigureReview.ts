"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useConfigureBasket, useConfigureBasketActions } from "@/contexts/ConfigureBasketContext";
import { useUnifiedActions } from "@/contexts/UnifiedPimContext";
import { dryRunAssignments } from "@/services/assignmentDryRunService";
import type { Target } from "@/types/configure.types";
import type { RoleDetailData } from "@/types/directoryRole.types";
import type { PimGroupData } from "@/types/pimGroup.types";
import { touchedTargets } from "@/utils/configureBasket";
import { buildPreflight, conditionalAccessInput, type DryRunOutcome, type PreflightFix } from "@/utils/configurePreflight";
import { approverRoleHolders, buildTargetStates, describeReview, dryRunItems, targetName, type ReviewData } from "@/utils/configureReview";
import type { ValueWords } from "@/utils/configureSettingRows";
import type { ConditionalAccessPolicyLike } from "@/utils/accessModelCatalog";
import type { ConditionalAccessStatus } from "@/hooks/useConditionalAccess";
import type { UndoWarning } from "@/utils/configureHistory";
import type { WriteAccess } from "@/utils/writeAccess";
import { isAbortError } from "@/utils/errorUtils";

export interface ConfigureReviewInput {
    isReviewing: boolean;
    roles: RoleDetailData[];
    groups: PimGroupData[];
    userId: string | null;
    access: WriteAccess | null;
    /** Reads the access check again (entering the review, spec 3.3) */
    recheck: () => Promise<unknown>;
    emergencyAccounts: ReadonlyMap<string, string>;
    conditionalAccess: { status: ConditionalAccessStatus; policies: readonly ConditionalAccessPolicyLike[] | null; check: () => unknown };
    words: ValueWords;
    contextNames: Readonly<Record<string, string>>;
    customExtensionIds: ReadonlySet<string> | null;
    onBack: () => void;
    onGrant: (workloads: ("directoryRoles" | "pimGroups")[]) => void;
    /** Starts the apply (NG-69) */
    onApply: () => void;
    /** Why Apply cannot start now (an apply is running), or null */
    applyBlockedReason: string | null;
    /** The progress list while the apply runs; null otherwise */
    progress: ReviewData["progress"];
    /** The warnings of "Undo this apply" while the basket undoes an apply (spec 14.3) */
    undoWarnings: readonly UndoWarning[] | null;
    /** Why the review is empty after an undo */
    emptyReason: string | null;
}

/**
 * The review of the app page (spec 12, NG-68): entering it reads the access check again and sends every new assignment
 * once as a dry run (`isValidationOnly`); the pre-flight runs on the targets as read and the review view follows.
 */
export function useConfigureReview(input: ConfigureReviewInput): ReviewData {
    const { basket } = useConfigureBasket();
    const { add, leaveOut } = useConfigureBasketActions();
    const { getGraphClient } = useUnifiedActions();
    const [dryRun, setDryRun] = useState<{ key: string; outcomes: Record<string, DryRunOutcome> } | null>(null);
    const [isRechecked, setIsRechecked] = useState(false);
    const { isReviewing, recheck } = input;

    // Entering the review reads the access check again; leaving it forgets that
    const wasReviewing = useRef(false);
    useEffect(() => {
        if (isReviewing && !wasReviewing.current) void recheck().finally(() => setIsRechecked(true));
        if (!isReviewing && wasReviewing.current) setIsRechecked(false);
        wasReviewing.current = isReviewing;
    }, [isReviewing, recheck]);

    // The dry run of the new assignments, once per set of adds while the review is open
    const items = useMemo(() => dryRunItems(basket), [basket]);
    // Keyed by what is sent, not only by which assignments (W-09): a new end on the same add runs the dry run again
    const itemsKey = items.map((i) => `${i.id}|${i.change.start ?? ""}|${i.change.end ?? ""}|${i.change.justification}`).join("\n");
    useEffect(() => {
        if (!isReviewing || items.length === 0) return;
        const controller = new AbortController();
        void (async () => {
            try {
                const results = await dryRunAssignments(await getGraphClient(), items, controller.signal);
                const outcomes: Record<string, DryRunOutcome> = {};
                for (const [id, r] of Object.entries(results)) outcomes[id] = r.ok ? { ok: true } : { ok: false, message: r.message, remediation: r.remediation, transient: r.transient };
                setDryRun({ key: itemsKey, outcomes });
            } catch (error: unknown) {
                if (!isAbortError(error)) setDryRun({ key: itemsKey, outcomes: {} });
            }
        })();
        return () => controller.abort();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the adds are keyed by itemsKey
    }, [isReviewing, itemsKey, getGraphClient]);

    const view = useMemo(() => {
        if (!isReviewing || !isRechecked) return null;
        if (items.length > 0 && dryRun?.key !== itemsKey) return null;
        const targets: Target[] = touchedTargets(basket);
        const states = buildTargetStates(input.roles, input.groups, targets);
        const checks = buildPreflight({
            basket,
            targets: states.preflight,
            me: { userId: input.userId, access: input.access },
            emergencyAccounts: input.emergencyAccounts,
            approverRoles: approverRoleHolders(input.roles, input.emergencyAccounts),
            conditionalAccess: conditionalAccessInput(input.conditionalAccess.status, input.conditionalAccess.policies, Object.keys(input.contextNames)),
            contextNames: input.contextNames,
            customExtensionIds: input.customExtensionIds,
            dryRun: items.length > 0 ? dryRun?.outcomes ?? null : {},
            now: new Date(),
            undoWarnings: input.undoWarnings,
        });
        return describeReview({ basket, checks, nameOf: (t) => targetName(t, input.roles, input.groups), words: input.words });
    }, [isReviewing, isRechecked, items.length, dryRun, itemsKey, basket, input.roles, input.groups, input.userId, input.access, input.emergencyAccounts, input.conditionalAccess.status, input.conditionalAccess.policies, input.contextNames, input.customExtensionIds, input.words, input.undoWarnings]);

    return {
        view,
        onLeaveOut: leaveOut,
        onBack: input.onBack,
        onApply: input.onApply,
        applyBlockedReason: input.applyBlockedReason,
        progress: input.progress,
        emptyReason: input.emptyReason,
        onFix: (fix: PreflightFix) => {
            if (fix.kind === "grantPermission") input.onGrant(fix.workloads);
            else if (fix.kind === "checkConditionalAccess") void input.conditionalAccess.check();
            else add(fix.removals);
        },
    };
}
