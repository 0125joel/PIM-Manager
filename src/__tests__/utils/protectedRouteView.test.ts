import { describe, expect, it } from "vitest";
import { protectedRouteView } from "@/utils/protectedRouteView";

describe("protectedRouteView (bug 13)", () => {
    it("keeps the page during a consent or token popup while an account is signed in", () => {
        expect(protectedRouteView({ inProgress: "acquireToken", hasAccount: true, pathname: "/configure" })).toBe("page");
        expect(protectedRouteView({ inProgress: "none", hasAccount: true, pathname: "/configure" })).toBe("page");
        expect(protectedRouteView({ inProgress: "handleRedirect", hasAccount: true, pathname: "/settings" })).toBe("page");
    });

    it("shows the spinner only while no account exists and MSAL is busy", () => {
        expect(protectedRouteView({ inProgress: "startup", hasAccount: false, pathname: "/dashboard" })).toBe("spinner");
        expect(protectedRouteView({ inProgress: "acquireToken", hasAccount: false, pathname: "/" })).toBe("spinner");
    });

    it("hides the page during sign-out, which clears the data first", () => {
        expect(protectedRouteView({ inProgress: "logout", hasAccount: true, pathname: "/dashboard" })).toBe("spinner");
    });

    it("sends a signed-out visitor to the front page, which renders itself", () => {
        expect(protectedRouteView({ inProgress: "none", hasAccount: false, pathname: "/configure" })).toBe("redirect");
        expect(protectedRouteView({ inProgress: "none", hasAccount: false, pathname: "/" })).toBe("page");
    });
});
