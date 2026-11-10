import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LEAVE_REQUEST_EVENT, createLeaveRequestListener, navigateGuarded, requestLeave } from "@/utils/leaveEvents";
import { switchEnvironmentPath } from "@/utils/shellNavigation";

/** A page with a guard as `useLeaveGuard` sets it up: the listener on the target, `ask` opens the leave dialog */
function guardedPage(changeCount: number) {
    const target = new EventTarget();
    const ask = vi.fn<(href: string) => void>();
    target.addEventListener(LEAVE_REQUEST_EVENT, createLeaveRequestListener(() => changeCount > 0, ask));
    return { target, ask };
}

describe("requestLeave", () => {
    it("lets the caller navigate when no guard listens", () => {
        expect(requestLeave("/azure", new EventTarget())).toBe(true);
    });
    it("lets the caller navigate without a window (static export pre-render)", () => {
        expect(requestLeave("/azure", undefined)).toBe(true);
    });
});

describe("the environment switcher leaving Configure", () => {
    it("asks first when the basket has changes, and does not navigate", () => {
        const { target, ask } = guardedPage(3);
        const navigate = vi.fn();
        navigateGuarded(switchEnvironmentPath("/configure", "azure"), navigate, target);
        expect(navigate).not.toHaveBeenCalled();
        expect(ask).toHaveBeenCalledWith("/azure/configure");
    });
    it("navigates at once when the basket is empty", () => {
        const { target, ask } = guardedPage(0);
        const navigate = vi.fn();
        navigateGuarded(switchEnvironmentPath("/configure", "azure"), navigate, target);
        expect(navigate).toHaveBeenCalledWith("/azure/configure");
        expect(ask).not.toHaveBeenCalled();
    });
    // No DOM in this suite: the wiring of the two ends is checked in the source
    it("is wired: the switcher navigates through navigateGuarded, useLeaveGuard listens on window", () => {
        const src = join(import.meta.dirname, "..", "..");
        const switcher = readFileSync(join(src, "components", "shell", "EnvironmentSwitcher.tsx"), "utf8");
        const guard = readFileSync(join(src, "hooks", "useLeaveGuard.ts"), "utf8");
        expect(switcher).toMatch(/navigateGuarded\(switchEnvironmentPath\(/);
        expect(guard).toMatch(/window\.addEventListener\(LEAVE_REQUEST_EVENT,/);
        expect(guard).toMatch(/createLeaveRequestListener\(\(\) => count\.current > 0,/);
    });
    it("ignores a request without a target", () => {
        const { target, ask } = guardedPage(3);
        const event = new CustomEvent(LEAVE_REQUEST_EVENT, { cancelable: true });
        expect(target.dispatchEvent(event)).toBe(true);
        expect(ask).not.toHaveBeenCalled();
    });
});
