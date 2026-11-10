import { describe, expect, it } from "vitest";
import fixture from "@/__tests__/fixtures/azure/subscription-owner-policy.json";
import type { ArmRoleManagementPolicy, AzureScope } from "@/types/azureResource.types";
import type { PolicySettings } from "@/types/wizard.types";
import { parseArmPolicy } from "@/utils/armPolicyRules";
import { panelScopeLine, policyRows } from "@/utils/azurePolicyRows";

const BASE: PolicySettings = parseArmPolicy((fixture as unknown as { value: ArmRoleManagementPolicy[] }).value[0]);
const values = (settings: PolicySettings) => policyRows(settings).map((r) => r.value);

describe("policyRows", () => {
    it("has the five labels and helps in order", () => {
        expect(policyRows(BASE).map((r) => r.label)).toEqual(["Maximum activation duration", "On activation", "Approval", "Eligible assignment valid for", "Active assignment valid for"]);
        expect(policyRows(BASE).map((r) => r.help)).toEqual([
            "How long an activation lasts",
            "What an eligible user must give to activate",
            "Someone must approve each activation",
            "How long an eligible assignment lasts",
            "How long an active assignment lasts",
        ]);
    });

    it("reads the fixture", () => {
        expect(values(BASE)).toEqual(["8 Hours", "Justification", "Not required", "1 Year", "180 Days"]);
    });

    it("shows everything on", () => {
        expect(
            values({
                ...BASE,
                maxActivationDuration: "PT4H",
                activationRequirement: "mfa",
                requireTicketInfo: true,
                requireApproval: true,
                approvers: [
                    { id: "g1", type: "group", displayName: "Security Leads" },
                    { id: "u1", type: "user" },
                ],
            }),
        ).toEqual(["4 Hours", "MFA, Justification, Ticket", "Required: Security Leads, u1", "1 Year", "180 Days"]);
    });

    it("shows authentication context alone", () => {
        expect(values({ ...BASE, activationRequirement: "authenticationContext", requireJustificationOnActivation: false })[1]).toBe("Authentication context");
    });

    it("shows Nothing", () => {
        expect(values({ ...BASE, requireJustificationOnActivation: false })[1]).toBe("Nothing");
    });

    it("shows approval without approvers", () => {
        expect(values({ ...BASE, requireApproval: true, approvers: [] })[2]).toBe("Required");
        expect(values({ ...BASE, requireApproval: true, approvers: undefined })[2]).toBe("Required");
    });

    it("shows permanent", () => {
        expect(values({ ...BASE, allowPermanentEligible: true, allowPermanentActive: true }).slice(3)).toEqual(["Permanent allowed", "Permanent allowed"]);
    });

    it("shows Unknown without an expiration", () => {
        expect(values({ ...BASE, eligibleExpiration: undefined })[3]).toBe("Unknown");
    });
});

describe("panelScopeLine", () => {
    const SUB = "/subscriptions/s1";
    const scope = (id: string, name: string, parentId: string | null, level: AzureScope["level"] = "resourceGroup"): AzureScope => ({ id, name, level, parentId });
    const sub = scope(SUB, "Contoso Production", null, "subscription");
    const web = scope(`${SUB}/resourceGroups/rg-web`, "rg-web", SUB);
    const data = scope(`${SUB}/resourceGroups/rg-data`, "rg-data", "/SUBSCRIPTIONS/S1");
    const x = scope(`${SUB}/resourceGroups/rg-x`, "rg-x", SUB);
    const y = scope(`${SUB}/resourceGroups/rg-y`, "rg-y", SUB);
    const head = "Contoso Production. These settings apply to this scope only";

    it("handles no children", () => {
        expect(panelScopeLine([sub], SUB)).toBe(`${head}.`);
    });

    it("names the root scope without its own id and without children", () => {
        const root = scope("/", "/", null, "resourceGroup");
        expect(panelScopeLine([root, sub], "/")).toBe("The root scope.");
    });

    it("handles one child", () => {
        expect(panelScopeLine([sub, web], SUB)).toBe(`${head}; they are not passed down to rg-web.`);
    });

    it("handles two children, case-insensitively", () => {
        expect(panelScopeLine([sub, web, data], "/Subscriptions/S1")).toBe(`${head}; they are not passed down to rg-web or rg-data.`);
    });

    it("handles three children", () => {
        expect(panelScopeLine([sub, web, data, x], SUB)).toBe(`${head}; they are not passed down to rg-web, rg-data or 1 other scope.`);
    });

    it("handles four children", () => {
        expect(panelScopeLine([sub, web, data, x, y], SUB)).toBe(`${head}; they are not passed down to rg-web, rg-data or 2 other scopes.`);
    });

    it("falls back to the id", () => {
        expect(panelScopeLine([], "/subscriptions/gone")).toBe("/subscriptions/gone. These settings apply to this scope only.");
    });
});
