import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkspaceSection } from "@/app/settings/components/WorkspaceSection";
import type { WorkspaceProps, WorkspaceStatusItem } from "@/app/settings/components/settingsTypes";

/** Invented data. The section renders from props only, so the test renders the markup without a browser. */
const noop = () => undefined;
const base: WorkspaceProps = {
    tenantLabel: "Contoso", step: "chosen", items: [], failedSubscriptions: [], listError: null, selectedCount: 0, manualDraft: "", manualError: null,
    consentMessage: null, isBusy: false, summary: { text: "Audit reads 2 workspaces", detail: "Entra reaches back to 12 May 2026, Azure to 9 Nov 2025." }, statuses: [],
    checkedLine: "Checked 5 Nov 2026, 12:00 UTC. Access is your own: a colleague may see this differently. A workspace shows what it holds, also on scopes your Azure roles do not reach.",
    onChoose: noop, onGrantAzure: noop, onToggle: noop, onShowManual: noop, onManualChange: noop, onUse: noop, onGrantLogAnalytics: noop,
    onCancel: noop, onRetryList: noop, onCheckAgain: noop, onRemoveAll: noop,
};

const render = (props: Partial<WorkspaceProps>) => renderToStaticMarkup(createElement(WorkspaceSection, { ...base, ...props }));
const iconCount = (html: string) => (html.match(/<svg/g) ?? []).length;

const STATUSES: WorkspaceStatusItem[] = [
    {
        customerId: "s1",
        name: "law-invented-entra. Keeps logs 180 days.",
        lines: [
            { tone: "ok", text: "Entra audit logs from 12 May 2026 to 5 Nov 2026." },
            { tone: "quiet", text: "Holds no Azure activity logs. That is fine: law-invented-activity does." },
        ],
    },
    {
        customerId: "s2",
        name: "law-invented-sec",
        lines: [{ tone: "warn", text: "Holds no Azure activity logs, so Azure stays at 90 days. Someone with access must send them with a diagnostic setting on each subscription." }],
    },
];

describe("the Log Analytics workspace section (AU-18)", () => {
    it("shows a quiet and a warning line under a workspace, each with its own icon and text", () => {
        const empty = render({ statuses: [] });
        const html = render({ statuses: STATUSES });
        expect(html).toContain("law-invented-entra. Keeps logs 180 days.");
        expect(html).toContain("Holds no Azure activity logs. That is fine: law-invented-activity does.");
        expect(html).toContain("Holds no Azure activity logs, so Azure stays at 90 days.");
        // One icon per line: three lines, three icons more than with no status
        expect(iconCount(html) - iconCount(empty)).toBe(3);
    });

    it("says both logs in the subline and the checking text, and nothing before a press", () => {
        const html = render({ step: "none" });
        expect(html).toContain("No workspaces chosen. Audit uses the Entra audit log and the Azure activity log.");
        expect(html).toContain("Optional. Without it, Audit shows up to 30 days on Entra and 90 days on Azure");
        expect(render({ step: "checking" })).toContain("Checking each workspace: can it be read, and which logs does it hold?");
    });

    it("marks a workspace that receives the Azure activity log with its own chip, next to the Entra one", () => {
        const html = render({
            step: "list",
            selectedCount: 1,
            items: [
                { customerId: "w1", name: "law-invented-entra", where: "Contoso-Security, West Europe.", receivesEntraLogs: true, receivesActivityLogs: false, isSelected: true },
                { customerId: "w2", name: "law-invented-activity", where: "Contoso-Security, West Europe.", receivesEntraLogs: false, receivesActivityLogs: true, isSelected: false },
            ],
        });
        expect(html).toContain("Receives Entra audit logs");
        expect(html).toContain("Receives Azure activity logs");
        expect(html.split("Receives Azure activity logs").length - 1).toBe(1);
    });
});
