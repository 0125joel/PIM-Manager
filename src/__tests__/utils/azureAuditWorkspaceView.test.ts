import { azureAuditDefaultDays } from "@/hooks/useAzureAuditUrlState";
import { describe, expect, it } from "vitest";
import type { AuditEvent } from "@/types/audit.types";
import type { PimGroupData } from "@/types/pimGroup.types";
import type { WorkspaceSummary } from "@/utils/auditWorkspaceMerge";
import { auditDetailRows } from "@/utils/auditView";
import {
    azureApproverNote,
    azureAuditCoverage,
    azureGroupLogNotice,
    azureWorkspaceLimits,
    azureWorkspaceNotice,
} from "@/utils/azureAuditView";
import { buildAzureNoActivationRows } from "@/utils/azureNoActivation";

const DAY = 86_400_000;
const NOW = new Date("2026-11-07T12:00:00.000Z");

const summary = (patch: Partial<WorkspaceSummary> = {}): WorkspaceSummary => ({ total: 2, read: 2, failed: [], dropped: 0, otherTenant: 0, graphOnly: 0, graphFailure: null, ...patch });

describe("the coverage line with a chosen workspace", () => {
    it("names the workspaces that were read, and how many of them", () => {
        expect(azureAuditCoverage([], "read", { summary: summary(), sendingSubscriptionIds: null, readableSubscriptionIds: [], days: 30 }).label)
            .toBe("Azure activity log, PIM requests and 2 workspaces");
        expect(azureAuditCoverage([], "read", { summary: summary({ read: 1, total: 1 }), sendingSubscriptionIds: null, readableSubscriptionIds: [], days: 30 }).label)
            .toBe("Azure activity log, PIM requests and 1 workspace");
        expect(azureAuditCoverage([], "read", { summary: summary({ total: 3, read: 2, failed: [{ name: "law-c", reason: "403" }] }), sendingSubscriptionIds: null, readableSubscriptionIds: [], days: 30 }).label)
            .toBe("Azure activity log, PIM requests and 2 of 3 workspaces");
    });

    it("says where events older than 90 days come from, when the period is longer than 90 days", () => {
        const subs = ["s-1", "s-2", "s-3"];
        const older = (days: number, sending: string[] | null) => azureAuditCoverage([], "read", {
            summary: summary(), sendingSubscriptionIds: sending === null ? null : new Set(sending), readableSubscriptionIds: subs, days,
        }).notes;
        expect(older(90, ["s-1"])).not.toContain("Older than 90 days only from the 1 subscriptions that send to a workspace.");
        expect(older(180, ["s-1", "s-2"])).toContain("Older than 90 days only from the 2 subscriptions that send to a workspace.");
        expect(older(180, ["s-1", "s-2", "s-3"])).toContain("Older than 90 days from every subscription you can read.");
        expect(older(180, null)).toContain("Older than 90 days only from the subscriptions that send to a workspace.");
        expect(older(180, ["s-1"])).toContain("Older than 90 days only from the 1 subscription that sends to a workspace.");
        expect(older(180, [])).toContain("The Azure activity log stops at 90 days: no chosen workspace holds it.");
    });

    it("keeps the sentence that Azure leaves out what the roles cannot see, last, and adds the workspace sentences in order", () => {
        const { notes } = azureAuditCoverage([], "read", { summary: summary(), sendingSubscriptionIds: null, readableSubscriptionIds: [], days: 180 });
        const shows = notes.indexOf("A workspace shows what it holds, also on scopes your roles do not reach.");
        const older = notes.findIndex((note) => note.startsWith("Older than 90 days"));
        expect(older).toBeGreaterThanOrEqual(0);
        expect(older).toBeLessThan(shows);
        expect(notes[notes.length - 1]).toBe("Azure leaves out what your roles cannot see.");
        expect(notes).toContain("A workspace holds what the diagnostic export delivered and can miss events.");
    });
});

describe("the notices of the workspaces", () => {
    it("some failed: the title counts them, and the detail names the reasons", () => {
        const notice = azureWorkspaceNotice(summary({ total: 3, read: 2, failed: [{ name: "law-c", reason: "403" }] }), false);
        expect(notice).toEqual({
            title: "1 of 3 workspaces could not be read",
            detail: "(403 on law-c). Events stored only there are missing from this list and from an export.",
        });
    });

    it("all failed: its own title and the 90 days of the Azure activity log, not the 30 days of Entra", () => {
        const notice = azureWorkspaceNotice(summary({ total: 2, read: 0, failed: [{ name: "law-a", reason: "403" }, { name: "law-b", reason: "403" }] }), true);
        expect(notice?.title).toBe("The workspaces could not be read");
        expect(notice?.detail).toBe("(403 on all 2 workspaces). Showing up to 90 days from the Azure activity log instead.");
        expect(notice?.detail).not.toContain("Entra");
    });

    it("nothing is said when every workspace was read and no row was dropped", () => {
        expect(azureWorkspaceNotice(summary(), false)).toBeNull();
    });

    it("gives each failed workspace one line for No activation", () => {
        expect(azureWorkspaceLimits(summary({ total: 2, read: 1, failed: [{ name: "law-c", reason: "403" }] }), false))
            .toEqual(["law-c could not be read, so an activation stored only there is not in the data."]);
        expect(azureWorkspaceLimits(summary({ total: 2, read: 0, failed: [{ name: "law-c", reason: "403" }] }), true)).toEqual([]);
    });

    it("tells one log that was refused on a workspace whose other log was read", () => {
        const failures = [{ name: "law-a", log: "Azure activity log" as const, reason: "403" }];
        const notice = azureWorkspaceNotice(summary(), false, failures);
        expect(notice?.title).toBe("A log of a workspace could not be read");
        expect(notice?.detail).toBe("(403 on the Azure activity log of law-a). Events stored only there are missing from this list and from an export.");
        expect(azureWorkspaceLimits(summary(), false, failures)).toEqual(["The Azure activity log of law-a could not be read, so an activation stored only there is not in the data."]);
    });

    it("tells rows of another tenant and a Graph check that failed, as the Entra page does", () => {
        expect(azureWorkspaceNotice(summary({ otherTenant: 2 }), false)).toEqual({ title: "Not all rows are shown", detail: "2 rows belong to another tenant or name none, and are left out." });
        expect(azureWorkspaceNotice(summary({ graphFailure: "no permission" }), false)?.title).toBe("The last 30 days could not be checked against the Entra audit log");
    });
});

