import { describe, expect, it } from "vitest";
import { DEFAULT_AZURE_FILTERS } from "@/utils/azureReport";
import {
    buildAzureReportSearch,
    getAzureFilterChips,
    getAzureFilterControls,
    groupAzureControls,
    parseAzureFilter,
    parseAzureReportUrlState,
    readAzureControlValue,
    removeAzureFilterKey,
    serializeAzureFilter,
    writeAzureControlValue,
} from "@/utils/azureReportFilter";
import { resourceIconFor } from "@/utils/azureResourceIcons";

const DEFAULT_WITHOUT_QUERY: Partial<typeof DEFAULT_AZURE_FILTERS> = { ...DEFAULT_AZURE_FILTERS };
delete DEFAULT_WITHOUT_QUERY.query;

describe("parseAzureFilter", () => {
    it("returns the default for null and empty", () => {
        expect(parseAzureFilter(null)).toEqual(DEFAULT_WITHOUT_QUERY);
        expect(parseAzureFilter("")).toEqual(DEFAULT_WITHOUT_QUERY);
    });

    it("reads the raw and the percent-encoded form", () => {
        const expected = { ...DEFAULT_WITHOUT_QUERY, status: "eligible", privileged: true };
        expect(parseAzureFilter("status:eligible,privileged:true")).toEqual(expected);
        expect(parseAzureFilter("status%3Aeligible%2Cprivileged%3Atrue")).toEqual(expected);
    });

    it("ignores unknown keys, unknown values and malformed pairs", () => {
        expect(parseAzureFilter("status:bogus,nokey:1,privileged:yes,:x,origin:here")).toEqual(DEFAULT_WITHOUT_QUERY);
    });

    it("lets the last valid pair of a key win", () => {
        expect(parseAzureFilter("status:eligible,status:active").status).toBe("active");
    });

    it("lowercases a valid resource type and ignores an invalid one", () => {
        expect(parseAzureFilter("resourceType:Microsoft.KeyVault/vaults").resourceType).toBe("microsoft.keyvault/vaults");
        expect(parseAzureFilter("resourceType:../x").resourceType).toBe("all");
    });
});

describe("serializeAzureFilter", () => {
    it("is empty for the default", () => {
        expect(serializeAzureFilter(DEFAULT_AZURE_FILTERS)).toBe("");
    });

    it("writes the differing fields in key order and never the query", () => {
        expect(serializeAzureFilter({ ...DEFAULT_AZURE_FILTERS, query: "x", privileged: true, status: "eligible", origin: "all" })).toBe("status:eligible,origin:all,privileged:true");
    });

    it("round-trips", () => {
        const x = { ...DEFAULT_AZURE_FILTERS, status: "assigned", principalType: "foreignGroup", ends: "within30", level: "resourceGroup", resourceType: "microsoft.web/sites" } as const;
        expect(parseAzureFilter(serializeAzureFilter(x))).toEqual({ ...DEFAULT_WITHOUT_QUERY, status: "assigned", principalType: "foreignGroup", ends: "within30", level: "resourceGroup", resourceType: "microsoft.web/sites" });
    });
});

describe("the URL", () => {
    it("builds the search and keeps other parameters", () => {
        expect(buildAzureReportSearch({ view: null, roleId: null, scopeId: "/subscriptions/s1", filters: { ...DEFAULT_AZURE_FILTERS, query: "web", status: "eligible" } }, "state=report&q=old"))
            .toBe("state=report&scope=%2Fsubscriptions%2Fs1&q=web&f=status:eligible");
        expect(buildAzureReportSearch({ view: null, roleId: null, scopeId: null, filters: DEFAULT_AZURE_FILTERS }, "")).toBe("");
    });

    it("parses the search", () => {
        const state = parseAzureReportUrlState("?scope=%2Fsubscriptions%2Fs1&q=web&f=origin:inherited");
        expect(state.scopeId).toBe("/subscriptions/s1");
        expect(state.filters).toEqual({ ...DEFAULT_AZURE_FILTERS, query: "web", origin: "inherited" });
        expect(state.view).toBeNull();
        expect(state.roleId).toBeNull();
    });

    it("reads and writes the view and the role of the role view", () => {
        const state = parseAzureReportUrlState("view=roles&scope=%2Fsubscriptions%2Fs1&role=8e3af657");
        expect(state).toMatchObject({ view: "roles", roleId: "8e3af657" });
        expect(buildAzureReportSearch(state, "")).toBe("view=roles&scope=%2Fsubscriptions%2Fs1&role=8e3af657");
        // Without a view the role belongs to the role view the preference may open
        expect(parseAzureReportUrlState("role=r1").roleId).toBe("r1");
    });

    it("drops the role in the assignments view and ignores an unknown view", () => {
        expect(parseAzureReportUrlState("view=assignments&role=r1")).toMatchObject({ view: "assignments", roleId: null });
        expect(buildAzureReportSearch({ view: "assignments", roleId: "r1", scopeId: null, filters: DEFAULT_AZURE_FILTERS }, "role=old")).toBe("view=assignments");
        expect(parseAzureReportUrlState("view=table").view).toBeNull();
    });
});

