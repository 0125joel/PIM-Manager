"use client";

import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TOURS, type TourId, type TourProduct } from "@/config/onboarding";
import { planAllRun, readSeenTours, tourSections } from "@/utils/tourProgress";

interface TourChoiceDialogProps {
    isOpen: boolean;
    /** The product of the page that is open; it comes first */
    product: TourProduct;
    onChoose: (ids: TourId[]) => void;
    onClose: () => void;
}

const PRODUCT_NAME: Record<TourProduct, string> = { entra: "Entra", azure: "Azure" };
const ROW = "flex w-full items-center justify-between gap-3 px-1 py-2.5 text-left text-[13px] leading-5 text-ink hover:bg-page max-sm:min-h-11";
const SEEN = "font-mono text-xs text-muted";

/**
 * Start the tour (tour spec 4.4): the app tour on top, then per product "All" and its tours per page, the product that
 * is open first. A product without tours is left out; the tours already seen are marked.
 */
export function TourChoiceDialog({ isOpen, product, onChoose, onClose }: TourChoiceDialogProps) {
    const seen = isOpen ? readSeenTours() : new Set<string>();
    const app = TOURS.find((t) => t.product === "app" && t.steps.length > 0);
    const products: TourProduct[] = product === "azure" ? ["azure", "entra"] : ["entra", "azure"];
    return (
        <Dialog isOpen={isOpen} onClose={onClose} title="Start a tour" width={480}>
            <p className="text-[13px] leading-5 text-body">Walk through a whole product, or pick one page.</p>
            {app && (
                <button type="button" onClick={() => onChoose([app.id])} className={`${ROW} mt-4 border-y border-line`}>
                    {app.label}
                    {seen.has(app.id) && <span className={SEEN}>seen</span>}
                </button>
            )}
            {products.map((p) => {
                const sections = tourSections(p, TOURS);
                if (sections.length === 0) return null;
                return (
                    <section key={p} aria-labelledby={`tour-choice-${p}`} className="mt-5">
                        <div className="flex items-center justify-between gap-3">
                            <h3 id={`tour-choice-${p}`} className="text-[13px] leading-5 font-semibold text-ink">{PRODUCT_NAME[p]}</h3>
                            <Button size="sm" onClick={() => onChoose(planAllRun(p, TOURS))}>All of {PRODUCT_NAME[p]}</Button>
                        </div>
                        <ul className="mt-2 flex flex-col border-t border-line">
                            {sections.map(({ section, tours }) => (
                                <li key={section} className="border-b border-line">
                                    {tours.length === 1 ? (
                                        <button type="button" onClick={() => onChoose([tours[0].id])} className={ROW}>
                                            {section}
                                            {seen.has(tours[0].id) && <span className={SEEN}>seen</span>}
                                        </button>
                                    ) : (
                                        <div className="flex flex-wrap items-center gap-2 px-1 py-2 max-sm:min-h-11">
                                            <span className="mr-auto text-[13px] leading-5 text-ink">{section}</span>
                                            {tours.map((tour) => (
                                                <Button key={tour.id} size="sm" onClick={() => onChoose([tour.id])}>
                                                    {seen.has(tour.id) ? `${tour.label} (seen)` : tour.label}
                                                </Button>
                                            ))}
                                        </div>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </section>
                );
            })}
        </Dialog>
    );
}
