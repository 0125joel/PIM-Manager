"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Shield, Users, AlertTriangle, Settings, EyeOff, Eye, ShieldOff } from "lucide-react";
import { WorkloadType } from "@/types/workload";
import { getEnabledWorkloads } from "@/hooks/useIncrementalConsent";
import { isWorkloadVisible, setWorkloadVisible } from "@/components/SettingsModal";

interface ChipConfig {
    id: string;
    name: string;
    icon: React.ReactNode;
    type: "workload" | "feature";
    workloadId?: WorkloadType; // For features, indicates parent workload
}

// Chip configuration - maps to Settings workloads/features
// Workload chips act as DATA FILTERS (not just visibility toggles)
// Feature chips (like Security Alerts) toggle specific UI widgets
const CHIP_CONFIG: ChipConfig[] = [
    {
        id: "directoryRoles",
        name: "Directory roles",
        icon: <Shield className="h-3.5 w-3.5" />,
        type: "workload"
    },
    {
        id: "securityAlerts",
        name: "Security alerts",
        icon: <AlertTriangle className="h-3.5 w-3.5" />,
        type: "feature",
        workloadId: "directoryRoles"
    },
    {
        id: "pimGroups",
        name: "PIM groups",
        icon: <Users className="h-3.5 w-3.5" />,
        type: "workload"
    },
    {
        id: "unmanagedGroups",
        name: "Unmanaged groups",
        icon: <ShieldOff className="h-3.5 w-3.5" />,
        type: "feature",
        workloadId: "pimGroups"
    }
];

interface WorkloadChipsProps {
    onOpenSettings?: () => void;
    excludedChips?: string[];
    allowIndependentChildToggles?: boolean;
}

export function WorkloadChips({ onOpenSettings, excludedChips = [], allowIndependentChildToggles = false }: WorkloadChipsProps) {
    const [visibilityStates, setVisibilityStates] = useState<Record<string, boolean>>({});
    const [enabledWorkloads, setEnabledWorkloads] = useState<WorkloadType[]>([]);

    const searchParams = useSearchParams();

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

        // Listen for storage changes (from Settings modal)
        const handleStorageChange = () => loadStates();

        window.addEventListener("storage", handleStorageChange);
        const interval = setInterval(loadStates, 500);

        return () => {
            window.removeEventListener("storage", handleStorageChange);
            clearInterval(interval);
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
            // Usually enabling a feature chip is independent, but if PIM Groups is NOT visible,
            // the Unmanaged Groups toggle shouldn't be visible either.
            // UNLESS allowIndependentChildToggles is true (for Report page)
            if (!allowIndependentChildToggles && visibilityStates[chip.workloadId] === false) return false;
        }

        if (chip.type === "workload") {
            return enabledWorkloads.includes(chip.id as WorkloadType);
        }
        // For features (like securityAlerts, unmanagedGroups), check if enabled in localStorage OR default to true?
        // Let's rely on storage state (defaulting to enabled first time is handled in SettingsModal logic, or we force it here)
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

    if (visibleChips.length === 0) {
        return null;
    }

    return (
        <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-zinc-500 dark:text-zinc-400 mr-1">View:</span>

            {visibleChips.map((chip) => {
                const isVisible = visibilityStates[chip.id] !== false;
                const canToggle = canToggleWorkloadChip(chip);

                return (
                    <button
                        key={chip.id}
                        onClick={() => canToggle && toggleVisibility(chip.id)}
                        disabled={!canToggle}
                        className={`
                            inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all
                            ${!canToggle
                                ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 cursor-default opacity-80"
                                : isVisible
                                    ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-900/50 cursor-pointer"
                                    : "bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700 cursor-pointer"
                            }
                        `}
                        title={
                            !canToggle
                                ? "Cannot hide - at least one workload must be visible"
                                : isVisible
                                    ? "Click to hide from view"
                                    : "Click to show"
                        }
                    >
                        {chip.icon}
                        <span className={!isVisible && canToggle ? "line-through" : ""}>{chip.name}</span>
                        {canToggle && (
                            isVisible ? (
                                <Eye className="h-3 w-3 ml-0.5 opacity-60" />
                            ) : (
                                <EyeOff className="h-3 w-3 ml-0.5 opacity-60" />
                            )
                        )}
                    </button>
                );
            })}

            {/* Settings button */}
            {onOpenSettings && (
                <button
                    onClick={onOpenSettings}
                    className="inline-flex items-center gap-1 px-2 py-1.5 rounded-full text-xs text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                    title="Manage workloads"
                >
                    <Settings className="h-3.5 w-3.5" />
                </button>
            )}
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

        // Poll for changes (same-tab updates from Settings modal or chips)
        const interval = setInterval(checkVisibility, 300);

        return () => clearInterval(interval);
    }, [workloadId, searchParams]); // Add searchParams dependency

    return isVisible;
}