describe("chips", () => {
    it("labels the differing fields in key order", () => {
        const chips = getAzureFilterChips({ ...DEFAULT_AZURE_FILTERS, query: "x", ends: "within30", status: "activated", resourceType: "microsoft.keyvault/vaults" });
        expect(chips.map((c) => c.label)).toEqual([
            "Assignment: Active after activation",
            "Ends: Within 30 days",
            `Resource type: ${resourceIconFor("microsoft.keyvault/vaults").label}`,
        ]);
    });

    it("removes a key back to its default", () => {
        expect(removeAzureFilterKey({ ...DEFAULT_AZURE_FILTERS, origin: "all" }, "origin").origin).toBe("here");
    });
});

describe("controls", () => {
    it("lists fourteen controls (seven plus via, customRole, approval, mfa, justification, maxDuration and notified) and the resource types once, sorted by label", () => {
        const controls = getAzureFilterControls(["Microsoft.Web/sites", "microsoft.keyvault/vaults", "microsoft.web/sites"]);
        expect(controls.map((c) => c.key)).toEqual([
            "status", "origin", "principalType", "via", "ends",
            "privileged", "customRole", "approval", "mfa", "justification", "maxDuration", "notified",
            "level", "resourceType",
        ]);
        expect(controls[13].options.map((o) => o.value)).toEqual(["all", "microsoft.web/sites", "microsoft.keyvault/vaults"]);
        expect(controls.find((c) => c.key === "principalType")!.options.map((o) => o.value)).toEqual(["all", "user", "group", "app", "guest", "agent", "managedIdentity", "foreignGroup", "deleted"]);
        expect(controls.find((c) => c.key === "level")!.options.map((o) => o.value)).toEqual(["all", "managementGroup", "subscription", "resourceGroup", "resource", "subscriptionOrAbove"]);
        expect(controls.some((c) => ["noEligible", "excludeEmergency", "role"].includes(c.key))).toBe(false);
        expect(groupAzureControls(controls).map((g) => g.group)).toEqual(["Assignments", "Role properties", "Scope"]);
    });

    it("reads and writes control values", () => {
        const controls = getAzureFilterControls([]);
        const privileged = controls.find((c) => c.key === "privileged")!;
        const status = controls.find((c) => c.key === "status")!;
        expect(writeAzureControlValue(privileged, DEFAULT_AZURE_FILTERS, "true").privileged).toBe(true);
        expect(writeAzureControlValue(privileged, { ...DEFAULT_AZURE_FILTERS, privileged: true }, "all").privileged).toBe(false);
        expect(writeAzureControlValue(status, DEFAULT_AZURE_FILTERS, "bogus")).toBe(DEFAULT_AZURE_FILTERS);
        expect(readAzureControlValue(privileged, { ...DEFAULT_AZURE_FILTERS, privileged: true })).toBe("true");
        expect(readAzureControlValue(privileged, DEFAULT_AZURE_FILTERS)).toBe("all");
    });

    it("reads and writes customRole like privileged", () => {
        const custom = getAzureFilterControls([]).find((c) => c.key === "customRole")!;
        expect(writeAzureControlValue(custom, DEFAULT_AZURE_FILTERS, "true").customRole).toBe(true);
        expect(writeAzureControlValue(custom, { ...DEFAULT_AZURE_FILTERS, customRole: true }, "all").customRole).toBe(false);
        expect(readAzureControlValue(custom, { ...DEFAULT_AZURE_FILTERS, customRole: true })).toBe("true");
        expect(readAzureControlValue(custom, DEFAULT_AZURE_FILTERS)).toBe("all");
        expect(writeAzureControlValue(custom, DEFAULT_AZURE_FILTERS, "bogus")).toBe(DEFAULT_AZURE_FILTERS);
    });

    it("reads and writes a select of the new keys", () => {
        const mfa = getAzureFilterControls([]).find((c) => c.key === "mfa")!;
        expect(writeAzureControlValue(mfa, DEFAULT_AZURE_FILTERS, "authContext").mfa).toBe("authContext");
        expect(readAzureControlValue(mfa, { ...DEFAULT_AZURE_FILTERS, mfa: "neither" })).toBe("neither");
    });
});

