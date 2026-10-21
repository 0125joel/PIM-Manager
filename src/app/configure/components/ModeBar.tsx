import { Icon } from "@/components/icons/Icon";
import type { ConfigureMode, ConfigureStep } from "@/utils/configureUrlState";
import { MODES, type ModeInfo } from "./modes";

const MODEL_BAR: ModeInfo = { name: "Access model", icon: "layers", tile: "bg-band text-body", bar: "border-line bg-band", text: "text-body" };

interface ModeBarProps {
    mode: ConfigureMode;
    step: ConfigureStep | null;
    changeCount: number;
    onLeave: () => void;
    /** Guided: "Step {k} of 5: {name}" instead of the changes waiting */
    stepLabel?: string;
}

/**
 * The mode bar under the top bar (spec 5.1): sticky, full width over the padding of `main`, the mode icon tile, the mode
 * name and the step or "· {n} changes waiting" (from 640 up), right "Leave {mode}". The access model has no mode colour: a neutral band with its own mark.
 */
export function ModeBar({ mode, step, changeCount, onLeave, stepLabel }: ModeBarProps) {
    // The access model has no mode colour, but it has its mark: a neutral bar with the layers icon (render access-model)
    const info = mode === "model" ? MODEL_BAR : MODES[mode];
    const name = info.name;
    const after = step === "review" ? "Review" : step === "result" ? "Result" : mode === "model" ? "Reference" : stepLabel ? stepLabel : changeCount > 0 ? `${changeCount} ${changeCount === 1 ? "change" : "changes"} waiting` : null;
    return (
        <div className={`sticky top-14 z-20 -mx-4 -mt-6 mb-6 flex items-center gap-3 border-b-2 px-4 py-2.5 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 ${info.bar}`}>
            <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded bg-surface ${info.text}`}><Icon name={info.icon} size={16} /></span>
            <p className="min-w-0 truncate text-sm">
                <span className="font-semibold text-ink">{name}</span>
                {after && <span className={`text-body ${step ? "" : "max-sm:hidden"}`}> · {after}</span>}
            </p>
            <button type="button" onClick={onLeave} className="ml-auto inline-flex h-[30px] shrink-0 items-center rounded border border-line bg-surface px-2.5 text-[13px] text-ink hover:bg-page max-sm:h-11">
                Leave<span className="ml-1 max-sm:hidden">{mode === "model" ? "the access model" : name}</span>
            </button>
        </div>
    );
}
