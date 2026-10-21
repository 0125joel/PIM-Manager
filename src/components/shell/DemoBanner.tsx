"use client";

import { usePathname } from "next/navigation";
import { Icon } from "@/components/icons/Icon";
import { enterDemo, exitDemo } from "@/demo/runtime/session";

/** The strip above the bars in the demo: what this is, start over, leave. */
export function DemoBanner() {
    const pathname = usePathname();
    return (
        <div role="region" aria-label="Demo environment" className="border-b border-line bg-accent-tint text-ink">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-[13px] leading-[18px] sm:px-6 lg:px-8">
                <span className="inline-flex items-center gap-2 font-semibold text-accent">
                    <Icon name="info" size={16} />
                    Demo environment
                </span>
                <span className="order-last w-full text-body sm:order-none sm:w-auto sm:min-w-0 sm:flex-1">
                    Contoso is a made-up tenant. Nothing is read from or sent to Microsoft, and changes are not saved.
                </span>
                <span className="ml-auto flex items-center gap-3 sm:ml-0">
                    <button type="button" onClick={() => enterDemo(pathname ?? "/dashboard")} className="min-h-6 cursor-pointer text-accent underline underline-offset-2 max-sm:min-h-11">
                        Start over
                    </button>
                    <button type="button" onClick={() => exitDemo("/")} className="min-h-6 cursor-pointer font-medium text-accent underline underline-offset-2 max-sm:min-h-11">
                        Exit demo
                    </button>
                </span>
            </div>
        </div>
    );
}
