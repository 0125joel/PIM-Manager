import { describe, expect, it, vi } from "vitest";
import bundled from "@/config/accessModel/eam-catalog.json";
import {
    CATALOG_URL,
    comparePlacement,
    configToSetToValues,
    contextsMeetingLabel,
    findCatalogRole,
    findGroupTemplate,
    findLevel,
    loadAccessModelCatalog,
    parseAccessModelCatalog,
    PLANES,
    policyMeetsLabel,
    proposeGroupPlacement,
    reasonForLevel,
    SECURITY_LEVELS,
    type AccessModelCatalog,
    type ConditionalAccessPolicyLike,
} from "@/utils/accessModelCatalog";

const GA = "62e90394-69f5-4237-9190-012177145e10";
const PRA = "e8611ab8-c189-46e8-94e1-60213ab1f814";
const GROUPS_ADMIN = "fdd7a751-b60b-444a-984c-02652fe8fa1c";

function parsed(raw: unknown): AccessModelCatalog {
    const result = parseAccessModelCatalog(raw);
    if (!result.ok) throw new Error(`not parsed: ${result.reason}`);
    return result.catalog;
}

const small = {
    schemaVersion: "1.0.0",
    catalogVersion: "2026-10-03.1",
    roles: [
        { templateId: PRA.toUpperCase(), displayName: "Privileged Role Administrator", plane: "Control", securityLevel: "Privileged", isPrivileged: true, expectedConfig: { maxActivationDuration: "PT1H", authContext: "phish-resistant-sif", requireApproval: true } },
        { templateId: GROUPS_ADMIN, displayName: "Groups Administrator", plane: "Management", securityLevel: "Specialized", isPrivileged: false, expectedConfig: { requireMFA: true }, note: "Groups can hold roles" },
        { templateId: "x", displayName: "Broken", plane: "Nowhere", securityLevel: "Privileged", expectedConfig: {} },
    ],
    levels: [
        { plane: "Control", securityLevel: "Privileged", expectedConfig: { maxActivationDuration: "PT1H", requireJustification: true, unknownField: 3 } },
        ...["Control", "Management", "Data"].flatMap((plane) => ["Privileged", "Specialized", "Enterprise"].map((securityLevel) => ({ plane, securityLevel, expectedConfig: {} })))
            .filter((l) => !(l.plane === "Control" && l.securityLevel === "Privileged")),
    ],
    groups: [{ plane: "Control", securityLevel: "Privileged", member: { requireApproval: true }, owner: { requireMFA: false } }],
    authContexts: [{ slug: "phish-resistant-sif", requireAuthStrengthId: "00000000-0000-0000-0000-000000000004", requireSignInFrequencyEveryTime: true }],
};

