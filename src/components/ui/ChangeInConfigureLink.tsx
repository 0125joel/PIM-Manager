"use client";

import Link from "next/link";

/** "Change in Configure" (spec 16): opens Edit on this role or group; the caller renders it only when it may show */
export function ChangeInConfigureLink({ href, name }: { href: string; name: string }) {
    return (
        <Link href={href} className="inline-flex h-[30px] shrink-0 items-center gap-1.5 rounded border border-line bg-surface px-2.5 text-[13px] font-medium text-ink hover:bg-page max-sm:h-11">
            Change in Configure
            <span className="sr-only">{`: ${name}`}</span>
        </Link>
    );
}
