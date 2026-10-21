import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Client } from "@microsoft/microsoft-graph-client";
import type { Approver } from "@/types/directoryRole.types";
import type { GroupPimPolicy, PimGroupData } from "@/types/pimGroup.types";

const loadApprovers = vi.fn();
vi.mock("@/services/directoryRoleService", () => ({ loadApproversForRole: (...args: unknown[]) => loadApprovers(...args) }));
vi.mock("@/services/pimGroupService", () => ({ fetchAllPimGroupData: vi.fn(), refreshPimGroupAssignments: vi.fn() }));

import { fetchAllPimGroupData } from "@/services/pimGroupService";
import { applyGroupPolicyApprovers, findPoliciesNeedingApprovers, pimGroupsAdapter, resolveGroupPolicyApprovers, type GroupsContent } from "@/workloads/pimGroupsAdapter";
import type { WorkloadRunContext } from "@/workloads/types";

const approvalRule = (approvers: object[]) => ({
    id: "Approval_EndUser_Assignment",
    "@odata.type": "#microsoft.graph.unifiedRoleManagementPolicyApprovalRule",
    setting: { isApprovalRequired: true, approvalStages: [{ primaryApprovers: approvers }] },
});

const policy = (groupId: string, policyType: "member" | "owner", approvers: object[] | null, extra: Partial<GroupPimPolicy> = {}): GroupPimPolicy => ({
    id: `${groupId}-${policyType}`,
    groupId,
    policyType,
    rules: approvers === null ? [] : [approvalRule(approvers)],
    ...extra,
});

const group = (id: string, policies: { member?: GroupPimPolicy; owner?: GroupPimPolicy } | undefined): PimGroupData => ({
    group: { id, displayName: id, groupType: "security" },
    assignments: [],
    isManaged: policies !== undefined,
    policies,
});

const userApprover = { "@odata.type": "#microsoft.graph.singleUser", userId: "u1" };
const resolved = [{ id: "u1", displayName: "Anna", type: "user" }] as unknown as Approver[];

describe("findPoliciesNeedingApprovers", () => {
    it("finds Member and Owner policies that name approvers and have no resolved list", () => {
        const data = [
            group("g1", { member: policy("g1", "member", [userApprover]), owner: policy("g1", "owner", [userApprover]) }),
            group("g2", { member: policy("g2", "member", []) }),
            group("g3", { member: policy("g3", "member", null) }),
            group("g4", undefined),
        ];
        expect(findPoliciesNeedingApprovers(data).map((p) => `${p.groupId}:${p.policyType}`)).toEqual(["g1:member", "g1:owner"]);
    });

    it("leaves a policy alone that already has its approvers, even an empty list", () => {
        const data = [group("g1", { member: policy("g1", "member", [userApprover], { approvers: resolved }), owner: policy("g1", "owner", [userApprover], { approvers: [] }) })];
        expect(findPoliciesNeedingApprovers(data)).toEqual([]);
    });
});

describe("applyGroupPolicyApprovers", () => {
    const content = (): GroupsContent => ({ data: [group("g1", { member: policy("g1", "member", [userApprover]), owner: policy("g1", "owner", [userApprover]) }), group("g2", undefined)], extras: undefined });

    it("lands the approvers on the policy of the right relation and leaves the rest alone", () => {
        const before = content();
        const after = applyGroupPolicyApprovers(before, "g1", "owner", resolved);
        expect(after.data[0].policies?.owner?.approvers).toBe(resolved);
        expect(after.data[0].policies?.member?.approvers).toBeUndefined();
        expect(after.data[1]).toBe(before.data[1]);
        expect(before.data[0].policies?.owner?.approvers).toBeUndefined();
    });

    it("ignores a group or policy that is not loaded", () => {
        const before = content();
        expect(applyGroupPolicyApprovers(before, "zzz", "member", resolved)).toBe(before);
        expect(applyGroupPolicyApprovers(before, "g2", "member", resolved)).toBe(before);
    });
});

describe("resolveGroupPolicyApprovers", () => {
    beforeEach(() => loadApprovers.mockReset());

    it("resolves each policy with the role approver loader and patches the result onto it", async () => {
        loadApprovers.mockResolvedValue(resolved);
        let current: GroupsContent = { data: [group("g1", { member: policy("g1", "member", [userApprover]) })], extras: undefined };
        const patch = (updater: (c: GroupsContent) => GroupsContent) => { current = updater(current); };
        const pending = findPoliciesNeedingApprovers(current.data);

        await resolveGroupPolicyApprovers({} as Client, pending, patch, new AbortController().signal);

        expect(loadApprovers).toHaveBeenCalledTimes(1);
        expect(current.data[0].policies?.member?.approvers).toBe(resolved);
        expect(findPoliciesNeedingApprovers(current.data)).toEqual([]);
    });

    it("leaves the ids when a lookup fails and keeps going", async () => {
        loadApprovers.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(resolved);
        let current: GroupsContent = { data: [group("g1", { member: policy("g1", "member", [userApprover]) }), group("g2", { member: policy("g2", "member", [userApprover]) })], extras: undefined };
        const patch = (updater: (c: GroupsContent) => GroupsContent) => { current = updater(current); };

        await resolveGroupPolicyApprovers({} as Client, findPoliciesNeedingApprovers(current.data), patch, new AbortController().signal);

        const resolvedGroups = current.data.filter((g) => g.policies?.member?.approvers !== undefined);
        expect(resolvedGroups).toHaveLength(1);
    });
});

describe("pimGroupsAdapter.run", () => {
    beforeEach(() => loadApprovers.mockReset());

    it("returns the groups without a background phase and lands the approvers afterwards through patch", async () => {
        loadApprovers.mockResolvedValue(resolved);
        const loaded = [group("g1", { member: policy("g1", "member", [userApprover]) })];
        vi.mocked(fetchAllPimGroupData).mockResolvedValue(loaded);
        let current: GroupsContent = { data: [], extras: undefined };
        const ctx = {
            client: {} as Client,
            signal: new AbortController().signal,
            force: true,
            current: () => current,
            progress: () => undefined,
            backgroundProgress: () => undefined,
            message: () => undefined,
            setBlocking: () => undefined,
            patch: (updater: (c: GroupsContent) => GroupsContent) => { current = updater(current); },
        } as unknown as WorkloadRunContext<PimGroupData, undefined>;

        const outcome = await pimGroupsAdapter.run(ctx);
        // The engine applies the outcome before the first lookup starts
        current = { data: outcome.data, extras: undefined };

        expect(outcome.background).toBeUndefined();
        expect(outcome.data).toBe(loaded);
        await vi.waitFor(() => expect(current.data[0].policies?.member?.approvers).toBe(resolved));
    });

    it("starts no lookup when no policy names approvers", async () => {
        vi.mocked(fetchAllPimGroupData).mockResolvedValue([group("g1", { member: policy("g1", "member", null) })]);
        const outcome = await pimGroupsAdapter.run({ client: {} as Client, signal: new AbortController().signal, force: true, current: () => ({ data: [], extras: undefined }), progress: () => undefined, patch: () => undefined } as unknown as WorkloadRunContext<PimGroupData, undefined>);
        expect(outcome.data).toHaveLength(1);
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(loadApprovers).not.toHaveBeenCalled();
    });
});
