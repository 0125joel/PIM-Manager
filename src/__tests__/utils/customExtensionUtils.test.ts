import { describe, expect, it } from "vitest";
import {
    applyCustomExtensionCsvValue,
    buildCustomExtensionRuleBody,
    customExtensionLinksEqual,
    resolveCustomExtensionReference,
    formatCustomAttributes,
    getCustomExtensionSummary,
    getLinkedCustomExtensions,
    hasCustomExtensionSlots,
    isCustomExtensionActive,
    isCustomExtensionLinked,
    isPendingCustomExtensionPick,
    parseCustomAttributesInput,
    parseCustomExtensionLink,
    parseCustomExtensionRules,
} from "@/utils/customExtensionUtils";
import { CUSTOM_EXTENSION_RULE_IDS, CUSTOM_EXTENSION_RULE_TYPE } from "@/config/constants";

const EXTENSION_ID = "11111111-1111-1111-1111-111111111111";

const linkedPreApproval = {
    "@odata.type": CUSTOM_EXTENSION_RULE_TYPE,
    id: CUSTOM_EXTENSION_RULE_IDS.preApproval,
    isEnabled: true,
    customExtensionId: EXTENSION_ID,
    displayName: "Outside office hours",
    customAttributes: ["reservedNotUsed"],
};

const unlinkedPostApproval = {
    "@odata.type": CUSTOM_EXTENSION_RULE_TYPE,
    id: CUSTOM_EXTENSION_RULE_IDS.postApproval,
    isEnabled: false,
    customExtensionId: "",
    displayName: null,
    customAttributes: [],
};

const approvalRule = {
    "@odata.type": "#microsoft.graph.unifiedRoleManagementPolicyApprovalRule",
    id: "Approval_EndUser_Assignment",
};

describe("parseCustomExtensionRules", () => {
    it("returns only linked slots and keeps the denormalized displayName", () => {
        const slots = parseCustomExtensionRules([approvalRule, linkedPreApproval, unlinkedPostApproval]);
        expect(slots).toEqual({
            preApproval: {
                isEnabled: true,
                customExtensionId: EXTENSION_ID,
                displayName: "Outside office hours",
                customAttributes: ["reservedNotUsed"],
            },
        });
        expect(slots?.postApproval).toBeUndefined();
    });

    it("returns undefined when no slot links an extension", () => {
        expect(parseCustomExtensionRules([approvalRule, unlinkedPostApproval])).toBeUndefined();
        expect(parseCustomExtensionRules([approvalRule])).toBeUndefined();
        expect(parseCustomExtensionRules(undefined)).toBeUndefined();
    });

    it("treats a null customExtensionId as unlinked", () => {
        const rule = { ...linkedPreApproval, customExtensionId: null, isEnabled: true };
        expect(parseCustomExtensionRules([rule])).toBeUndefined();
        expect(isCustomExtensionLinked(parseCustomExtensionLink(rule))).toBe(false);
    });

    it("keeps a linked but disabled slot, flagged as inactive", () => {
        const rule = { ...linkedPreApproval, isEnabled: false };
        const slots = parseCustomExtensionRules([rule]);
        expect(isCustomExtensionLinked(slots?.preApproval)).toBe(true);
        expect(isCustomExtensionActive(slots?.preApproval)).toBe(false);
    });
});

describe("hasCustomExtensionSlots", () => {
    it("detects the preview slots regardless of link state", () => {
        expect(hasCustomExtensionSlots([approvalRule, unlinkedPostApproval])).toBe(true);
        expect(hasCustomExtensionSlots([approvalRule])).toBe(false);
        expect(hasCustomExtensionSlots(undefined)).toBe(false);
    });
});

describe("getLinkedCustomExtensions", () => {
    it("lists slots in pre-then-post order", () => {
        const linked = getLinkedCustomExtensions({
            postApproval: { isEnabled: true, customExtensionId: "b", customAttributes: [] },
            preApproval: { isEnabled: true, customExtensionId: "a", customAttributes: [] },
        });
        expect(linked.map(l => l.slot)).toEqual(["preApproval", "postApproval"]);
        expect(getLinkedCustomExtensions(undefined)).toEqual([]);
    });
});

describe("customExtensionLinksEqual", () => {
    it("treats every unlinked shape as equal", () => {
        expect(customExtensionLinksEqual(undefined, { isEnabled: false, customExtensionId: "", customAttributes: [] })).toBe(true);
        expect(customExtensionLinksEqual(undefined, { isEnabled: true, customExtensionId: "  ", customAttributes: ["x"] })).toBe(true);
    });

    it("compares id, enabled flag and attribute order for linked slots", () => {
        const base = { isEnabled: true, customExtensionId: EXTENSION_ID, customAttributes: ["a", "b"] };
        expect(customExtensionLinksEqual(base, { ...base, displayName: "ignored" })).toBe(true);
        expect(customExtensionLinksEqual(base, { ...base, isEnabled: false })).toBe(false);
        expect(customExtensionLinksEqual(base, { ...base, customAttributes: ["b", "a"] })).toBe(false);
        expect(customExtensionLinksEqual(base, { ...base, customExtensionId: "other" })).toBe(false);
        expect(customExtensionLinksEqual(base, undefined)).toBe(false);
    });

    it("takes a link written without attributes as equal to the same link read back with the extension's attributes", () => {
        const written = { isEnabled: true, customExtensionId: EXTENSION_ID, customAttributes: [] };
        const read = { ...written, displayName: "Outside office hours", customAttributes: ["Reason outside office hours"] };
        expect(customExtensionLinksEqual(written, read)).toBe(true);
        expect(customExtensionLinksEqual(read, written)).toBe(true);
        expect(customExtensionLinksEqual(written, { ...read, customExtensionId: "other" })).toBe(false);
    });
});

