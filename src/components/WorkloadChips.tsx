"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Chip } from "@/components/ui/Chip";
import { WorkloadType } from '@/types/workload.types';
import { getEnabledWorkloads, useIncrementalConsent, WORKLOAD_STATE_EVENT } from "@/hooks/useIncrementalConsent";
import { isWorkloadVisible, setWorkloadVisible } from "@/utils/workloadPreferences";

interface ChipConfig {
    id: string;
    name: string;
    type: "workload" | "feature";
    workloadId?: WorkloadType; // For features, indicates parent workload
}

// Chip configuration - maps to Settings workloads/features
// Workload chips act as DATA FILTERS (not just visibility toggles)
// Feature chips (like Security Alerts) toggle specific UI widgets
// In the order of spec 4.1: Directory roles, PIM for Groups, Unmanaged groups, Agents, Security alerts
const CHIP_CONFIG: ChipConfig[] = [
    {
        id: "directoryRoles",
        name: "Directory roles",
        type: "workload"
    },
    {
        id: "pimGroups",
        name: "PIM for Groups",
        type: "workload"
    },
    {
        id: "unmanagedGroups",
        name: "Unmanaged groups",
        type: "feature",
        workloadId: "pimGroups"
    },
    {
        id: "agents",
        name: "Agents",
        type: "feature",
        workloadId: "directoryRoles"
    },
    {
        id: "securityAlerts",
        name: "Security alerts",
        type: "feature",
        workloadId: "directoryRoles"
    }
];

interface WorkloadChipsProps {
    excludedChips?: string[];
    allowIndependentChildToggles?: boolean;
}

export function WorkloadChips({ excludedChips = [], allowIndependentChildToggles = false }: WorkloadChipsProps) {
    const [visibilityStates, setVisibilityStates] = useState<Record<string, boolean>>({});
    const [enabledWorkloads, setEnabledWorkloads] = useState<WorkloadType[]>([]);

    const searchParams = useSearchParams();
    const { requestConsent } = useIncrementalConsent();

    // Load states on mount and on params change
    useEffect(() => {
        const loadStates = () => {
            const enabled = getEnabledWorkloads();
            setEnabledWorkloads(enabled);

            // Check for URL override
            const requestedWorkload = searchParams?.get("workload");
            const visibility: Record<string, boolean> = {};

            if (requestedWorkload && CHIP_CONFIG.some(c => c.id === requestedWorkload)) {
                // URL Override mode: Show requested, hide others
                // CRITIAL: Do NOT update localStorage here (Transient State)
                for (const chip of CHIP_CONFIG) {
                    if (chip.type === "workload") {
                        visibility[chip.id] = chip.id === requestedWorkload;
                    } else {
                        // For features, fallback to storage
                        visibility[chip.id] = isWorkloadVisible(chip.id);
                    }
                }
            } else {
                // Standard mode: Load from persistence
                for (const chip of CHIP_CONFIG) {
                    visibility[chip.id] = isWorkloadVisible(chip.id);
                }
            }

            setVisibilityStates(visibility);
        };

        loadStates();

        // Same-tab changes (Settings page, chips, consent) dispatch WORKLOAD_STATE_EVENT;
        // the native `storage` event covers other tabs. No polling needed.
        const handleStorageChange = () => loadStates();

        window.addEventListener("storage", handleStorageChange);
        window.addEventListener(WORKLOAD_STATE_EVENT, handleStorageChange);

        return () => {
            window.removeEventListener("storage", handleStorageChange);
            window.removeEventListener(WORKLOAD_STATE_EVENT, handleStorageChange);
        };
    }, [searchParams]);

    const toggleVisibility = (chipId: string) => {
        const newVisibility = !visibilityStates[chipId];
        setVisibilityStates(prev => ({ ...prev, [chipId]: newVisibility }));
        setWorkloadVisible(chipId, newVisibility);
    };

    const isChipEnabled = (chip: ChipConfig): boolean => {
        // First check exclusion
        if (excludedChips.includes(chip.id)) return false;

        // Parent dependency check
        if (chip.workloadId) {
            // Find parent
            const parent = CHIP_CONFIG.find(c => c.id === chip.workloadId);
            // If parent exists and is disabled/hidden, child might need to be hidden?
            // Actually, consent logic: if parent workload is NOT consented, feature is hidden
            if (parent && !enabledWorkloads.includes(parent.id as WorkloadType)) return false;

            // Also check current visibility state of parent?
            // User requested: "bij het uitschakelen van de toggle de data... verborgen worden" based on parent?
            // Usually enabling a feature chip is independent, but if PIM for Groups is NOT visible,
            // the Unmanaged Groups toggle shouldn't be visible either.
            // UNLESS allowIndependentChildToggles is true (for Report page)
            if (!allowIndependentChildToggles && visibilityStates[chip.workloadId] === false) return false;
        }

        if (chip.type === "workload") {
            return enabledWorkloads.includes(chip.id as WorkloadType);
        }
        // For features (like securityAlerts, unmanagedGroups), check if enabled in localStorage OR default to true?
        // Let's rely on storage state (defaulting to enabled first time is handled where consent is granted, or we force it here)
        if (typeof window === "undefined") return false;

        // Special case: Unmanaged Groups defaults to true (or handled by storage)
        // Just return true (always available if parent is active) - visibility is controlled by toggle state
        return true;
    };

    // Count active (enabled + consented) workloads (not features)
    const activeWorkloadCount = CHIP_CONFIG.filter(
        chip => chip.type === "workload" && isChipEnabled(chip)
    ).length;

    // A workload chip can only be toggled if there's more than one active workload
    // (can't hide all data sources)
    const canToggleWorkloadChip = (chip: ChipConfig): boolean => {
        if (chip.type === "feature") return true; // Features can always be toggled
        return activeWorkloadCount > 1;
    };

    // Only show chips for enabled (consented) workloads/features
    const visibleChips = CHIP_CONFIG.filter(chip => isChipEnabled(chip));

    // PIM for Groups without consent shows locked; the security alerts feature asks for its own consent where its block sits
    const lockedChips = CHIP_CONFIG.filter(chip => chip.id === "pimGroups" && !excludedChips.includes(chip.id) && !enabledWorkloads.includes("pimGroups"));

    if (visibleChips.length === 0 && lockedChips.length === 0) {
        return null;
    }

    return (
        <div className="flex flex-wrap items-center gap-2" data-tour="workload-chips" role="group" aria-label="Counting">
            <span className="mr-1 font-mono text-xs text-muted max-sm:hidden">counting</span>

            {CHIP_CONFIG.map((chip) => {
                // A workload without consent: dashed chip with a lock, selecting it starts consent (spec 4.1)
                if (lockedChips.includes(chip)) {
                    return <Chip key={chip.id} kind="locked" label={chip.name} onSelect={() => void requestConsent(chip.id as WorkloadType)} />;
                }
                if (!visibleChips.includes(chip)) return null;
                return (
                    <Chip
                        key={chip.id}
                        kind="toggle"
                        label={chip.name}
                        isOn={visibilityStates[chip.id] !== false}
                        isDisabled={!canToggleWorkloadChip(chip)}
                        disabledReason="At least one workload has to count"
                        onToggle={() => toggleVisibility(chip.id)}
                    />
                );
            })}
        </div>
    );
}

