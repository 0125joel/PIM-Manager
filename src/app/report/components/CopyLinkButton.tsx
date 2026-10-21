"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";

interface CopyLinkButtonProps {
    /** The URL to copy, read when the button is pressed (the shown selection made explicit) */
    getUrl: () => string;
}

/** "Copy link" of the detail head (spec 2.3): copies the current URL and says so for a moment. */
export function CopyLinkButton({ getUrl }: CopyLinkButtonProps) {
    const [isCopied, setIsCopied] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => () => {
        if (timer.current) clearTimeout(timer.current);
    }, []);

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(getUrl());
            setIsCopied(true);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => setIsCopied(false), 2000);
        } catch {
            // Clipboard blocked: the address bar still holds the link
        }
    };

    return (
        <>
            <Button size="sm" onClick={copy}>{isCopied ? "Link copied" : "Copy link"}</Button>
            <span role="status" className="sr-only">{isCopied ? "Link copied" : ""}</span>
        </>
    );
}
