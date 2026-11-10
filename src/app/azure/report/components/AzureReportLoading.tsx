"use client";

import { ProgressLine } from "@/components/ui/ProgressLine";
import { Skeleton } from "@/components/ui/Skeleton";

interface AzureReportLoadingProps {
    message: string;
    percent: number | null;
}

/** The loading state: the progress line, the message and a skeleton of the tree and the rows */
export function AzureReportLoading({ message, percent }: AzureReportLoadingProps) {
    return (
        <div data-visual-section="azure-loading">
            <ProgressLine value={percent} label={message} />
            <p className="mt-2 text-[13px] leading-[18px] text-body">{message}</p>
            <div className="mt-4 grid items-start gap-4 lg:grid-cols-[272px_minmax(0,1fr)]" aria-busy="true">
                <div className="flex flex-col gap-2 rounded border border-line bg-surface p-3 max-lg:hidden">
                    {Array.from({ length: 6 }, (_, i) => (
                        <Skeleton key={i} className="block" width="100%" height={20} />
                    ))}
                </div>
                <div className="flex flex-col gap-2">
                    {Array.from({ length: 6 }, (_, i) => (
                        <Skeleton key={i} className="block" width="100%" height={44} />
                    ))}
                </div>
            </div>
        </div>
    );
}