// Hook to get visibility state for a specific workload/feature (for use in page components)
export function useWorkloadVisibility(workloadId: string): boolean {
    const searchParams = useSearchParams();
    const [isVisible, setIsVisible] = useState(true);

    useEffect(() => {
        const checkVisibility = () => {
            const requestedWorkload = searchParams?.get("workload");

            // Check if we are in URL Override mode for a VALID workload
            // (Only apply override if the param matches a known workload ID)
            const isOverrideActive = requestedWorkload && CHIP_CONFIG.some(c => c.id === requestedWorkload && c.type === "workload");

            if (isOverrideActive) {
                // If checking a WORKLOAD chip
                const config = CHIP_CONFIG.find(c => c.id === workloadId);
                if (config?.type === "workload") {
                    setIsVisible(workloadId === requestedWorkload);
                    return;
                }
                // If checking a feature, fall through to storage (or decide if features should be hidden?)
                // Current logic: Features stay visible unless parent is hidden?
                // Let's stick to simple: If URL is active, it dictates WORKLOAD visibility.
                // Features: use storage default.
            }

            // Fallback to storage
            setIsVisible(isWorkloadVisible(workloadId));
        };

        checkVisibility();

        // Same-tab updates (Settings page or chips) arrive via WORKLOAD_STATE_EVENT,
        // cross-tab updates via the native `storage` event
        window.addEventListener(WORKLOAD_STATE_EVENT, checkVisibility);
        window.addEventListener("storage", checkVisibility);

        return () => {
            window.removeEventListener(WORKLOAD_STATE_EVENT, checkVisibility);
            window.removeEventListener("storage", checkVisibility);
        };
    }, [workloadId, searchParams]);

    return isVisible;
}
