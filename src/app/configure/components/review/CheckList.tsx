import { Icon, type IconName } from "@/components/icons/Icon";
import { Button } from "@/components/ui/Button";
import type { PreflightFix } from "@/utils/configurePreflight";
import type { ReviewAttention, ReviewView } from "@/utils/configureReview";

const TONE: Record<ReviewAttention["tone"], { icon: IconName; text: string; edge: string }> = {
    danger: { icon: "error", text: "text-danger-text", edge: "border-danger-text" },
    warn: { icon: "alert", text: "text-warn-text", edge: "border-warn-fill" },
    info: { icon: "info", text: "text-accent", edge: "border-accent" },
    success: { icon: "success", text: "text-success-text", edge: "border-success-text" },
};

const FIX_LABEL: Record<PreflightFix["kind"], string> = {
    grantPermission: "Grant permission",
    checkConditionalAccess: "Check Conditional Access",
    removeInThisApply: "Remove in this apply",
};

interface CheckListProps {
    attention: readonly ReviewAttention[];
    allChecks: ReviewView["allChecks"];
    onFix: (fix: PreflightFix) => void;
}

/**
 * The items that need attention (spec 12.1): a small icon and a 2px edge in the tone, title, text and lines, no second
 * box; the action of the item under it. At the bottom every check with its outcome, behind "See all {n} checks".
 */
export function CheckList({ attention, allChecks, onFix }: CheckListProps) {
    return (
        <>
            {attention.length > 0 && (
                <ul aria-label="Needs your attention" className="flex flex-col gap-5 px-4 pb-6 sm:pr-5 sm:pl-[68px]">
                    {attention.map((item) => {
                        const tone = TONE[item.tone];
                        return (
                            <li key={item.id} className={`flex gap-2.5 border-l-2 pl-3 ${tone.edge}`}>
                                <Icon name={tone.icon} size={16} className={`mt-0.5 shrink-0 ${tone.text}`} label={item.tone === "info" ? "Good to know" : item.label} />
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-semibold text-ink">{item.title}</p>
                                    {item.text && <p className="mt-0.5 text-[13px] leading-5 text-body">{item.text}</p>}
                                    {item.items.length > 0 && (
                                        <ul className="mt-1.5 list-disc pl-4 text-xs leading-5 text-body marker:text-muted">
                                            {item.items.map((line, i) => <li key={i}>{line}</li>)}
                                        </ul>
                                    )}
                                    {item.fix && <Button size="sm" className="mt-2" onClick={() => onFix(item.fix as PreflightFix)}>{FIX_LABEL[item.fix.kind]}</Button>}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
            <details className="group border-t border-line">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-[13px] text-accent sm:px-5 [&::-webkit-details-marker]:hidden">
                    <Icon name="chevron-right" size={16} className="shrink-0 transition-transform group-open:rotate-90" />
                    See all {allChecks.length} checks
                </summary>
                <ul aria-label="Every check" className="border-t border-line">
                    {allChecks.map((check) => (
                        <li key={check.id} className="flex items-start justify-between gap-4 border-t border-line px-4 py-2 text-[13px] first:border-t-0 sm:pl-11 sm:pr-5">
                            <span className="min-w-0 text-ink">{check.title}</span>
                            <span className="shrink-0 text-body">{check.outcome}</span>
                        </li>
                    ))}
                </ul>
            </details>
        </>
    );
}
