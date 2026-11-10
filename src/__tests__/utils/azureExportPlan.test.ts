import { describe, expect, it } from "vitest";
import type { AzureAssignment, AzureScope } from "@/types/azureResource.types";
import { DEFAULT_AZURE_FILTERS, EMPTY_AZURE_FILTERS, buildAssignmentRows, type AzureAssignmentRow } from "@/utils/azureReport";
import { getAzureFilterChips } from "@/utils/azureReportFilter";
import {
    DEFAULT_AZURE_EXPORT_CHOICE, allScopeRows, azurePreamble, describeAzureFilters, parseStoredAzureChoice, planAzureExport,
    type AzureExportChoice, type AzureExportData,
} from "@/utils/azureExportPlan";
import type { AzurePolicyOutcome, AzureRolePair } from "@/utils/azureExportRows";
import { formatDateTime } from "@/utils/dateFormat";

const ROOT: AzureScope = { id: "/", name: "Root", level: "root", parentId: null };
const MG: AzureScope = { id: "/providers/Microsoft.Management/managementGroups/contoso", name: "Contoso", level: "managementGroup", parentId: "/" };
const SUB: AzureScope = { id: "/subscriptions/s1", name: "Contoso Production", level: "subscription", parentId: MG.id, tenantId: "home" };
const LH: AzureScope = { id: "/subscriptions/s2", name: "Fabrikam", level: "subscription", parentId: MG.id, tenantId: "other" };
const RG: AzureScope = { id: "/subscriptions/s1/resourceGroups/rg-web", name: "rg-web", level: "resourceGroup", parentId: SUB.id };
const KV: AzureScope = { id: "/subscriptions/s1/resourceGroups/rg-web/providers/Microsoft.KeyVault/vaults/kv-web", name: "kv-web", level: "resource", parentId: RG.id, resourceType: "Microsoft.KeyVault/vaults" };
const SCOPES = [ROOT, MG, SUB, LH, RG, KV];
const OWNER = "8e3af657-a8ff-443c-a75c-2fe8c4bcb635";
const READER = "acdd72a7-3385-48ef-bd42-f606fba81ae7";

const assignment = (scopeId: string, extra: Partial<AzureAssignment> = {}): AzureAssignment => ({
    id: `a-${scopeId}`, scopeId, principalId: "P-1", principalName: "Adele Vance", principalType: "User", principalUpn: "adele@contoso.com",
    roleDefinitionId: OWNER, roleName: "Owner", state: "eligible", memberType: "direct", endDateTime: null, ...extra,
});
const row = (a: AzureAssignment, scope: AzureScope, extra: Partial<AzureAssignmentRow> = {}): AzureAssignmentRow => ({
    assignment: a, scope, isInherited: false, originText: "This scope", endText: "", principalTypeLabel: "User", ...extra,
});

const viewRows = [row(assignment(SUB.id), SUB), row(assignment(MG.id), MG, { isInherited: true })];
const allRows = [...viewRows, row(assignment(RG.id, { roleDefinitionId: READER, roleName: "Reader" }), RG)];
const EXPORTED = new Date("2026-10-24T10:00:00Z");
const READ_AT = "2026-10-24T09:55:00Z";
const loaded = (): AzurePolicyOutcome => ({ status: "loaded", rules: [], lastModified: null });

const data = (extra: Partial<AzureExportData> = {}): AzureExportData => ({
    view: { rows: viewRows, scope: SUB, filters: { ...DEFAULT_AZURE_FILTERS, query: "adele", status: "eligible" } },
    allRows,
    scopes: SCOPES,
    emergencyIds: new Set(),
    homeTenantId: "home",
    isLoading: false,
    outcomeOf: () => loaded(),
    meta: { tenantId: "t-1", tenantName: "Contoso", exporter: "Alex Wilber (alexw@contoso.com)", readAt: READ_AT, exportedAt: EXPORTED },
    ...extra,
});
const choice = (extra: Partial<AzureExportChoice> = {}): AzureExportChoice => ({ ...DEFAULT_AZURE_EXPORT_CHOICE, ...extra });
const fileOf = (plan: ReturnType<typeof planAzureExport>, id: string) => plan.files.find((f) => f.id === id)!;
const eligibleChip = getAzureFilterChips({ ...DEFAULT_AZURE_FILTERS, status: "eligible" })[0].label;

