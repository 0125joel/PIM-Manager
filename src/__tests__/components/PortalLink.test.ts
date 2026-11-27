import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PortalLink, portalLinkClass } from "@/components/ui/PortalLink";
import { DemoModeProvider } from "@/contexts/DemoModeContext";

const HREF = "https://entra.microsoft.com/#view/Microsoft_AAD_UsersAndTenants/UserProfileMenuBlade/~/overview/userId/00000000-0000-0000-0000-00000000aaaa";

const render = (href: string | null, demo = false) => {
    const props = { href, portal: "Entra admin center" as const, className: "text-ink", children: "Anna" };
    const link = createElement(PortalLink, props);
    return renderToStaticMarkup(demo ? createElement(DemoModeProvider, null, link) : link);
};

describe("PortalLink", () => {
    it("renders an anchor in the role link's accent colour, opening in a new tab", () => {
        const html = render(HREF);
        expect(html).toContain("<a ");
        expect(html).toContain('target="_blank"');
        expect(html).toContain('rel="noopener noreferrer"');
        expect(html).toContain("text-accent");
        expect(html).toContain("focus-visible:[outline-offset:-2px]");
        expect(html).toContain("(opens in the Entra admin center in a new tab)");
    });

    it("stays grey in a dimmed row, and shares its look with the other portal links", () => {
        const props = { href: HREF, portal: "Entra admin center" as const, isMuted: true, children: "Anna" };
        const muted = renderToStaticMarkup(createElement(PortalLink, props));
        expect(muted).toContain("text-muted");
        expect(muted).not.toContain("text-accent");
        expect(portalLinkClass(false, true)).toContain(" underline ");
        expect(portalLinkClass(false, true)).not.toContain("hover:underline");
        expect(portalLinkClass()).toBe("text-accent underline-offset-2 hover:underline focus-visible:underline focus-visible:[outline-offset:-2px]");
    });

    it("renders no anchor without an href", () => {
        const html = render(null);
        expect(html).not.toContain("<a ");
        expect(html).toContain("Anna");
    });

    it("renders no anchor in the demo, even with an href", () => {
        const html = render(HREF, true);
        expect(html).not.toContain("<a ");
        expect(html).toContain("Anna");
    });
});
