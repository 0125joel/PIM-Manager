import { Icon, type IconName } from "@/components/icons/Icon";
import { Tag } from "@/components/ui/Tag";
import type { PreflightFix } from "@/utils/configurePreflight";
import type { ReviewView } from "@/utils/configureReview";
import { CheckList } from "./CheckList";

const VERDICT_ICON: Record<ReviewView["verdict"]["tone"], { icon: IconName; className: string }> = {
    success: { icon: "success", className: "text-success-text" },
    warn: { icon: "alert", className: "text-warn-text" },
    danger: { icon: "error", className: "text-danger-text" },
};

interface VerdictProps {
    view: ReviewView;
    onFix: (fix: PreflightFix) => void;
}

/**
 * The verdict panel of the review (spec 12.1): one sentence with its icon, what was checked and the targets as tags,
 * the items that need attention, and "See all {n} checks" at the bottom.
 */
export function Verdict({ view, onFix }: VerdictProps) {
    const icon = VERDICT_ICON[view.verdict.tone];
    return (
        <section aria-labelledby="review-verdict" className="rounded border border-line bg-surface">
            <div className="flex gap-3 px-4 pt-4 pb-5 sm:px-5">
                <Icon name={icon.icon} size={20} className={`mt-0.5 shrink-0 ${icon.className}`} />
                <div className="min-w-0 flex-1">
                    <h2 id="review-verdict" className="text-base font-semibold text-ink">{view.verdict.sentence}</h2>
                    <p className="mt-1 max-w-[640px] text-[13px] leading-5 text-body">{view.checkedLine}</p>
                    <ul aria-label="Targets" className="mt-2 flex flex-wrap gap-1.5">
                        {view.targetNames.map((name, i) => <li key={i} className="max-w-full"><Tag>{name}</Tag></li>)}
                    </ul>
                </div>
            </div>
            <CheckList attention={view.attention} allChecks={view.allChecks} onFix={onFix} />
        </section>
    );
}
