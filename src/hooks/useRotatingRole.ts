import { useEffect, useState } from "react";
import { DEFAULT_HEADLINE_ROLE, HEADLINE_ROLES, WIDE_HEADLINE_ROLES, msUntilNextHour, pickRole } from "@/utils/rotatingRole";

const STORAGE_KEY = "pim-headline-role";

function readLast(): string | null {
    try {
        return window.localStorage.getItem(STORAGE_KEY);
    } catch {
        return null;
    }
}

function writeLast(role: string): void {
    try {
        window.localStorage.setItem(STORAGE_KEY, role);
    } catch {
        // Private mode or blocked storage: the next load may repeat a name, nothing else
    }
}

/**
 * The role name in the front page headline. The static HTML and the first render show the default,
 * so there is no hydration mismatch; the effect then picks one at random (never the one shown last)
 * and picks again on the hour. Names that need more room are only offered from 640 px up.
 */
export function useRotatingRole(): string {
    const [role, setRole] = useState<string>(DEFAULT_HEADLINE_ROLE);

    useEffect(() => {
        let timer: ReturnType<typeof setTimeout>;
        let current = readLast();
        const rotate = () => {
            const hasRoom = window.matchMedia("(min-width: 640px)").matches;
            current = pickRole(hasRoom ? [...HEADLINE_ROLES, ...WIDE_HEADLINE_ROLES] : HEADLINE_ROLES, current);
            writeLast(current);
            setRole(current);
            timer = setTimeout(rotate, msUntilNextHour(new Date()));
        };
        rotate();
        return () => clearTimeout(timer);
    }, []);

    return role;
}
