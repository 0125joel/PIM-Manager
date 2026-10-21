import type { ReactNode } from "react";

/** One section of the settings page: a rule, the title, a short subline (spec 3.6). Anchored for the index. */
export function SettingsSection({ id, title, subline, children }: { id: string; title: string; subline: ReactNode; children: ReactNode }) {
    return (
        <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20 border-t border-line pt-5">
            <h2 id={`${id}-title`} className="text-lg leading-6 font-semibold text-ink sm:text-xl sm:leading-[26px]">
                {title}
            </h2>
            <p className="mt-1 max-w-[720px] text-[13px] leading-[18px] text-muted">{subline}</p>
            <div className="mt-5">{children}</div>
        </section>
    );
}
