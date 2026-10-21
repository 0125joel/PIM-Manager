"use client";

import { useId, useState, type ReactNode } from "react";
import { Icon } from "@/components/icons/Icon";
import { PLANES, SECURITY_LEVELS, type Plane, type SecurityLevel } from "@/utils/accessModelCatalog";
import type { GroupPlacement } from "@/utils/authContextSlug";
import type { GroupPlacementRow } from "@/utils/accessModelView";
import { toggleChip, type TargetChip, type TargetList as TargetListData, type TargetRow } from "@/utils/configureTargets";
import { TargetList } from "../edit/TargetList";

interface TargetsStepProps {
    workload: "roles" | "groups";
    /** "Roles" or "Groups · Member settings", as chosen in Start */
    chosenLine: string;
    onChangeStart: () => void;
    list: TargetListData;
    chips: ReadonlySet<TargetChip>;
    onChipsChange: (chips: ReadonlySet<TargetChip>) => void;
    query: string;
    onQueryChange: (query: string) => void;
    ticks: ReadonlySet<string>;
    /** The ticked targets that can be changed: what Next and the Settings step use */
    selectedCount: number;
    onTick: (row: TargetRow) => void;
    onTickAll: (ids: readonly string[]) => void;
    /** Loading, no consent, failed, nothing found */
    message?: ReactNode;
    /** The copy source, shown on top and not a target */
    copySource: { name: string } | null;
    /** With the access model and groups: the ticked groups to place (spec 9.4) */
    placements: GroupPlacementRow[] | null;
    onPlace: (groupId: string, placement: GroupPlacement | null) => void;
}

/**
 * Step 2 of Guided (spec 6.2): the list of Edit with the workload chosen in Start, its filters and search, checkboxes
 * and "Select all {m} shown"; the copy source on top; with the access model and groups a plane and level per group.
 */
export function TargetsStep(props: TargetsStepProps) {
    const { list, ticks, workload } = props;
    const noun = workload === "roles" ? "role" : "group";
    const open = [...list.rows, ...list.notUnderPim].filter((r) => r.lock === null);
    const count = props.selectedCount;
    return (
        <div className="flex flex-col gap-4">
            <TargetList
                view={workload}
                onViewChange={() => undefined}
                roleCount={null}
                groupCount={null}
                list={list}
                chips={props.chips}
                onToggleChip={(chip) => props.onChipsChange(toggleChip(props.chips, chip, workload))}
                query={props.query}
                onQueryChange={props.onQueryChange}
                currentId={undefined}
                onSelect={props.onTick}
                message={props.message}
                isSeveral
                onSeveralChange={() => undefined}
                checkedIds={ticks}
                viewControl={
                    <p className="text-[13px] text-body">
                        {`${props.chosenLine}, chosen in Start · `}
                        <button type="button" onClick={props.onChangeStart} className="font-medium text-accent hover:underline max-sm:min-h-11">Change</button>
                    </p>
                }
                severalControl={
                    <p className="text-[13px] text-body" aria-live="polite">
                        {count > 0 ? `${count} ${count === 1 ? noun : `${noun}s`} selected` : "Select one or more"}
                        {open.length > 0 && (
                            <>
                                {" · "}
                                <button type="button" onClick={() => props.onTickAll(open.map((r) => r.id))} className="font-medium text-accent hover:underline max-sm:min-h-11">{`Select all ${open.length} shown`}</button>
                            </>
                        )}
                    </p>
                }
                pinned={props.copySource && (
                    <div className="flex items-start gap-2 border-b border-line bg-page px-3 py-3">
                        <Icon name="copy" size={16} className="mt-0.5 shrink-0 text-muted" />
                        <span className="min-w-0">
                            <span className="block text-[15px] leading-5 font-medium text-ink">{props.copySource.name}</span>
                            <span className="mt-1 block text-[13px] leading-[18px] text-body">Copy source · its settings are copied to the ones you select</span>
                        </span>
                    </div>
                )}
            />
            {props.placements && props.placements.length > 0 && <GroupPlacements rows={props.placements} onPlace={props.onPlace} />}
        </div>
    );
}

/** Per ticked group a plane and a level (spec 9.4): the admin's place, else the proposal from the roles it holds */
function GroupPlacements({ rows, onPlace }: { rows: GroupPlacementRow[]; onPlace: (groupId: string, placement: GroupPlacement | null) => void }) {
    const headId = useId();
    return (
        <section aria-labelledby={headId} className="rounded border border-line bg-surface p-4">
            <h2 id={headId} className="text-[15px] font-semibold text-ink">Place the groups in the access model</h2>
            <p className="mt-1 text-[13px] leading-[18px] text-body">
                Groups have no place in the catalog. A group that holds roles is proposed at the strictest place of those roles; place the others yourself. The place is kept for this tenant.
            </p>
            <ul className="mt-3">
                {rows.map((row) => <PlacementRow key={row.groupId} row={row} onPlace={onPlace} />)}
            </ul>
        </section>
    );
}

function PlacementRow({ row, onPlace }: { row: GroupPlacementRow; onPlace: (groupId: string, placement: GroupPlacement | null) => void }) {
    const shown = row.placement ?? (row.proposal ? { plane: row.proposal.plane, securityLevel: row.proposal.securityLevel } : null);
    // A plane or a level alone waits here until the other is chosen
    const [partial, setPartial] = useState<{ plane?: Plane; securityLevel?: SecurityLevel }>({});
    const plane = shown?.plane ?? partial.plane;
    const level = shown?.securityLevel ?? partial.securityLevel;
    const choose = (next: { plane?: Plane; securityLevel?: SecurityLevel }) => {
        const p = next.plane ?? plane;
        const l = next.securityLevel ?? level;
        if (p && l) {
            setPartial({});
            onPlace(row.groupId, { plane: p, securityLevel: l });
        } else setPartial({ plane: p, securityLevel: l });
    };
    const planeId = useId();
    const levelId = useId();
    const line = row.placement ? "Placed by you" : row.proposal ? `From ${row.proposal.fromRole}` : "Holds no role in the catalog: place it yourself";
    return (
        <li className="flex flex-col gap-2 border-b border-line py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
                <p className="text-[15px] leading-5 font-medium text-ink">{row.name}</p>
                <p className={`mt-0.5 text-[13px] ${shown ? "text-body" : "text-warn-text"}`}>{line}</p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
                <label htmlFor={planeId} className="sr-only">{`Plane of ${row.name}`}</label>
                <select id={planeId} value={plane ?? ""} onChange={(e) => choose({ plane: e.target.value as Plane })} className="h-[34px] rounded border border-line bg-surface px-2 text-sm text-ink max-sm:h-11">
                    {!plane && <option value="">Plane</option>}
                    {PLANES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <label htmlFor={levelId} className="sr-only">{`Level of ${row.name}`}</label>
                <select id={levelId} value={level ?? ""} onChange={(e) => choose({ securityLevel: e.target.value as SecurityLevel })} className="h-[34px] rounded border border-line bg-surface px-2 text-sm text-ink max-sm:h-11">
                    {!level && <option value="">Level</option>}
                    {SECURITY_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
            </div>
        </li>
    );
}
