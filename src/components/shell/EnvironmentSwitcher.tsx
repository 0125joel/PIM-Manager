"use client";

import { SegmentedControl } from "@/components/ui/SegmentedControl";

export type Environment = "entra" | "azure";

/** Spec 17: Azure resources are not there yet; the reason is the same sentence in the tooltip and in the menu line */
export const AZURE_LATER_REASON = "Azure resources come in a later version of PIM Manager.";

const OPTIONS = [
    { value: "entra" as const, label: "Entra ID" },
    { value: "azure" as const, label: "Azure", isDisabled: true, disabledReason: AZURE_LATER_REASON },
];

const noChange = () => undefined;

/**
 * The environment switcher "Entra ID | Azure" (spec 17, NG-61). It has no state yet: Entra ID is the only environment,
 * Azure is disabled with its reason. `bar` sits in the top bar from 640 up; `menu` is the row of the account sheet
 * below 640, inside role="menu", with the reason as a line (a tooltip does not work on touch).
 */
export function EnvironmentSwitcher({ variant }: { variant: "bar" | "menu" }) {
    if (variant === "bar") {
        return (
            <div className="w-[160px] shrink-0 md:w-[176px]">
                <SegmentedControl variant="radiogroup" ariaLabel="Environment" options={OPTIONS} value="entra" onChange={noChange} />
            </div>
        );
    }
    return (
        <>
            <SegmentedControl variant="menu" ariaLabel="Environment" options={OPTIONS} value="entra" onChange={noChange} showReasonTooltip={false} />
            <p aria-hidden="true" className="px-2 pt-1.5 text-xs text-muted">{AZURE_LATER_REASON}</p>
        </>
    );
}
