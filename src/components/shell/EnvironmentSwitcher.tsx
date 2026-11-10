"use client";

import { useRouter } from "next/navigation";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { navigateGuarded } from "@/utils/leaveEvents";
import { environmentFromPath, switchEnvironmentPath, type Environment } from "@/utils/shellNavigation";

export type { Environment };

const OPTIONS = [
    { value: "entra" as const, label: "Entra ID" },
    { value: "azure" as const, label: "Azure" },
];

interface EnvironmentSwitcherProps {
    variant: "bar" | "menu";
    /** The shell's route; the environment is read from it (Azure spec 1) */
    currentPath: string;
    /** The account sheet closes before the navigation, so a leave dialog is not behind it */
    onChoose?: () => void;
}

/**
 * The environment switcher "Entra ID | Azure" (Configure spec 17, Azure spec 1). The value is the environment of the
 * route; choosing the other one navigates to the same page there. The navigation asks the page first, so Configure
 * with a basket asks before it is left (`useLeaveGuard`). `bar` sits in the top bar from 640 up; `menu` is the row of
 * the account sheet below 640, inside role="menu".
 */
export function EnvironmentSwitcher({ variant, currentPath, onChoose }: EnvironmentSwitcherProps) {
    const router = useRouter();
    const value = environmentFromPath(currentPath);
    const choose = (target: Environment) => {
        if (target === value) return;
        onChoose?.();
        navigateGuarded(switchEnvironmentPath(currentPath, target), router.push);
    };

    if (variant === "bar") {
        return (
            <div data-visual-section="environment-switcher" className="w-[160px] shrink-0 md:w-[176px]">
                <SegmentedControl variant="radiogroup" ariaLabel="Environment" options={OPTIONS} value={value} onChange={choose} />
            </div>
        );
    }
    return <SegmentedControl variant="menu" ariaLabel="Environment" options={OPTIONS} value={value} onChange={choose} />;
}
