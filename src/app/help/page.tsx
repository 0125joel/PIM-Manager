"use client";

import { HELP_PAGES } from "@/config/help";
import { PAGE_TITLE_CLASS, PANEL_CLASS } from "@/components/ui/SectionHeader";
import { requestTourRestart } from "@/hooks/useOnboarding";
import { Button } from "@/components/ui/Button";
import { loginRequest } from "@/config/authConfig";
import { ALERTS_PERMISSION, CONDITIONAL_ACCESS_PERMISSION, CUSTOM_EXTENSION_SCOPES } from "@/config/constants";
import { WORKLOAD_SCOPES, WORKLOAD_WRITE_SCOPES } from "@/hooks/useIncrementalConsent";
import { buildPermissionCatalog } from "@/utils/permissionCatalog";

// Built from the scopes the app really requests, so the list cannot fall behind the code
const PERMISSIONS = buildPermissionCatalog({
    signIn: loginRequest.scopes,
    optional: [
        { feature: "PIM for Groups", scopes: WORKLOAD_SCOPES.pimGroups },
        { feature: "Security alerts", scopes: [ALERTS_PERMISSION] },
        { feature: "Custom extensions", scopes: [CUSTOM_EXTENSION_SCOPES.read] },
        { feature: "Conditional Access check", scopes: [CONDITIONAL_ACCESS_PERMISSION] },
    ],
    write: [
        { workload: "Directory roles", scopes: WORKLOAD_WRITE_SCOPES.directoryRoles },
        { workload: "PIM for Groups", scopes: WORKLOAD_WRITE_SCOPES.pimGroups },
    ],
});

const NAVIGATION = [
    ["Dashboard", "who has privileged access and on which terms"],
    ["Report", "every role and group with its assignments and policy"],
    ["Configure", "change policies and assignments with Edit, Guided or Import, after a review"],
    ["Settings", "permissions, display and emergency access accounts"],
];

function Panel({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: string; children: React.ReactNode }) {
    return (
        <section id={id} aria-labelledby={`${id}-heading`} className={`${PANEL_CLASS} scroll-mt-20`}>
            <p aria-hidden="true" className="font-mono text-xs text-accent">{eyebrow}</p>
            <h2 id={`${id}-heading`} className="text-lg leading-6 font-semibold text-ink sm:text-xl sm:leading-[26px]">{title}</h2>
            <div className="mt-4 flex flex-col gap-5">{children}</div>
        </section>
    );
}

function Sub({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="border-t border-line pt-4">
            <h3 className="text-[13px] leading-5 font-semibold text-ink">{title}</h3>
            <div className="mt-1 flex flex-col gap-2 text-sm leading-6 text-body">{children}</div>
        </div>
    );
}

/** The full guide: the long version of the help panel, one panel per page, readable with the browser's find. */
export default function HelpPage() {
    return (
        <div className="mx-auto flex max-w-[1100px] flex-col gap-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className={PAGE_TITLE_CLASS}>Guide</h1>
                    <p className="text-sm text-muted">How PIM Manager works, page by page.</p>
                </div>
                <Button onClick={requestTourRestart}>Start the tour</Button>
            </div>

            <nav aria-label="On this page" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <a className="text-accent underline" href="#start">Getting started</a>
                {HELP_PAGES.map((p) => <a key={p.id} className="text-accent underline" href={`#${p.id}`}>{p.title}</a>)}
            </nav>

            <Panel id="start" eyebrow="start" title="Getting started">
                <p className="text-sm leading-6 text-body">PIM Manager runs in your browser. Every call to Microsoft Graph uses your own sign-in, and data never leaves your session. Reading needs read permissions; writing asks for write permissions the first time you change something.</p>
                <Sub title="Pages">
                    <ul className="flex flex-col gap-1">
                        {NAVIGATION.map(([name, text]) => <li key={name}><span className="font-semibold text-ink">{name}</span> {text}</li>)}
                    </ul>
                </Sub>
                {PERMISSIONS.map((group) => (
                    <Sub key={group.id} title={group.title}>
                        <ul className="flex flex-col gap-1">
                            {group.items.map((item) => (
                                <li key={`${group.id}-${item.scope}`}><code className="font-mono text-xs text-ink">{item.scope}</code> for {item.purpose}</li>
                            ))}
                        </ul>
                        <p>{group.note}</p>
                    </Sub>
                ))}
            </Panel>

            {HELP_PAGES.map((page) => (
                <Panel key={page.id} id={page.id} eyebrow={page.id} title={page.title}>
                    <p className="text-sm leading-6 text-body">{page.intro}</p>
                    {page.guide.map((section) => (
                        <Sub key={section.title} title={section.title}>
                            {section.paragraphs?.map((text) => <p key={text}>{text}</p>)}
                            {section.items && (
                                <ul className="flex flex-col gap-1">
                                    {section.items.map((item) => <li key={item.label}><span className="font-semibold text-ink">{item.label}</span> {item.text}</li>)}
                                </ul>
                            )}
                        </Sub>
                    ))}
                    <Sub title="Terms">
                        <dl className="flex flex-col gap-1">
                            {page.terms.map((t) => (
                                <div key={t.term}>
                                    <dt className="inline font-semibold text-ink">{t.term} </dt>
                                    <dd className="inline">{t.text}</dd>
                                </div>
                            ))}
                        </dl>
                    </Sub>
                </Panel>
            ))}
        </div>
    );
}
