"use client";

import { StatCard } from "@/components/ui/StatCard";
import type { DashboardFilter } from "@/types/dashboardFilter.types";
import { CARD_FILTERS, isSameFilter, type CardId, type CardStat } from "@/utils/dashboardStats";

interface CardDefinition {
    id: CardId;
    label: string;
}

const CARDS: CardDefinition[] = [
    { id: "rolesAndGroups", label: "Roles and groups" },
    { id: "activeNow", label: "Active now" },
    { id: "permanent", label: "Permanent" },
    { id: "eligible", label: "Eligible" },
    { id: "privileged", label: "Privileged roles" },
    { id: "requireApproval", label: "Require approval" },
    { id: "customRoles", label: "Custom roles" },
    { id: "groupsUnderPim", label: "Groups under PIM" },
];

interface CardGridProps {
    stats: Record<CardId, CardStat> | null;
    filter: DashboardFilter;
    /** Blocks the filter does not apply to are dimmed (spec 4.6): the groups under PIM card */
    isGroupsDimmed: boolean;
    onSetFilter: (filter: DashboardFilter) => void;
}

/** The eight cards, 4 by 2 from 1024 up, 2 columns below (spec 1.4 and 4.4). Card 1 and card 8 do not filter. */
export function CardGrid({ stats, filter, isGroupsDimmed, onSetFilter }: CardGridProps) {
    return (
        <ul className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4" aria-label="Key numbers">
            {CARDS.map((card) => {
                const stat = stats?.[card.id];
                const target = CARD_FILTERS[card.id];
                const isPressed = target !== undefined && isSameFilter(filter, target);
                return (
                    <li key={card.id} className="min-w-0">
                        <StatCard
                            label={card.label}
                            value={stat ? stat.value : null}
                            breakdown={stat?.breakdown ?? ""}
                            isWarning={stat?.isWarning ?? false}
                            isPressed={isPressed}
                            isDimmed={card.id === "groupsUnderPim" && isGroupsDimmed}
                            onSelect={target && stat?.value !== null && stat?.value !== "-" ? () => onSetFilter(isPressed ? {} : target) : undefined}
                        />
                    </li>
                );
            })}
        </ul>
    );
}