describe("parseAccessModelCatalog", () => {
    it("reads the bundled copy through the same parser (spec 9.1)", () => {
        const catalog = parsed(bundled);
        expect(catalog.schemaVersion.split(".")[0]).toBe("1");
        expect(catalog.roles.length).toBeGreaterThan(100);
        // Nine cells: every plane by every level
        expect(catalog.levels).toHaveLength(9);
        for (const plane of PLANES) for (const level of SECURITY_LEVELS) expect(findLevel(catalog, plane, level)).toBeDefined();
        expect(findCatalogRole(catalog, GA)).toMatchObject({ plane: "Control", securityLevel: "Privileged", isPrivileged: true });
        expect(new Set(catalog.authContexts.map((a) => a.slug))).toEqual(new Set(["phish-resistant-sif", "phish-resistant-no-sif", "phish-resistant-compliant-device", "phish-resistant-compliant-device-sif"]));
        // Every role has a template id and a place
        expect(catalog.roles.every((r) => /^[0-9a-f-]{36}$/.test(r.templateId))).toBe(true);
    });

    it("the bundled copy is the published catalog 2026-10-03.1, not the rebuild (R-01, NG-59 Blocked)", () => {
        const catalog = parsed(bundled);
        expect(catalog.catalogVersion).toBe("2026-10-03.1");
        // Every row of the published file reads, the nine roles the rebuild had to leave out included
        expect(catalog.roles).toHaveLength((bundled as { roles: unknown[] }).roles.length);
        expect(catalog.roles).toHaveLength(145);
        // Group templates for Guided and the access model page, Member and Owner each
        expect(catalog.groups.length).toBeGreaterThan(0);
        for (const g of catalog.groups) expect(Object.keys(g.member).length * Object.keys(g.owner).length).toBeGreaterThan(0);
        // The labels carry their Conditional Access requirements, so the second matching step of spec 9.3 can run
        for (const label of catalog.authContexts) expect(label.requireAuthStrengthId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("needs a newer PIM Manager for a schema of another major", () => {
        expect(parseAccessModelCatalog({ ...small, schemaVersion: "2.0.0" })).toEqual({ ok: false, reason: "newerVersion", schemaVersion: "2.0.0" });
        expect(parseAccessModelCatalog({ ...bundled, schemaVersion: "2.0.0" })).toMatchObject({ ok: false, reason: "newerVersion" });
        // A minor or patch of 1 is fine
        expect(parseAccessModelCatalog({ ...small, schemaVersion: "1.3.0" }).ok).toBe(true);
    });

    it("refuses what is not a catalog", () => {
        expect(parseAccessModelCatalog(null)).toMatchObject({ ok: false, reason: "invalid" });
        expect(parseAccessModelCatalog([])).toMatchObject({ ok: false, reason: "invalid" });
        expect(parseAccessModelCatalog({ roles: [] })).toMatchObject({ ok: false, reason: "invalid" });
        expect(parseAccessModelCatalog({ schemaVersion: "1.0.0" })).toMatchObject({ ok: false, reason: "invalid" });
    });

    it("refuses a file of the right major where nothing can be read, or a level cell is missing", () => {
        // A lower-case plane makes every row unreadable: not a catalog to show as live
        const lower = { ...small, roles: small.roles.map((r) => ({ ...r, plane: r.plane.toLowerCase() })) };
        expect(parseAccessModelCatalog(lower)).toMatchObject({ ok: false, reason: "invalid" });
        expect(parseAccessModelCatalog({ ...small, levels: small.levels.slice(1) })).toMatchObject({ ok: false, reason: "invalid", detail: expect.stringContaining("Control Privileged") });
    });

    it("keeps only ISO durations, so a bad value never becomes a change", () => {
        const withDuration = (d: string) => parsed({ ...small, roles: [{ ...small.roles[0], expectedConfig: { maxActivationDuration: d } }] }).roles[0].expectedConfig;
        expect(withDuration("PT1H30M")).toEqual({ maxActivationDuration: "PT1H30M" });
        expect(withDuration("P1D")).toEqual({ maxActivationDuration: "P1D" });
        expect(withDuration("8h")).toEqual({});
        expect(withDuration("PT")).toEqual({});
        expect(withDuration("P")).toEqual({});
        expect(withDuration("PT0M")).toEqual({});
    });

    it("keeps valid entries, lower-cases template ids, drops unknown fields and broken rows", () => {
        const catalog = parsed(small);
        expect(catalog.roles.map((r) => r.displayName)).toEqual(["Privileged Role Administrator", "Groups Administrator"]);
        expect(findCatalogRole(catalog, PRA)?.templateId).toBe(PRA);
        expect(findCatalogRole(catalog, PRA.toUpperCase())).toBeDefined();
        expect(findCatalogRole(catalog, "unknown")).toBeUndefined();
        expect(findLevel(catalog, "Control", "Privileged")?.expectedConfig).toEqual({ maxActivationDuration: "PT1H", requireJustification: true });
        expect(findGroupTemplate(catalog, "Control", "Privileged")).toMatchObject({ member: { requireApproval: true }, owner: { requireMFA: false } });
        expect(catalog.roles[1].note).toBe("Groups can hold roles");
    });
});

describe("configToSetToValues (spec 9.2, one choice)", () => {
    const resolve = (slug: string) => (slug === "phish-resistant-sif" ? "c1" : null);

    it("a matched label makes the requirement that context, even with requireMFA", () => {
        expect(configToSetToValues({ authContext: "phish-resistant-sif", requireMFA: true, maxActivationDuration: "PT1H" }, resolve)).toEqual({
            values: [
                { field: "maxActivationDuration", to: "PT1H" },
                { field: "activationRequirement", to: { kind: "authenticationContext", contextId: "c1" } },
            ],
        });
    });

    it("an unmatched label stays Keep, never silently MFA", () => {
        const result = configToSetToValues({ authContext: "phish-resistant-no-sif", requireMFA: true }, resolve);
        expect(result.values).toEqual([]);
        expect(result.unmatchedContext).toBe("phish-resistant-no-sif");
    });

    it("only requireMFA makes it MFA; requireMFA false makes it Nothing; a missing field is Keep", () => {
        expect(configToSetToValues({ requireMFA: true }, resolve).values).toEqual([{ field: "activationRequirement", to: { kind: "mfa" } }]);
        expect(configToSetToValues({ requireMFA: false }, resolve).values).toEqual([{ field: "activationRequirement", to: { kind: "none" } }]);
        expect(configToSetToValues({}, resolve).values).toEqual([]);
        expect(configToSetToValues({ requireJustification: false, requireApproval: true, allowPermanentEligible: false, allowPermanentActive: false }, resolve).values.map((v) => v.field))
            .toEqual(["requireJustificationOnActivation", "requireApproval", "allowPermanentEligible", "allowPermanentActive"]);
    });
});

describe("group placement and reasons (spec 8, 9.4)", () => {
    const catalog = parsed({
        ...small,
        roles: [
            ...small.roles.slice(0, 2),
            { templateId: "a", displayName: "Data Privileged", plane: "Data", securityLevel: "Privileged", isPrivileged: false, expectedConfig: {} },
            { templateId: "b", displayName: "Management Enterprise", plane: "Management", securityLevel: "Enterprise", isPrivileged: false, expectedConfig: {} },
        ],
    });

    it("proposes the strictest place of the roles a group holds", () => {
        expect(proposeGroupPlacement(catalog, ["b", GROUPS_ADMIN])).toEqual({ plane: "Management", securityLevel: "Specialized", fromRole: "Groups Administrator" });
        // At equal level Control wins over Data
        expect(proposeGroupPlacement(catalog, ["a", PRA])).toMatchObject({ plane: "Control", securityLevel: "Privileged", fromRole: "Privileged Role Administrator" });
        expect(proposeGroupPlacement(catalog, ["not-in-catalog"])).toBeNull();
        expect(proposeGroupPlacement(catalog, [])).toBeNull();
        expect(comparePlacement({ plane: "Data", securityLevel: "Privileged" }, { plane: "Control", securityLevel: "Specialized" })).toBeLessThan(0);
    });

    it("explains a level from the published fields", () => {
        expect(reasonForLevel(findCatalogRole(catalog, PRA)!)).toBe("isPrivileged");
        expect(reasonForLevel(findCatalogRole(catalog, "a")!)).toBe("fullControl");
        expect(reasonForLevel(findCatalogRole(catalog, GROUPS_ADMIN)!)).toBe("permissions");
    });
});

describe("loadAccessModelCatalog (spec 9.1)", () => {
    const loadBundled = async () => bundled;
    const ok = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

    it("uses the live file without credentials", async () => {
        const fetchImpl = ok(small);
        const loaded = await loadAccessModelCatalog({ fetchImpl, loadBundled });
        expect(loaded).toMatchObject({ origin: "live", catalog: { catalogVersion: "2026-10-03.1" } });
        expect(loaded.fallbackReason).toBeUndefined();
        const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(url).toBe(CATALOG_URL);
        expect(init).toMatchObject({ credentials: "omit" });
    });

    it("falls back to the bundled copy with the reason", async () => {
        const bundledVersion = parsed(bundled).catalogVersion;
        expect(await loadAccessModelCatalog({ fetchImpl: ok({ ...small, schemaVersion: "2.0.0" }), loadBundled }))
            .toMatchObject({ origin: "bundled", fallbackReason: "newerVersion", newerSchemaVersion: "2.0.0", catalog: { catalogVersion: bundledVersion } });
        expect(await loadAccessModelCatalog({ fetchImpl: ok({ hello: 1 }), loadBundled })).toMatchObject({ origin: "bundled", fallbackReason: "invalid" });
        expect(await loadAccessModelCatalog({ fetchImpl: vi.fn(async () => new Response("", { status: 503 })) as unknown as typeof fetch, loadBundled }))
            .toMatchObject({ origin: "bundled", fallbackReason: "unreachable" });
        expect(await loadAccessModelCatalog({ fetchImpl: vi.fn(async () => { throw new TypeError("CSP"); }) as unknown as typeof fetch, loadBundled }))
            .toMatchObject({ origin: "bundled", fallbackReason: "unreachable" });
    });

    it("gives up after the timeout", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        try {
            const fetchImpl = ((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
                init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
            })) as unknown as typeof fetch;
            const pending = loadAccessModelCatalog({ fetchImpl, loadBundled, timeoutMs: 1000 });
            await vi.advanceTimersByTimeAsync(1000);
            expect(await pending).toMatchObject({ origin: "bundled", fallbackReason: "unreachable" });
        } finally {
            vi.useRealTimers();
        }
    });

    it("throws only when the bundled copy itself is broken", async () => {
        await expect(loadAccessModelCatalog({ fetchImpl: ok(null), loadBundled: async () => ({}) })).rejects.toThrow(/bundled/);
    });
});

describe("contextsMeetingLabel (spec 9.3, second step)", () => {
    const label = { slug: "phish-resistant-sif", requireState: "enabled", requireAuthStrengthId: "00000000-0000-0000-0000-000000000004", requireSignInFrequencyEveryTime: true };
    const policy = (over: Partial<ConditionalAccessPolicyLike> & { contexts?: string[] } = {}): ConditionalAccessPolicyLike => ({
        state: "enabled",
        conditions: { applications: { includeAuthenticationContextClassReferences: over.contexts ?? ["c1"] } },
        grantControls: { builtInControls: [], authenticationStrength: { id: "00000000-0000-0000-0000-000000000004" } },
        sessionControls: { signInFrequency: { isEnabled: true, frequencyInterval: "everyTime" } },
        ...over,
    });

    it("finds the context whose enabled policy meets every requirement", () => {
        expect(contextsMeetingLabel(label, [policy()])).toEqual(["c1"]);
        expect(contextsMeetingLabel(label, [policy(), policy({ contexts: ["c2"] })])).toEqual(["c1", "c2"]);
    });

    it("misses a disabled or report-only policy, another strength, no sign-in frequency or no compliant device", () => {
        expect(policyMeetsLabel(policy({ state: "disabled" }), label)).toBe(false);
        expect(policyMeetsLabel(policy({ state: "enabledForReportingButNotEnforced" }), label)).toBe(false);
        expect(policyMeetsLabel(policy({ grantControls: { authenticationStrength: { id: "00000000-0000-0000-0000-000000000002" } } }), label)).toBe(false);
        expect(policyMeetsLabel(policy({ sessionControls: { signInFrequency: { isEnabled: true, frequencyInterval: "timeBased" } } }), label)).toBe(false);
        expect(policyMeetsLabel(policy(), { ...label, requireCompliantDevice: true })).toBe(false);
        expect(policyMeetsLabel(policy({ grantControls: { builtInControls: ["compliantDevice"], authenticationStrength: { id: "00000000-0000-0000-0000-000000000004" } } }), { ...label, requireCompliantDevice: true })).toBe(true);
    });

    it("a label without requirements matches nothing, so the admin chooses", () => {
        expect(contextsMeetingLabel({ slug: "phish-resistant-no-sif" }, [policy()])).toEqual([]);
    });
});
