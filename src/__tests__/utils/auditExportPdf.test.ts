import { createElement, type ReactElement } from "react";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Font, pdf, type DocumentProps } from "@react-pdf/renderer";
import { AuditReportDocument } from "@/components/pdf/AuditReportDocument";
import { buildDemoAuditRows } from "@/demo/contoso/audit";
import { demoGuid } from "@/demo/contoso/ids";
import { planAuditExport } from "@/utils/auditExportPlan";
import { mapAuditEvents } from "@/utils/auditEvents";

/**
 * Draws the Audit report from the Contoso demo events with the real renderer, so a broken document fails here and not in the
 * browser. Set AUDIT_PDF_OUT to a folder outside the repository to keep the file for a look.
 */
const NOW = new Date("2026-11-05T12:00:00Z");
const FONTS = path.resolve(import.meta.dirname, "../../../public/fonts");

async function render(replaceNames: boolean): Promise<Buffer> {
    Font.register({
        family: "IBM Plex Sans",
        fonts: [
            { src: path.join(FONTS, "plex-sans-400.woff"), fontWeight: 400 },
            { src: path.join(FONTS, "plex-sans-600.woff"), fontWeight: 600 },
        ],
    });
    Font.register({ family: "IBM Plex Mono", src: path.join(FONTS, "plex-mono-400.woff") });
    Font.registerHyphenationCallback((word) => [word]);
    // As the page does with its default filters: no System rows, so the heading below is true
    const events = mapAuditEvents(buildDemoAuditRows(NOW)).filter((event) => event.kind !== "system");
    const file = planAuditExport({
        events,
        period: { from: new Date("2026-10-06T11:58:00Z"), to: new Date("2026-11-05T11:58:00Z") },
        filterSentence: "System events off",
        searchTerm: "",
        readAt: "2026-11-05T11:58:00Z",
        oldestAvailable: new Date("2026-10-06T11:58:00Z"),
        source: "graph",
        tenant: { id: "3f2a91c4-7d1e-4b6a-9e0f-5c8d2a1b7e63", name: "Contoso" },
        exporter: "Alex Wilber (alexw@contoso.com)",
        emergencyIds: new Set([demoGuid("user:bg01").toLowerCase()]),
        exportedAt: new Date("2026-11-05T12:05:00Z"),
    }, { format: "pdf", replaceNames });
    if (file.format !== "pdf") throw new Error("pdf expected");
    const stream = await pdf(createElement(AuditReportDocument, { data: file.pdf, version: "v3.2.0" }) as unknown as ReactElement<DocumentProps>).toBuffer();
    const chunks: Buffer[] = [];
    for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
}

const pageCount = (bytes: Buffer): number => (bytes.toString("latin1").match(/\/Type \/Page(?!s)/g) ?? []).length;

describe("AuditReportDocument", () => {
    it("renders a PDF from the demo events", async () => {
        const bytes = await render(false);
        expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
        expect(pageCount(bytes)).toBeGreaterThanOrEqual(1);
        const out = process.env.AUDIT_PDF_OUT;
        if (out) {
            mkdirSync(out, { recursive: true });
            writeFileSync(path.join(out, "pim-audit-contoso-2026-11-05.pdf"), bytes);
            writeFileSync(path.join(out, "pages.txt"), `${pageCount(bytes)}\n`);
        }
    }, 30_000);

    it("renders with replaced names too", async () => {
        const bytes = await render(true);
        expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    }, 30_000);
});
