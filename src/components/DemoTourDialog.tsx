"use client";

import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import type { TourProduct } from "@/config/onboarding";
import type { DemoTourAnswer } from "@/utils/tourProgress";

interface DemoTourDialogProps {
    /** The product to ask about; null keeps the dialog closed */
    product: TourProduct | null;
    onAnswer: (answer: DemoTourAnswer) => void;
}

/** The demo asks once per product whether to start its tours (tour spec 4.6); Escape and the backdrop count as No thanks */
export function DemoTourDialog({ product, onAnswer }: DemoTourDialogProps) {
    const name = product === "azure" ? "Azure" : "Entra";
    return (
        <Dialog isOpen={product !== null} onClose={() => onAnswer("no")} title="Do you want to start the tour?" width={420}>
            <p className="text-[13px] leading-5 text-body">A short walk through the app and this page. Every other {name} page shows its own tour the first time you open it. You can stop whenever you like, and start it again from Help.</p>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
                <Button onClick={() => onAnswer("no")}>No thanks</Button>
                <Button variant="primary" onClick={() => onAnswer("yes")}>Start the tour</Button>
            </div>
        </Dialog>
    );
}