describe("planAzureExport", () => {
    it("offers both files by default", () => {
        const plan = planAzureExport(data(), choice());
        expect(plan.files.map((f) => f.name)).toEqual(["pim-azure-overview-assignments-2026-10-24.csv", "pim-azure-overview-role-settings-2026-10-24.csv"]);
        expect(fileOf(plan, "azureAssignments").count).toBe("2 rows");
    });

    it("exports every readable scope with the filter off", () => {
        const file = fileOf(planAzureExport(data(), choice({ applyFilter: false })), "azureAssignments");
        expect(file.count).toBe("3 rows");
        const lines = file.build().split("\r\n");
        expect(lines).toContain("# Scope: All scopes you can read");
        expect(lines).toContain("# Filter: none");
    });

    it("forces the filter while loading", () => {
        expect(fileOf(planAzureExport(data({ isLoading: true }), choice({ applyFilter: false })), "azureAssignments").count).toBe("2 rows");
    });

    it("writes the preamble", () => {
        const lines = fileOf(planAzureExport(data(), choice()), "azureAssignments").build().split("\r\n").slice(0, 6).map((l) => l.replace(/^"|"$/g, "").replace(/""/g, '"'));
        expect(lines).toEqual([
            "# Tenant: Contoso (t-1)",
            `# Data read: Azure ${formatDateTime(READ_AT)}`,
            "# Scope: Contoso Production, without inherited assignments",
            `# Filter: Search "adele", ${eligibleChip}`,
            "# Partial view: only the scopes your Azure roles let you read",
            `# Exported ${formatDateTime(EXPORTED)} by Alex Wilber (alexw@contoso.com)`,
        ]);
        const bare = azurePreamble(data({ meta: { tenantId: "t-1", exportedAt: EXPORTED } }), true, false);
        expect(bare[0]).toBe("# Tenant: t-1");
        expect(bare[1]).toBe("# Data read: unknown");
        expect(bare[5]).toBe(`# Exported ${formatDateTime(EXPORTED)}`);
    });

    it("leaves people out when anonymising", () => {
        const text = fileOf(planAzureExport(data(), choice({ anonymise: true })), "azureAssignments").build();
        expect(text).not.toContain(" by ");
        expect(text).not.toContain('Search "adele"');
        expect(text).not.toContain("Adele");
        expect(text).toContain("Person 1");
    });

    it("counts the pairs still to read", () => {
        const unread = data({ outcomeOf: () => undefined });
        expect(fileOf(planAzureExport(unread, choice()), "azureRoleSettings").count).toBe("2 rows, 2 to read");
        const withRoot = data({ outcomeOf: () => undefined, view: { ...unread.view, rows: [...viewRows, row(assignment(ROOT.id), ROOT)] } });
        const plan = planAzureExport(withRoot, choice());
        expect(plan.toRead).toBe(2);
        expect(fileOf(plan, "azureRoleSettings").count).toBe("3 rows, 2 to read");
        expect(fileOf(planAzureExport(data(), choice()), "azureRoleSettings").count).toBe("2 rows");
    });

    it("looks the outcomes up when it builds", () => {
        const read = new Map<string, AzurePolicyOutcome>();
        const key = (p: AzureRolePair) => `${p.scopeId}|${p.roleDefinitionId}`;
        const plan = planAzureExport(data({ outcomeOf: (p) => read.get(key(p)) }), choice());
        read.set(key(plan.pairs[0]), loaded());
        const lines = fileOf(plan, "azureRoleSettings").build().split("\r\n");
        expect(lines.some((l) => l.includes(",Loaded,"))).toBe(true);
        expect(lines.some((l) => l.includes(",Not loaded,"))).toBe(true);
    });

    it("builds only the chosen files", () => {
        const only = planAzureExport(data(), choice({ assignments: false }));
        expect(only.files.map((f) => f.id)).toEqual(["azureRoleSettings"]);
        const none = planAzureExport(data({ outcomeOf: () => undefined }), choice({ roleSettings: false }));
        expect(none.files.map((f) => f.id)).toEqual(["azureAssignments"]);
        expect(none.pairs).toEqual([]);
        expect(none.toRead).toBe(0);
    });
});

describe("parseStoredAzureChoice", () => {
    it("falls back to the default", () => {
        for (const raw of [null, "{", "[]"]) expect(parseStoredAzureChoice(raw)).toEqual(DEFAULT_AZURE_EXPORT_CHOICE);
        expect(parseStoredAzureChoice('{"anonymise": true, "applyFilter": "yes"}')).toEqual({ ...DEFAULT_AZURE_EXPORT_CHOICE, anonymise: true });
    });
});

describe("copied helpers", () => {
    it("leaves the search out on request", () => {
        const filters = { ...DEFAULT_AZURE_FILTERS, query: " web ", status: "eligible" as const };
        expect(describeAzureFilters(filters)).toBe(`Search "web", ${eligibleChip}`);
        expect(describeAzureFilters(filters, false)).toBe(eligibleChip);
        expect(describeAzureFilters({ ...DEFAULT_AZURE_FILTERS, query: "web" }, false)).toBe("None");
    });

    it("lists every assignment once, at its own scope, in tree order", () => {
        const items = [
            assignment(RG.id, { id: "3" }), assignment("/", { id: "1" }), assignment(SUB.id, { id: "2" }), assignment("/subscriptions/gone", { id: "9" }),
        ];
        const rows = allScopeRows(items, SCOPES);
        expect(rows.map((r) => r.assignment.id)).toEqual(["1", "2", "3"]);
        for (const r of rows) expect(r.isInherited).toBe(false);
        expect(buildAssignmentRows(items, SCOPES, SUB.id, EMPTY_AZURE_FILTERS)).toBeDefined();
    });
});
