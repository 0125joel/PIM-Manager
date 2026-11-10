"use client";

import { unreadSentence, type AzureReadability } from "@/utils/azureReadability";

export interface ReadRestProps {
    readability: Pick<AzureReadability, "unread" | "unlisted">;
    /** Starts one more round over what is not read yet; without it only the sentence shows */
    onReadRest?: () => void;
    /** A round is going (Read the rest, or the load itself) */
    isReading?: boolean;
}

/**
 * What the read budget did not reach yet and its Read the rest button, inline in a line of text (the readability line,
 * Partial view, the dashboard note). Nothing when everything readable was read.
 */
export function ReadRest({ readability, onReadRest, isReading = false }: ReadRestProps) {
    const sentence = unreadSentence(readability);
    if (sentence === null) return null;
    return (
        <>
            {" "}
            {sentence}
            {onReadRest && (
                <>
                    {" "}
                    <button type="button" onClick={onReadRest} disabled={isReading} className="inline-flex min-h-6 items-center text-accent underline underline-offset-2 disabled:cursor-default disabled:text-muted disabled:no-underline max-sm:flex max-sm:min-h-11">
                        {isReading ? "Reading the rest..." : "Read the rest"}
                    </button>
                </>
            )}
        </>
    );
}
