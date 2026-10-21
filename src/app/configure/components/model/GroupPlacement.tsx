"use client";

import { useState } from "react";
import { PLANES, SECURITY_LEVELS, type Plane, type SecurityLevel } from "@/utils/accessModelCatalog";
import type { GroupPlacementRow } from "@/utils/accessModelView";
import type { GroupPlacement as Placement } from "@/utils/authContextSlug";

interface GroupPlacementProps {
    rows: readonly GroupPlacementRow[];
    onPlace: (groupId: string, placement: Placement | null) => void;
}

/** A long list of groups folds */
const FOLD = 12;

const SELECT = "h-[34px] rounded border border-line bg-surface px-2 text-[13px] text-ink max-sm:h-11";


/**
 * One group: the place chosen so far is kept in the row until both the plane and the level are set (a pick of one of the
 * two must not vanish), then it is saved. A saved place can go back to the proposal (or be cleared).
 */
function PlacementRow({ row, onPlace }: { row: GroupPlacementRow; onPlace: (groupId: string, placement: Placement | null) => void }) {
    const saved = row.placement ?? (row.proposal ? { plane: row.proposal.plane, securityLevel: row.proposal.securityLevel } : null);
    const [draft, setDraft] = useState<{ plane: Plane | ""; level: SecurityLevel | "" } | null>(null);
    const plane = draft?.plane ?? saved?.plane ?? "";
    const level = draft?.level ?? saved?.securityLevel ?? "";
    const choose = (nextPlane: Plane | "", nextLevel: SecurityLevel | "") => {
        setDraft({ plane: nextPlane, level: nextLevel });
        if (nextPlane && nextLevel) {
            onPlace(row.groupId, { plane: nextPlane, securityLevel: nextLevel });
            setDraft(null);
        }
    };
    return (
        <li className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line py-3 last:border-b-0">
            <span className="min-w-0 flex-1 basis-48">
                <span className="block text-sm font-semibold text-ink">{row.name}</span>
                <span className="block text-xs text-muted">
                    {row.placement ? "Placed by you" : row.proposal ? `From ${row.proposal.fromRole}` : "No roles in the catalog: choose a place"}
                </span>
            </span>
            <select aria-label={`${row.name} plane`} className={SELECT} value={plane} onChange={(e) => choose(e.target.value as Plane | "", level)}>
                <option value="">Choose</option>
                {PLANES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <select aria-label={`${row.name} level`} className={SELECT} value={level} onChange={(e) => choose(plane, e.target.value as SecurityLevel | "")}>
                <option value="">Choose</option>
                {SECURITY_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
            {(row.placement || draft) && (
                <button
                    type="button"
                    onClick={() => { setDraft(null); onPlace(row.groupId, null); }}
                    className="rounded text-xs text-accent underline underline-offset-2 hover:no-underline max-sm:min-h-11"
                >
                    {row.proposal ? "Use the proposal" : "Clear the place"}
                    <span className="sr-only">{` for ${row.name}`}</span>
                </button>
            )}
        </li>
    );
}

/** "Groups" (spec 8, 9.4): where each group sits in the access model; the place is kept per tenant for Guided */
export function GroupPlacement({ rows, onPlace }: GroupPlacementProps) {
    const [isUnfolded, setIsUnfolded] = useState(false);
    const visible = isUnfolded ? rows : rows.slice(0, FOLD);
    return (
        <section aria-labelledby="model-groups-title" className="rounded border border-line bg-surface p-4 sm:p-5">
            <h2 id="model-groups-title" className="text-base font-semibold text-ink">Groups</h2>
            <p className="mt-2 text-[13px] text-body">A group is placed by what it can do: a group that holds Entra roles is proposed at the strictest place of those roles. Choose the place of every other group; Guided uses it for the access model.</p>
            {rows.length === 0 ? (
                <p className="mt-3 text-[13px] text-body">No groups are loaded yet.</p>
            ) : (
                <ul className="mt-3 border-t border-line">
                    {visible.map((row) => <PlacementRow key={row.groupId} row={row} onPlace={onPlace} />)}
                </ul>
            )}
            {!isUnfolded && rows.length > FOLD && (
                <button type="button" onClick={() => setIsUnfolded(true)} className="mt-2 rounded text-xs text-accent underline underline-offset-2 hover:no-underline max-sm:min-h-11">{`Show all ${rows.length} groups`}</button>
            )}
        </section>
    );
}
