import type { ReactNode } from "react";

interface ConfigureHeadProps {
    title: string;
    subtitle: string;
    /** Right of the head: Refresh, and in a mode its own actions */
    actions?: ReactNode;
}

/** The head of the start page and of every mode (spec 4, 5.1): title, one line, actions right */
export function ConfigureHead({ title, subtitle, actions }: ConfigureHeadProps) {
    return (
        <div className="mb-5 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
            <div className="min-w-0">
                <h1 id="configure-title" tabIndex={-1} className="text-2xl font-semibold text-ink focus:outline-none">{title}</h1>
                <p className="mt-1 text-sm text-body">{subtitle}</p>
            </div>
            {actions && <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
    );
}
