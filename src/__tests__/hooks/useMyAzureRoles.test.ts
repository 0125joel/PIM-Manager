import { beforeEach, describe, expect, it, vi } from "vitest";
import { WORKLOAD_SCOPES } from "@/hooks/useIncrementalConsent";
import { useMyAzureRoles } from "@/hooks/useMyAzureRoles";
import { listMyAssignments, listMyEligibilities } from "@/services/azureAssignmentService";
import { lookupPrincipals } from "@/services/principalLookupService";
import { fetchMyGroupInstances } from "@/services/writeAccessService";
import { renderHook } from "../support/hookHarness";

/** The own-roles hook through the hook harness: the reads are replaced, nothing reaches a tenant */

const state = vi.hoisted(() => ({ consented: true }));
const getGraphClient = vi.hoisted(() => vi.fn(async () => ({ graph: true })));

vi.mock("react", async () => await import("../support/hookHarness"));
vi.mock("@/contexts/AzureContext", () => ({ useAzureActions: () => ({ getArmClient: () => ({ arm: true }) }) }));
vi.mock("@/contexts/UnifiedPimContext", () => ({ useUnifiedActions: () => ({ getGraphClient }) }));
vi.mock("@/hooks/usePimSelectors", () => ({ usePimGroupsConsented: () => state.consented }));
vi.mock("@/services/azureAssignmentService", () => ({ listMyAssignments: vi.fn(), listMyEligibilities: vi.fn() }));
vi.mock("@/services/principalLookupService", () => ({ lookupPrincipals: vi.fn() }));
vi.mock("@/services/writeAccessService", () => ({ fetchMyGroupInstances: vi.fn() }));

const instance = (name: string, memberType: "Direct" | "Group") => ({
    id: `/subscriptions/s1/providers/Microsoft.Authorization/roleAssignmentScheduleInstances/${name}`,
    name,
    type: "Microsoft.Authorization/roleAssignmentScheduleInstances",
    properties: {
        scope: "/subscriptions/s1",
        roleDefinitionId: "/providers/Microsoft.Authorization/roleDefinitions/b24988ac-6180-42a0-ab88-20f7382dd24c",
        principalId: "p1",
        principalType: memberType === "Group" ? "Group" : "User",
        memberType,
        status: "Provisioned",
        endDateTime: null,
        ...(memberType === "Group" ? { expandedProperties: { principal: { id: "p1", displayName: "Readers", type: "Group" } } } : {}),
    },
});

const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

beforeEach(() => {
    vi.clearAllMocks();
    state.consented = true;
    vi.mocked(listMyAssignments).mockResolvedValue([instance("a1", "Group")] as never);
    vi.mocked(listMyEligibilities).mockResolvedValue([] as never);
    vi.mocked(fetchMyGroupInstances).mockResolvedValue([] as never);
    vi.mocked(lookupPrincipals).mockResolvedValue({ byId: new Map(), byUpn: new Map() });
});

describe("useMyAzureRoles", () => {
    it("without the PIM for Groups consent says so and makes no Graph call", async () => {
        state.consented = false;
        const hook = renderHook(() => useMyAzureRoles(true));
        await settle();
        const result = hook.result;
        if (result === null || result === "failed") throw new Error("not loaded");
        expect(result.groups).toEqual({ kind: "noConsent" });
        expect(result.active[0].viaGroup).toBe("Readers");
        expect(getGraphClient).not.toHaveBeenCalled();
        expect(fetchMyGroupInstances).not.toHaveBeenCalled();
    });

    it("lists the eligible groups with their names", async () => {
        vi.mocked(fetchMyGroupInstances).mockImplementation((async (_client: unknown, kind: string) => (kind === "eligibility" ? [{ groupId: "g1", accessId: "member", endDateTime: null }] : [])) as never);
        vi.mocked(lookupPrincipals).mockResolvedValue({ byId: new Map([["g1", { id: "g1", kind: "group", displayName: "Network Operators" }]]), byUpn: new Map() } as never);
        const hook = renderHook(() => useMyAzureRoles(true));
        await settle();
        const result = hook.result;
        if (result === null || result === "failed") throw new Error("not loaded");
        expect(result.groups).toEqual({ kind: "listed", groups: [{ groupId: "g1", groupName: "Network Operators", endText: "Permanent", isPermanent: true }] });
        // The workload's read scope, as the access check asks for it; the login set may not carry it
        expect(getGraphClient).toHaveBeenCalledWith(WORKLOAD_SCOPES.pimGroups);        // The read gets the effect's signal, so leaving the page stops it
        expect(fetchMyGroupInstances).toHaveBeenCalledWith(expect.anything(), "eligibility", expect.any(AbortSignal));
        expect(fetchMyGroupInstances).toHaveBeenCalledWith(expect.anything(), "assignment", expect.any(AbortSignal));
    });

    it("a Graph error gives failed groups while the Azure rows stay", async () => {
        vi.mocked(fetchMyGroupInstances).mockRejectedValue(Object.assign(new Error("denied"), { statusCode: 403 }));
        const hook = renderHook(() => useMyAzureRoles(true));
        await settle();
        const result = hook.result;
        if (result === null || result === "failed") throw new Error("not loaded");
        expect(result.groups).toEqual({ kind: "failed" });
        expect(result.active).toHaveLength(1);
    });

    it("an ARM error is still failed", async () => {
        vi.mocked(listMyAssignments).mockRejectedValue(new Error("down"));
        const hook = renderHook(() => useMyAzureRoles(true));
        await settle();
        expect(hook.result).toBe("failed");
    });

    it("reads nothing while disabled", async () => {
        const hook = renderHook(() => useMyAzureRoles(false));
        await settle();
        expect(hook.result).toBeNull();
        expect(listMyAssignments).not.toHaveBeenCalled();
    });
});
