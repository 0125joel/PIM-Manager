"use client";

import { ScopeInfo, ScopeType } from "@/types/directoryRole.types";
import { getScopeDisplayName, getScopeColorClass } from "@/utils/scopeUtils";
import { Globe, AppWindow, Building2, ShieldAlert, Box } from "lucide-react";

interface ScopeBadgeProps {
    scopeInfo: ScopeInfo;
    size?: "sm" | "md" | "lg";
    showIcon?: boolean;
}

/**
 * Reusable badge component for displaying scope information
 * Supports different sizes and optional icon display
 */
export function ScopeBadge({ scopeInfo, size = "sm", showIcon = false }: ScopeBadgeProps) {
    const sizeClasses = {
        sm: "text-xs px-2 py-0.5",
        md: "text-sm px-2.5 py-1",
        lg: "text-base px-3 py-1.5"
    };

    const iconSize = {
        sm: "h-3 w-3",
        md: "h-4 w-4",
        lg: "h-5 w-5"
    };

    const Icon = getScopeIcon(scopeInfo.type);

    return (
        <span
            className={`inline-flex items-center gap-1 rounded font-medium ${sizeClasses[size]} ${getScopeColorClass(scopeInfo.type)}`}
            title={scopeInfo.displayName}
        >
            {showIcon && Icon && <Icon className={iconSize[size]} />}
            {getScopeDisplayName(scopeInfo)}
        </span>
    );
}

/**
 * Returns the appropriate icon for a scope type
 */
function getScopeIcon(scopeType: ScopeType) {
    switch (scopeType) {
        case "tenant-wide":
            return Globe;
        case "application":
            return AppWindow;
        case "administrative-unit":
            return Building2;
        case "rmau":
            return ShieldAlert;
        case "specific-object":
            return Box;
        default:
            return null;
    }
}

/**
 * Compact scope indicator for tight spaces (just icon + short label)
 */
export function ScopeIndicator({ scopeInfo }: { scopeInfo: ScopeInfo }) {
    const Icon = getScopeIcon(scopeInfo.type);
    const shortLabel = getShortLabel(scopeInfo.type);

    return (
        <span
            className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded ${getScopeColorClass(scopeInfo.type)}`}
            title={getScopeDisplayName(scopeInfo)}
        >
            {Icon && <Icon className="h-3 w-3" />}
            <span className="hidden sm:inline">{shortLabel}</span>
        </span>
    );
}

function getShortLabel(scopeType: ScopeType): string {
    switch (scopeType) {
        case "tenant-wide":
            return "Tenant";
        case "application":
            return "App";
        case "administrative-unit":
            return "AU";
        case "rmau":
            return "RMAU";
        case "specific-object":
            return "Object";
        default:
            return "?";
    }
}
