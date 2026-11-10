"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useMsal } from "@azure/msal-react";
import { DemoTourDialog } from "@/components/DemoTourDialog";
import { OnboardingTour } from "@/components/OnboardingTour";
import { TourChoiceDialog } from "@/components/TourChoiceDialog";
import { TOURS, type TourId, type TourProduct } from "@/config/onboarding";
import { useDemoMode } from "@/contexts/DemoModeContext";
import { TOUR_CHOICE_EVENT } from "@/hooks/useOnboarding";
import { useCurrentTourPage } from "@/hooks/useTourPage";
import { environmentFromPath } from "@/utils/shellNavigation";
import {
    buildRun,
    initTourProgress,
    markToursSeen,
    planAutoRun,
    readDemoTourAnswer,
    readSeenTours,
    readTourSetting,
    toursToMarkSeen,
    writeDemoTourAnswer,
    writeTourSetting,
    type DemoTourAnswer,
    type RunStep,
    type TourEnd,
} from "@/utils/tourProgress";


interface Run {
    id: number;
    steps: RunStep[];
    isAuto: boolean;
}

/** A dialog or a modal panel is open: a tour that starts by itself waits for it (tour spec 4.2) */
function isBlockedByDialog(): boolean {
    return document.querySelector("dialog[open], [aria-modal='true']") !== null;
}

/** Starts the tours (tour spec 4): by themselves on a page that is ready, by hand from Help, and in the demo after a question */
export function OnboardingWrapper() {
    const { accounts } = useMsal();
    const pathname = usePathname() ?? "";
    const isDemo = useDemoMode();
    const tourPage = useCurrentTourPage();
    const [run, setRun] = useState<Run | null>(null);
    const [isChoiceOpen, setIsChoiceOpen] = useState(false);
    const [demoQuestion, setDemoQuestion] = useState<TourProduct | null>(null);
    const [isInitialized, setIsInitialized] = useState(false);
    const [waitTick, setWaitTick] = useState(0);
    // Tours tried in this session: a tour whose targets were all missing stays unseen but is not started again
    const attemptedRef = useRef<Set<string>>(new Set());
    // The tour of the page where the demo question got No thanks (tour spec 4.6)
    const declinedPageRef = useRef<TourId | null>(null);
    const runIdRef = useRef(0);
    const isSignedIn = accounts.length > 0;

    const startRun = useCallback((ids: TourId[], isAuto: boolean) => {
        for (const id of ids) attemptedRef.current.add(id);
        runIdRef.current += 1;
        setRun({ id: runIdRef.current, steps: buildRun(ids, TOURS, pathname), isAuto });
    }, [pathname]);

    // Once per browser, after mount: the zero point of the tours (everyone starts with no tour seen) and the old keys removed
    useEffect(() => {
        initTourProgress();
        // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration-safe one-time read of localStorage
        setIsInitialized(true);
    }, [isDemo]);

    // Start the tour in Help opens the choice (tour spec 4.4)
    useEffect(() => {
        const open = () => setIsChoiceOpen(true);
        window.addEventListener(TOUR_CHOICE_EVENT, open);
        return () => window.removeEventListener(TOUR_CHOICE_EVENT, open);
    }, []);

    // A tour that starts by itself, or the demo question: on a page that is ready, one at a time, never over a dialog
    useEffect(() => {
        if (!isSignedIn || !isInitialized || run || isChoiceOpen || demoQuestion || !tourPage?.isReady) return;
        // No thanks in the demo: nothing more on that page; the app tour waits for the next part
        if (tourPage.tour === declinedPageRef.current) return;
        declinedPageRef.current = null;
        const product = TOURS.find((t) => t.id === tourPage.tour)?.product;
        if (product !== "entra" && product !== "azure") return;
        const needsDemoQuestion = isDemo && readDemoTourAnswer(product) === null;
        const seen = new Set([...readSeenTours(), ...attemptedRef.current]);
        // The demo asks first; after that it starts the tours of a part on its first visit, as the app does (Joël, 2026-10-31)
        const ids = needsDemoQuestion ? [] : planAutoRun({ pageTour: tourPage.tour, tours: TOURS, seen, setting: readTourSetting() });
        if (!needsDemoQuestion && ids.length === 0) return;
        if (isBlockedByDialog()) {
            const timer = setTimeout(() => setWaitTick((n) => n + 1), 1000);
            return () => clearTimeout(timer);
        }
        // eslint-disable-next-line react-hooks/set-state-in-effect -- starts once the page reports it is ready
        if (needsDemoQuestion) setDemoQuestion(product);
        else startRun(ids, true);
    }, [isSignedIn, isInitialized, run, isChoiceOpen, demoQuestion, tourPage, isDemo, waitTick, startRun]);

    const endRun = useCallback((endedBy: TourEnd, shownKeys: ReadonlySet<string>) => {
        if (run) markToursSeen(toursToMarkSeen(run.steps, shownKeys, endedBy));
        setRun(null);
    }, [run]);

    const turnOff = useCallback(() => {
        writeTourSetting("off");
        if (run) markToursSeen(toursToMarkSeen(run.steps, new Set(), "stop"));
        setRun(null);
    }, [run]);

    const choose = (ids: TourId[]) => {
        setIsChoiceOpen(false);
        if (ids.length > 0) startRun(ids, false);
    };

    const answerDemo = (answer: DemoTourAnswer) => {
        if (!demoQuestion) return;
        const product = demoQuestion;
        writeDemoTourAnswer(product, answer);
        setDemoQuestion(null);
        // Start the tour runs what a first visit runs: the app tour and the tours of this page (Joël, 2026-10-31)
        if (answer === "yes" && tourPage) {
            const seen = new Set([...readSeenTours(), ...attemptedRef.current]);
            const ids = planAutoRun({ pageTour: tourPage.tour, tours: TOURS, seen, setting: "on" });
            if (ids.length > 0) startRun(ids, false);
        }
        // No thanks also covers the tours of the page that asked; the next parts still start their own tour
        else if (tourPage) {
            markToursSeen([tourPage.tour]);
            declinedPageRef.current = tourPage.tour;
        }
    };

    // Only for authenticated users (the demo signs in a made-up account)
    if (!isSignedIn) return null;

    return (
        <>
            {run && <OnboardingTour key={run.id} steps={run.steps} isAuto={run.isAuto} onEnd={endRun} onTurnOff={turnOff} />}
            <TourChoiceDialog isOpen={isChoiceOpen} product={environmentFromPath(pathname)} onChoose={choose} onClose={() => setIsChoiceOpen(false)} />
            <DemoTourDialog product={demoQuestion} onAnswer={answerDemo} />
        </>
    );
}
