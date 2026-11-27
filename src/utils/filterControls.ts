/**
 * What the filter panels and chips of the Report, Azure and Audit share. Pure. A control writes one key of its page's filter
 * state, and a chip removes that key; the state, its URL and the matching stay with each page.
 */
export interface FilterControlOption {
    value: string;
    label: string;
}

export interface FilterControlBase<K extends string = string, G extends string = string> {
    /** The key of the page's filter this control writes */
    key: K;
    label: string;
    group: G;
    /** The value shown when the filter is off */
    neutral: string;
    options: FilterControlOption[];
}

/** One active filter: the key it removes and its text; a key of the other view carries a muted suffix */
export interface FilterChip<K extends string> {
    key: K;
    label: string;
    suffix?: string;
}

/** The controls per group, in order of first appearance */
export function groupFilterControls<C extends { group: string }>(controls: readonly C[]): { group: C["group"]; controls: C[] }[] {
    const groups: { group: C["group"]; controls: C[] }[] = [];
    for (const control of controls) {
        const existing = groups.find((g) => g.group === control.group);
        if (existing) existing.controls.push(control);
        else groups.push({ group: control.group, controls: [control] });
    }
    return groups;
}

/** The `key:value` pairs of an `f` parameter, decoded when it came encoded; what each key may hold is for the page */
export function parseFilterPairs(raw: string | null | undefined): { key: string; value: string }[] {
    if (!raw) return [];
    let text = raw.trim();
    if (text.includes("%")) {
        try {
            text = decodeURIComponent(text);
        } catch {
            // keep the text as it came
        }
    }
    const pairs: { key: string; value: string }[] = [];
    for (const pair of text.split(",")) {
        const separator = pair.indexOf(":");
        if (separator < 1) continue;
        pairs.push({ key: pair.slice(0, separator).trim(), value: pair.slice(separator + 1).trim() });
    }
    return pairs;
}
