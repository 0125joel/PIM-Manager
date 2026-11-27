import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MyAzureRoles } from "@/app/azure/report/components/MyAzureRoles";
import { AzureReportEmpty } from "@/app/azure/report/components/AzureReportEmpty";
import { AZURE_FIXTURE_MY_ROLES, AZURE_FIXTURE_MY_ROLES_NO_CONSENT } from "@/__tests__/fixtures/azureReportFixture";
import { hasMyRolesContent, type MyAzureRolesLoaded } from "@/utils/azureReportStates";

const render = (roles: MyAzureRolesLoaded) => renderToStaticMarkup(createElement(MyAzureRoles, { roles }));
const none: MyAzureRolesLoaded = { active: [], eligible: [], groups: { kind: "listed", groups: [] } };

describe("MyAzureRoles", () => {
    it("shows the via line of a role held through a group, and leaves the others as they were", () => {
        const html = render(AZURE_FIXTURE_MY_ROLES);
        expect(html).toContain("Contoso Production, via Azure Storage Readers, permanent");
        expect(html).toContain("kv-contoso-prod, ends 2 Nov 2026");
        expect(html).not.toContain("kv-contoso-prod, via");
    });

    it("lists the eligible PIM groups with the note about activation", () => {
        const html = render(AZURE_FIXTURE_MY_ROLES);
        expect(html).toContain("Through a PIM group (2)");
        expect(html).toContain("Eligible member of Azure Network Operators");
        expect(html).toContain("ends 30 Nov 2026");
        expect(html).toContain("permanent");
        expect(html).toContain("The Azure roles of a group show here once you activate your membership in PIM for Groups. Azure can take a few minutes before they appear.");
    });

    it("shows nothing extra for a listed state without groups", () => {
        const html = render({ ...none, eligible: AZURE_FIXTURE_MY_ROLES.eligible });
        expect(html).not.toContain("PIM group");
    });

    it("says PIM Manager has no read access to PIM for Groups", () => {
        const html = render(AZURE_FIXTURE_MY_ROLES_NO_CONSENT);
        expect(html).toContain("Roles you hold through a PIM group are not shown, because PIM Manager has no read access to PIM for Groups. Choose Grant read access for PIM for Groups under");
        expect(html).toMatch(/<a[^>]*href="\/settings#permissions"[^>]*>Settings, Workloads and permissions<\/a>; an admin has to consent\./);
        expect(html).not.toContain("Through a PIM group");
    });

    it("says the memberships could not be read", () => {
        expect(render({ ...AZURE_FIXTURE_MY_ROLES, groups: { kind: "failed" } })).toContain("Your PIM group memberships could not be read.");
    });
});

describe("hasMyRolesContent", () => {
    it("is false only without rows, without a listed group and without a note", () => {
        expect(hasMyRolesContent(none)).toBe(false);
        expect(hasMyRolesContent({ ...none, groups: { kind: "noConsent" } })).toBe(true);
        expect(hasMyRolesContent({ ...none, groups: { kind: "failed" } })).toBe(true);
        expect(hasMyRolesContent({ ...none, groups: { kind: "listed", groups: [{ groupId: "g", groupName: "G", endText: "Permanent", isPermanent: true }] } })).toBe(true);
        expect(hasMyRolesContent({ ...none, active: AZURE_FIXTURE_MY_ROLES.active })).toBe(true);
    });
});

describe("AzureReportEmpty", () => {
    it("shows the section with only the note for a user without any Azure role and without the consent", () => {
        const html = renderToStaticMarkup(createElement(AzureReportEmpty, { myRoles: { ...none, groups: { kind: "noConsent" } } }));
        expect(html).toContain("Your Azure roles");
        expect(html).toContain("no read access to PIM for Groups");
    });

    it("shows no section when there is nothing to show", () => {
        expect(renderToStaticMarkup(createElement(AzureReportEmpty, { myRoles: none }))).not.toContain("azure-my-roles-heading");
    });
});