describe("buildCustomExtensionRuleBody", () => {
    it("builds the confirmed write shape without displayName", () => {
        const body = buildCustomExtensionRuleBody("preApproval", {
            isEnabled: true,
            customExtensionId: ` ${EXTENSION_ID} `,
            displayName: "Outside office hours",
            customAttributes: ["reservedNotUsed"],
        });
        expect(body).toEqual({
            id: CUSTOM_EXTENSION_RULE_IDS.preApproval,
            isEnabled: true,
            customExtensionId: EXTENSION_ID,
            customAttributes: ["reservedNotUsed"],
        });
        expect("displayName" in body).toBe(false);
    });

    it("builds an unlink as empty id with isEnabled false", () => {
        expect(buildCustomExtensionRuleBody("postApproval", { isEnabled: true, customExtensionId: "", customAttributes: ["x"] })).toEqual({
            id: CUSTOM_EXTENSION_RULE_IDS.postApproval,
            isEnabled: false,
            customExtensionId: "",
            customAttributes: [],
        });
        expect(buildCustomExtensionRuleBody("postApproval", undefined).isEnabled).toBe(false);
    });
});

describe("pending picks and summaries", () => {
    it("recognises a switched-on slot without a pick and never treats it as an unlink", () => {
        expect(isPendingCustomExtensionPick({ isEnabled: true, customExtensionId: "", customAttributes: [] })).toBe(true);
        expect(isPendingCustomExtensionPick({ isEnabled: false, customExtensionId: "", customAttributes: [] })).toBe(false);
        expect(isPendingCustomExtensionPick({ isEnabled: true, customExtensionId: EXTENSION_ID, customAttributes: [] })).toBe(false);
        expect(isPendingCustomExtensionPick(undefined)).toBe(false);
    });

    it("summarises every managed slot by state", () => {
        const summary = getCustomExtensionSummary({
            preApproval: { isEnabled: true, customExtensionId: EXTENSION_ID, displayName: "Outside office hours", customAttributes: [] },
            postApproval: { isEnabled: false, customExtensionId: "", customAttributes: [] },
        });
        expect(summary).toEqual([
            { slot: "preApproval", text: "Outside office hours", state: "linked" },
            { slot: "postApproval", text: "Removed", state: "removed" },
        ]);
        expect(getCustomExtensionSummary({ preApproval: { isEnabled: false, customExtensionId: EXTENSION_ID, customAttributes: [] } }))
            .toEqual([{ slot: "preApproval", text: `${EXTENSION_ID} (disabled)`, state: "disabled" }]);
        expect(getCustomExtensionSummary({ preApproval: { isEnabled: true, customExtensionId: "", customAttributes: [] } })[0].state).toBe("pending");
        expect(getCustomExtensionSummary(undefined)).toEqual([]);
    });
});

describe("CSV references", () => {
    const extensions = [
        { id: EXTENSION_ID, displayName: "Outside office hours" },
        { id: "11111111-2222-3333-4444-555555555555", displayName: "Ticket check" },
        { id: "66666666-7777-8888-9999-000000000000", displayName: "Ticket check" },
    ];

    it("resolves ids and unique names, refuses ambiguous names, trusts GUIDs without a list", () => {
        expect(resolveCustomExtensionReference(` ${EXTENSION_ID.toUpperCase()} `, extensions)).toEqual({ id: EXTENSION_ID, displayName: "Outside office hours" });
        expect(resolveCustomExtensionReference("outside office HOURS", extensions)?.id).toBe(EXTENSION_ID);
        expect(resolveCustomExtensionReference("Ticket check", extensions)).toBeUndefined();
        expect(resolveCustomExtensionReference("Outside office hours", null)).toBeUndefined();
        expect(resolveCustomExtensionReference(EXTENSION_ID, null)).toEqual({ id: EXTENSION_ID, displayName: EXTENSION_ID });
        expect(resolveCustomExtensionReference("", extensions)).toBeUndefined();
    });

    it("applies a cell as link, unlink or error and keeps attributes for the same extension", () => {
        const settings: { customExtensions?: ReturnType<typeof parseCustomExtensionRules> } = {
            customExtensions: { preApproval: { isEnabled: true, customExtensionId: EXTENSION_ID, customAttributes: ["ticket"] } },
        };
        applyCustomExtensionCsvValue(settings, "preApproval", "Outside office hours", extensions);
        expect(settings.customExtensions?.preApproval).toEqual({ isEnabled: true, customExtensionId: EXTENSION_ID, displayName: "Outside office hours", customAttributes: ["ticket"] });

        applyCustomExtensionCsvValue(settings, "postApproval", "", extensions);
        expect(settings.customExtensions?.postApproval).toEqual({ isEnabled: false, customExtensionId: "", customAttributes: [] });

        applyCustomExtensionCsvValue(settings, "preApproval", "11111111-2222-3333-4444-555555555555", extensions);
        expect(settings.customExtensions?.preApproval?.customAttributes).toEqual([]);

        expect(() => applyCustomExtensionCsvValue(settings, "preApproval", "Nope", extensions)).toThrow(/not found/);
    });
});

describe("custom attribute input helpers", () => {
    it("round-trips a semicolon separated list", () => {
        expect(parseCustomAttributesInput(" ticket ; costCenter;;")).toEqual(["ticket", "costCenter"]);
        expect(formatCustomAttributes(["ticket", "costCenter"])).toBe("ticket; costCenter");
        expect(formatCustomAttributes(undefined)).toBe("");
    });
});
