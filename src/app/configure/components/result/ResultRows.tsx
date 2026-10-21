import { Icon, type IconName } from "@/components/icons/Icon";
import type { ResultRow } from "@/utils/configureResult";

const TONE: Record<ResultRow["tone"], { icon: IconName; className: string; label: string }> = {
    waiting: { icon: "clock", className: "text-muted", label: "Waiting" },
    writing: { icon: "spinner", className: "animate-spin text-accent motion-reduce:animate-none", label: "Writing" },
    done: { icon: "success", className: "text-ink", label: "Done" },
    skipped: { icon: "success", className: "text-body", label: "Skipped" },
    failed: { icon: "error", className: "text-danger-text", label: "Not written" },
};

/** One row per change (spec 13.2, 14.1): status icon, title, the line under it, the state right in mono; failed rows tinted */
export function ResultRows({ rows, label }: { rows: readonly ResultRow[]; label: string }) {
    return (
        <ul aria-label={label}>
            {rows.map((row) => {
                const tone = TONE[row.tone];
                return (
                    <li key={row.changeId} className={`flex items-start gap-3 border-t border-line px-4 py-3 first:border-t-0 ${row.tone === "failed" ? "bg-danger-tint" : ""}`}>
                        <Icon name={tone.icon} size={16} className={`mt-0.5 shrink-0 ${tone.className}`} />
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-ink">{row.title}</p>
                            {row.line && <p className="mt-0.5 text-xs leading-5 text-body">{row.line}</p>}
                        </div>
                        <span className="shrink-0 font-mono text-xs text-body">{row.label}</span>
                    </li>
                );
            })}
        </ul>
    );
}
