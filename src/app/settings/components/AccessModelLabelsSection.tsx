"use client";

import type { AccessModelLabelsProps } from "./settingsTypes";
import { SettingsSection } from "./SettingsSection";

/**
 * The access model labels (spec 9.3, C2-02): which authentication context of the tenant stands for each label of the
 * PIM Monitor catalog. Configure asks once and keeps the choice per tenant; here it can be changed or cleared. A label
 * whose context name matches its slug needs no choice and says so.
 */
export function AccessModelLabelsSection({ tenantLabel, labels, contexts, onChoose }: AccessModelLabelsProps) {
    return (
        <SettingsSection
            id="access-model"
            title="Access model labels"
            subline={`Which authentication context${tenantLabel ? ` in ${tenantLabel}` : ""} stands for each label of the PIM Monitor access model. Configure uses it for Guided and Import; nothing is written to the tenant.`}
        >
            {labels.length === 0 ? (
                <p className="text-[13px] text-body">The catalog has no labels to choose for.</p>
            ) : contexts.length === 0 ? (
                <p className="text-[13px] text-body">No authentication contexts are loaded for this tenant yet. Open the Dashboard or Configure first.</p>
            ) : (
                <ul className="divide-y divide-line border-y border-line">
                    {labels.map((label) => {
                        const id = `access-model-label-${label.slug}`;
                        return (
                            <li key={label.slug} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3">
                                <div className="min-w-0">
                                    <label htmlFor={id} className="block text-sm font-medium text-ink">{label.name}</label>
                                    <span className="font-mono text-xs text-muted">{label.slug}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <select
                                        id={id}
                                        value={label.contextId ?? ""}
                                        onChange={(event) => onChoose(label.slug, event.target.value || null)}
                                        className="h-[34px] min-w-[220px] rounded-md border border-line bg-surface px-3 text-[13px] text-ink max-sm:h-11"
                                    >
                                        <option value="">{label.matchedByName ? `By name: ${label.matchedByName}` : "Not chosen"}</option>
                                        {contexts.map((c) => <option key={c.id} value={c.id}>{c.displayName}</option>)}
                                    </select>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </SettingsSection>
    );
}
