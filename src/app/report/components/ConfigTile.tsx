"use client";

import { Skeleton } from "@/components/ui/Skeleton";
import { Tag } from "@/components/ui/Tag";
import { requestOpenHelp } from "@/utils/helpEvents";
import { REPORT_TERMS } from "@/config/help/reportTerms";
import type { PolicyTile } from "@/utils/policyView";

interface ConfigTileProps {
    /** null: the settings are still arriving or could not be read; the tile keeps its place with a placeholder */
    tile: PolicyTile | null;
    /** Label when `tile` is null */
    placeholder?: { label: string };
    /** "loading" shows a skeleton value, "failed" says Not loaded */
    state?: "loading" | "failed";
}

/** One setting of a policy: the label in muted, the value in ink (spec 3.3). No icon: the label says it. */
export function ConfigTile({ tile, placeholder, state = "loading" }: ConfigTileProps) {
    const label = tile?.label ?? placeholder?.label ?? "";
    return (
        <div className={`rounded border border-line bg-surface px-3 py-2.5 ${tile?.isFullWidth ? "sm:col-span-2" : ""}`}>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] leading-[18px] text-muted">
                <span>{label}</span>
                {tile?.isPreview && <Tag variant="band" tip={REPORT_TERMS.preview.text} onClick={() => requestOpenHelp({ term: REPORT_TERMS.preview.label })}>Preview</Tag>}
            </p>
            {tile === null ? (
                state === "loading" ? <Skeleton className="mt-1 block" width={120} height={16} /> : <p className="mt-0.5 text-[15px] leading-5 text-muted">Not loaded</p>
            ) : tile.lines.length > 1 || tile.lines[0]?.label ? (
                <dl className="mt-1 flex flex-col gap-0.5">
                    {tile.lines.map((line, index) => (
                        <div key={index} className="flex gap-2 text-[14px] leading-5">
                            {line.label && <dt className="w-20 shrink-0 text-muted">{line.label}</dt>}
                            <dd className={`${line.isId ? "font-mono text-[13px]" : ""} text-ink`}>{line.text}</dd>
                        </div>
                    ))}
                </dl>
            ) : (
                <p className={`mt-0.5 text-[15px] leading-5 ${tile.isDanger ? "text-danger-text" : "text-ink"} ${tile.lines[0]?.isId ? "font-mono text-[13px]" : ""}`}>{tile.lines[0]?.text}</p>
            )}
        </div>
    );
}
