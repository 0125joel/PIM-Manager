import { Icon } from "@/components/icons/Icon";
import { GUIDED_STEPS, type GuidedStep, type StepItem } from "@/utils/guidedRoute";

interface StepsBarProps {
    steps: StepItem[];
    current: GuidedStep;
    onOpen: (step: GuidedStep) => void;
}

/**
 * The steps of Guided (spec 6): number, name and a muted line ("Skipped" for a skipped step), the current one
 * underlined in the Guided colour, done ones with a check and open again on a click; later and skipped steps are
 * disabled. Below 640 one line "Step {k} of 5: {name}".
 */
export function StepsBar({ steps, current, onOpen }: StepsBarProps) {
    const name = GUIDED_STEPS.find((s) => s.step === current)?.name ?? "";
    return (
        <>
            <nav aria-label="Steps" className="mb-4 max-sm:hidden">
                <ol className="grid grid-cols-5 overflow-hidden rounded border border-line bg-surface">
                    {steps.map((s) => {
                        const isDone = s.status === "done";
                        const isCurrent = s.status === "current";
                        return (
                            <li key={s.step} className="min-w-0 border-l border-line first:border-l-0">
                                <button
                                    type="button"
                                    onClick={() => onOpen(s.step)}
                                    disabled={!isDone}
                                    aria-current={isCurrent ? "step" : undefined}
                                    className={`flex h-full w-full flex-col items-start px-3 pt-3 pb-2.5 text-left lg:px-3.5 ${isCurrent ? "shadow-[inset_0_-3px_0_var(--mode-guided)]" : ""} ${isDone ? "hover:bg-page" : ""} disabled:cursor-default`}
                                >
                                    <span className={`flex items-center gap-1.5 text-[13px] font-semibold ${s.status === "upcoming" || s.status === "skipped" ? "text-body" : "text-ink"}`}>
                                        {isDone && <Icon name="check" size={16} className="-my-0.5 text-muted" />}
                                        <span className="truncate">{`${s.step}. ${s.name}`}</span>
                                        {isDone && <span className="sr-only">, done</span>}
                                    </span>
                                    <span className="mt-0.5 truncate text-xs text-muted max-w-full">{s.line}</span>
                                </button>
                            </li>
                        );
                    })}
                </ol>
            </nav>
            <p className="mb-4 text-sm text-body sm:hidden">
                {`Step ${current} of ${GUIDED_STEPS.length}: `}
                <span className="font-semibold text-ink">{name}</span>
            </p>
        </>
    );
}
