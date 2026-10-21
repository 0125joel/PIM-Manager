"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";

interface BasketBarProps {
    changeCount: number;
    targetCount: number;
    onDiscard: () => void;
    onReview: () => void;
    /** In the review the bar becomes the review bar (NG-68) */
    isReviewing?: boolean;
}

/**
 * The basket bar (spec 10.2): sticky at the bottom of `main` (so the help dock stays free), above the bottom navigation
 * below 640, a 1px `change` top border; hidden when the basket is empty. Discard asks first.
 */
export function BasketBar({ changeCount, targetCount, onDiscard, onReview, isReviewing = false }: BasketBarProps) {
    const [isConfirming, setIsConfirming] = useState(false);
    if (changeCount === 0) return null;
    const changes = `${changeCount} ${changeCount === 1 ? "change" : "changes"}`;
    return (
        <>
            <div
                role="region"
                aria-label="Changes not applied"
                className="sticky bottom-0 z-20 -mx-4 mt-auto flex items-center gap-3 border-t border-change bg-surface px-4 py-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 max-sm:bottom-[calc(72px+env(safe-area-inset-bottom))]"
            >
                <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">{changes} not applied</p>
                    <p className="text-xs text-body max-sm:hidden">{targetCount} {targetCount === 1 ? "target" : "targets"} · nothing is written until you apply</p>
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-2">
                    <Button onClick={() => setIsConfirming(true)}>Discard</Button>
                    {!isReviewing && <Button variant="primary" onClick={onReview}>Review and apply</Button>}
                </div>
            </div>
            <Dialog isOpen={isConfirming} onClose={() => setIsConfirming(false)} title={`Discard ${changes}?`} width={440}>
                <p className="text-sm text-body">They are removed from the basket. Nothing has been written to the tenant.</p>
                <div className="mt-5 flex justify-end gap-2">
                    <Button onClick={() => setIsConfirming(false)}>Keep them</Button>
                    <Button variant="primary" onClick={() => {
                        setIsConfirming(false);
                        onDiscard();
                        // The bar goes away with the basket: the focus goes to the page title, not the body (U-05)
                        setTimeout(() => document.getElementById("configure-title")?.focus(), 0);
                    }}>Discard</Button>
                </div>
            </Dialog>
        </>
    );
}
