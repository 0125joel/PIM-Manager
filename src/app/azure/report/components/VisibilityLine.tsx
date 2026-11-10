"use client";

import { StatusBox } from "@/components/ui/StatusBox";
import { ReadRest } from "@/app/azure/components/ReadRest";
import { unreadSentence, type AzureReadability } from "@/utils/azureReadability";

interface VisibilityLineProps {
    className?: string;
    /** What the read budget did not reach yet; the box then says so, with Read the rest */
    readability?: Pick<AzureReadability, "unread" | "unlisted">;
    onReadRest?: () => void;
    isReadingRest?: boolean;
}

/** Says that the report shows only the scopes the user can read, and what is not read yet. */
export function VisibilityLine({ className, readability, onReadRest, isReadingRest = false }: VisibilityLineProps) {
    const hasUnread = readability !== undefined && unreadSentence(readability) !== null;
    const box = (
        <StatusBox variant="warn" title="Partial view." className={hasUnread ? "" : className}>
            You see the scopes you can read. Assignments on other scopes are not shown.
            {readability && <ReadRest readability={readability} onReadRest={onReadRest} isReading={isReadingRest} />}
        </StatusBox>
    );
    // Its own section in the visual check only while something is not read yet
    return hasUnread ? <div data-visual-section="azure-unread" className={className}>{box}</div> : box;
}