describe("the period the page opens on", () => {
    it("is 30 days, and 180 when a workspace reaches beyond the native 90, as on Entra", () => {
        expect(azureAuditDefaultDays()).toBe(30);
        expect(azureAuditDefaultDays(90)).toBe(30);
        expect(azureAuditDefaultDays(120)).toBe(120);
        expect(azureAuditDefaultDays(365)).toBe(180);
    });
});

describe("the 30 days that are no longer always 30", () => {
    it("the group notice follows the reach of the Entra audit log of this read", () => {
        expect(azureGroupLogNotice("read", 60, true, 30)?.title).toBe("Activity through a group goes back 30 days.");
        expect(azureGroupLogNotice("read", 60, true, 60)).toBeNull();
        expect(azureGroupLogNotice("read", 120, true, 60)?.title).toBe("Activity through a group goes back 60 days.");
        expect(azureGroupLogNotice("read", 120, true, 60)?.detail).toContain("which reaches back 60 days here");
    });

    it("the approver note follows the reach too", () => {
        const event = { id: "e", time: new Date(NOW.getTime() - 45 * DAY).toISOString(), hadApproval: true, requestOnly: false } as AuditEvent;
        expect(azureApproverNote(event, "read", NOW, 30)).toBe("The Entra audit log keeps 30 days, so the approver of this request is no longer there.");
        expect(azureApproverNote(event, "read", NOW, 60)).toBeNull();
    });

    it("a member of a group that holds a role is not judged beyond the reach of the Entra audit log, and the text names that reach", () => {
        const groupHolds = {
            id: "a4", scopeId: "/subscriptions/s-1", principalId: "g1", principalName: "Platform", principalType: "Group", roleDefinitionId: "role-1", roleName: "Reader", state: "active", memberType: "direct", endDateTime: null,
        } as const;
        const pimGroup = {
            group: { id: "g1", displayName: "Platform" },
            assignments: [{ id: "m-p1", groupId: "g1", principalId: "p1", principal: { displayName: "Alex Wilber", "@odata.type": "#microsoft.graph.user" }, accessType: "member", assignmentType: "eligible" }],
        } as unknown as PimGroupData;
        const build = (entraLogDays: number, days: number) => buildAzureNoActivationRows({
            assignments: [groupHolds], events: [], scopes: [{ id: "/subscriptions/s-1", name: "s-1", level: "subscription", parentId: null }], days, now: NOW, entraLog: "read", pimGroups: [pimGroup], entraLogDays,
        });
        const beyond = (rows: ReturnType<typeof build>) => rows.find((row) => row.who === "Alex Wilber");
        expect(beyond(build(60, 120))).toMatchObject({ state: "not-read", activationText: "Not judged: the Entra audit log reaches back 60 days and this period is longer" });
        expect(beyond(build(30, 120))).toMatchObject({ activationText: "Not judged: the Entra audit log reaches back 30 days and this period is longer" });
        // Within the reach the member is judged, not told as not judged
        expect(beyond(build(120, 120))?.activationText).not.toContain("Not judged");
    });
});

describe("the auditView line of an Azure event from a workspace", () => {
    it("names the workspace, and falls back to the label when no name is known", () => {
        const base = { id: "e", time: NOW.toISOString(), kind: "assignment", environment: "role", sentence: "s", actor: { name: "a", id: "a", kind: "person" }, role: { name: "Reader", id: "r" }, scope: "s-1", result: "success", source: "azure-workspace", correlationId: "c", azure: { scopeId: "/subscriptions/s-1", scopeName: "s-1", scopeLevel: "subscription", subscriptionId: "s-1" } } as AuditEvent;
        const format = { timeZone: "UTC", locale: "en-GB" };
        const named = auditDetailRows({ ...base, workspace: "law-a" } as AuditEvent, true, false, format);
        expect(named.find((row) => row.label === "Source")?.value).toBe("Workspace law-a");
        const unnamed = auditDetailRows(base, true, false, format);
        expect(unnamed.find((row) => row.label === "Source")?.value).toBe("Log Analytics workspace");
    });
});
