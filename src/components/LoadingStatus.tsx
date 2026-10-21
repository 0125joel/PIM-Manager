"use client";

import { Icon } from "@/components/icons/Icon";
import { useLoadingSnapshot } from "@/hooks/useLoadingSnapshot";
import { buildLoadingSentence } from "@/utils/loadingStatus";

/**
 * The one status sentence for background loading, next to the page's refresh button (spec 4.7).
 * It carries the only spinner of the page that is not inside a pressed button.
 */
export function LoadingStatus({ subject = "numbers" }: { subject?: "numbers" | "settings" }) {
    const sentence = buildLoadingSentence(useLoadingSnapshot(), subject);
    return sentence === null ? null : <LoadingSentence sentence={sentence} />;
}

export function LoadingSentence({ sentence }: { sentence: string }) {
    return (
        <p className="flex items-center gap-2 text-[13px] leading-[18px] text-body">
            <Icon name="spinner" size={16} />
            <span>{sentence}</span>
        </p>
    );
}