describe("the keys of the dashboard", () => {
    const ROLE = "8e3af657-a8ff-443c-a75c-2fe8c4bcb635";
    const ALL = {
        ...DEFAULT_AZURE_FILTERS,
        customRole: true, approval: "required", justification: "notRequired", mfa: "authContext", maxDuration: "over8h",
        notified: "none", via: "group", noEligible: true, excludeEmergency: true, role: ROLE,
    } as const;

    it("round-trips every new key", () => {
        const text = serializeAzureFilter(ALL);
        expect(text).toBe(`customRole:true,approval:required,justification:notRequired,mfa:authContext,maxDuration:over8h,notified:none,via:group,noEligible:true,excludeEmergency:true,role:${ROLE}`);
        const expected: Partial<typeof DEFAULT_AZURE_FILTERS> = { ...ALL };
        delete expected.query;
        expect(parseAzureFilter(text)).toEqual(expected);
    });

    it("round-trips the new values of existing keys", () => {
        for (const x of [{ principalType: "guest" }, { principalType: "agent" }, { principalType: "managedIdentity" }, { level: "managementGroup" }, { level: "subscriptionOrAbove" }] as const) {
            expect(parseAzureFilter(serializeAzureFilter({ ...DEFAULT_AZURE_FILTERS, ...x }))).toEqual({ ...DEFAULT_WITHOUT_QUERY, ...x });
        }
    });

    it("lowercases a valid role and ignores an invalid one", () => {
        expect(parseAzureFilter(`role:${ROLE.toUpperCase()}`).role).toBe(ROLE);
        expect(parseAzureFilter("role:owner").role).toBe("all");
        expect(parseAzureFilter("role:8e3af657-a8ff-443c-a75c").role).toBe("all");
    });

    it("ignores an invalid boolean and an invalid value", () => {
        const parsed = parseAzureFilter("customRole:false,noEligible:1,excludeEmergency:yes,approval:maybe,mfa:sms,maxDuration:upTo2h,notified:all,via:both");
        expect(parsed).toEqual(DEFAULT_WITHOUT_QUERY);
    });

    it("labels the chips in key order, with and without role names", () => {
        const labels = (roleNames?: ReadonlyMap<string, string>) => getAzureFilterChips({ ...ALL }, roleNames).map((c) => c.label);
        const expected = [
            "Custom roles", "Approval: Required", "Justification: Not required", "MFA: Authentication context", "Maximum duration: over 8 h",
            "Nobody is notified", "Through: A group", "No eligible assignment", "Emergency access left out",
        ];
        expect(labels(new Map([[ROLE, "Owner"]]))).toEqual([...expected, "Role: Owner"]);
        expect(labels()).toEqual([...expected, "Role: 8e3af657"]);
        expect(labels(new Map())).toEqual([...expected, "Role: 8e3af657"]);
    });

    it("labels the new values of existing keys", () => {
        const label = (x: Partial<typeof DEFAULT_AZURE_FILTERS>) => getAzureFilterChips({ ...DEFAULT_AZURE_FILTERS, ...x })[0].label;
        expect(label({ principalType: "guest" })).toBe("Held by: Guests");
        expect(label({ principalType: "agent" })).toBe("Held by: Agents");
        expect(label({ principalType: "managedIdentity" })).toBe("Held by: Managed identities");
        expect(label({ level: "managementGroup" })).toBe("Level: Management groups");
        expect(label({ level: "subscriptionOrAbove" })).toBe("Level: Subscription or above");
        expect(label({ via: "direct" })).toBe("Through: Direct");
        expect(label({ maxDuration: "upTo1h" })).toBe("Maximum duration: up to 1 h");
        expect(label({ mfa: "entraMfa" })).toBe("MFA: Entra MFA");
        expect(label({ mfa: "neither" })).toBe("MFA: Neither");
        expect(label({ approval: "notRequired" })).toBe("Approval: Not required");
        expect(label({ justification: "required" })).toBe("Justification: Required");
    });

    it("removes a new key back to its default", () => {
        expect(removeAzureFilterKey(ALL, "role").role).toBe("all");
        expect(removeAzureFilterKey(ALL, "noEligible").noEligible).toBe(false);
    });
});
