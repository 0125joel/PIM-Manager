import { describe, expect, it } from "vitest";
import { allWorkspacesFailed, summarizeWorkspaceReads, workspaceNotice, type SummaryRead } from "@/utils/auditWorkspaceMerge";

/** A workspace without the table of one log is not a failure when another workspace was read (Joël, spec section 8) */
const A = { customerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "law-a" };
const B = { customerId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "law-b" };
const C = { customerId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", name: "law-c" };

const ok = (workspace: typeof A): SummaryRead => ({ workspace, ok: true, dropped: 0 });
const noTable = (workspace: typeof A): SummaryRead => ({ workspace, ok: false, reason: "no audit logs yet", noTable: true });
const denied = (workspace: typeof A): SummaryRead => ({ workspace, ok: false, reason: "403" });

describe("summarizing reads with a workspace that lacks one log", () => {
    it("counts a workspace without the table in neither failed nor total when another was read", () => {
        const summary = summarizeWorkspaceReads([ok(A), noTable(B)]);
        expect(summary).toMatchObject({ total: 1, read: 1, failed: [] });
        expect(workspaceNotice(summary, false)).toBeNull();
        expect(allWorkspacesFailed(summary)).toBe(false);
    });

    it("still counts a real failure next to a read workspace", () => {
        const summary = summarizeWorkspaceReads([ok(A), noTable(B), denied(C)]);
        expect(summary).toMatchObject({ total: 2, read: 1, failed: [{ name: "law-c", reason: "403" }] });
    });

    it("counts workspaces without the table as they do now when none was read: all without the table falls back, visibly", () => {
        const summary = summarizeWorkspaceReads([noTable(A), noTable(B)]);
        expect(summary).toMatchObject({ total: 2, read: 0, failed: [{ name: "law-a", reason: "no audit logs yet" }, { name: "law-b", reason: "no audit logs yet" }] });
        expect(allWorkspacesFailed(summary)).toBe(true);
        expect(workspaceNotice(summary, true)).not.toBeNull();
    });

    it("keeps the totals of reads that did not lack a table", () => {
        const summary = summarizeWorkspaceReads([ok(A), ok(B)]);
        expect(summary).toMatchObject({ total: 2, read: 2, failed: [] });
    });
});
