import { createElement, type ReactElement } from "react";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Font, pdf, type DocumentProps } from "@react-pdf/renderer";
import { NoActivationReportDocument } from "@/components/pdf/NoActivationReportDocument";
import { buildIdleEvents, buildIdleGroups, buildIdleMembership, buildIdleRoles, IDLE_EMERGENCY_IDS, IDLE_NOW } from "@/app/dev/audit/idleData";
import { buildNoActivationRows, countNoActivation, noActivationHonesty } from "@/utils/auditNoActivation";
import { describeNoActivationFilter, planNoActivationExport, type NoActivationExportInput } from "@/utils/auditExportPlan";

const FONTS = path.resolve(import.meta.dirname, "../../../public/fonts");

const rows = buildNoActivationRows({ roles: buildIdleRoles(), groups: buildIdleGroups(), events: buildIdleEvents(), days: 30, now: IDLE_NOW, emergencyIds: IDLE_EMERGENCY_IDS, format: { timeZone: "UTC", locale: "en-GB" }, membership: buildIdleMembership() });
const counts = countNoActivation(rows);

const INPUT: NoActivationExportInput = {
    rows,
    honesty: noActivationHonesty(counts),
    period: { from: new Date("2026-10-06T12:00:00Z"), to: new Date("2026-11-05T11:58:00Z") },
    filterSentence: describeNoActivationFilter({ env: "both" }),
    searchTerm: "isaiah",
    readAt: "2026-11-05T11:58:00Z",
    oldestAvailable: new Date("2026-10-06T11:58:00Z"),
    source: "graph",
    tenant: { id: "3f2a91c4-7d1e-4b6a-9e0f-5c8d2a1b7e63", name: "Contoso" },
    exporter: "Alex Wilber (alex.wilber@contoso.example)",
    notRead: "PIM for Groups is not included: read access has not been granted. The members of this group could not be read, so their rows are not judged: Contoso-Mail-Ops.",
    exportedAt: new Date("2026-11-05T12:05:00Z"),
};

const NAMES = [...new Set(rows.filter((row) => row.isPerson).map((row) => row.who))];
const IDS = [...new Set(rows.filter((row) => row.isPerson).map((row) => row.whoId))];

describe("the No activation CSV and JSON", () => {
    it("writes the heading with the honesty text and the columns of the brief", () => {
        const file = planNoActivationExport(INPUT, { format: "csv", replaceNames: false });
        if (file.format !== "csv") throw new Error("csv expected");
        const lines = file.content.split("\r\n");
        expect(file.fileName).toBe("pim-audit-contoso-2026-11-05-no-activation.csv");
        expect(lines[0]).toContain("Tenant: Contoso");
        expect(file.content).toContain(INPUT.honesty);
        expect(file.content).toContain("Not read: PIM for Groups is not included");
        expect(file.content).toContain("Contoso-Mail-Ops");
        const header = lines.find((line) => line.startsWith("Role or group,"));
        expect(header).toBe("Role or group,Role id,Scope,Who,Who id,Through group,Type,State,Activation,Last activated (UTC),Assigned (UTC),Ends (UTC),Emergency access");
        expect(file.content).toContain("None in this period");
        expect(file.content).toContain("Not applicable: never activates");
    });

    it("writes JSON with the same columns and the honesty text", () => {
        const file = planNoActivationExport(INPUT, { format: "json", replaceNames: false });
        if (file.format !== "json") throw new Error("json expected");
        const parsed = JSON.parse(file.content) as { meta: { honesty: string; view: string; assignmentCount: number }; assignments: Record<string, unknown>[] };
        expect(parsed.meta.honesty).toBe(INPUT.honesty);
        expect(parsed.meta.assignmentCount).toBe(rows.length);
        expect(Object.keys(parsed.assignments[0])).toContain("Who id");
    });

    it("leaves no person name or id in CSV, JSON or PDF data when names are replaced", () => {
        for (const format of ["csv", "json", "pdf"] as const) {
            const file = planNoActivationExport(INPUT, { format, replaceNames: true });
            const text = file.format === "pdf" ? JSON.stringify(file.pdf) : file.content;
            for (const value of [...NAMES, ...IDS.map((id) => id.toLowerCase()), ...IDS, "alex.wilber@contoso.example", "isaiah"]) {
                expect(text.toLowerCase(), `${format}: ${value}`).not.toContain(value.toLowerCase());
            }
            expect(text).toContain("User 1");
        }
    });

    it("gives every row a State in the words of the sentence, a Scope, and the group a member is eligible through", () => {
        const file = planNoActivationExport(INPUT, { format: "json", replaceNames: false });
        if (file.format !== "json") throw new Error("json expected");
        const parsed = JSON.parse(file.content) as { assignments: Record<string, string>[] };
        expect(parsed.assignments).toHaveLength(rows.length);
        const words = new Set(["no activation", "assigned during the period", "activated", "does not activate", "not judged"]);
        for (const assignment of parsed.assignments) {
            expect(words.has(assignment.State), assignment.State).toBe(true);
            expect(assignment.Scope).toBeTruthy();
        }
        expect(parsed.assignments.some((a) => a.Scope === "Contoso Sales")).toBe(true);
        expect(parsed.assignments.some((a) => a["Through group"] === "Contoso-Helpdesk")).toBe(true);
        const byState = (word: string) => parsed.assignments.filter((a) => a.State === word).length;
        expect([byState("no activation"), byState("assigned during the period"), byState("activated"), byState("does not activate"), byState("not judged")]).toEqual([counts.none, counts.new, counts.activated, counts.na, counts.notRead]);
    });

    it("keeps role and group names when names are replaced", () => {
        const file = planNoActivationExport(INPUT, { format: "csv", replaceNames: true });
        if (file.format !== "csv") throw new Error("csv expected");
        expect(file.content).toContain("Security Administrator");
        expect(file.content).toContain("Member of Contoso-Finance-Admins");
        expect(file.content).not.toContain("Who id");
    });
});

describe("the No activation PDF data", () => {
    it("holds the totals, the rows, the honesty text and the closing note", () => {
        const file = planNoActivationExport(INPUT, { format: "pdf", replaceNames: false });
        if (file.format !== "pdf") throw new Error("pdf expected");
        expect(file.fileName).toBe("pim-audit-contoso-2026-11-05-no-activation.pdf");
        expect(file.pdf.totals.map((total) => total.label)).toEqual(["No activation", "Assigned in the period", "Activated", "Do not activate", "Not judged"]);
        expect(file.pdf.totals.map((total) => total.value)).toEqual([counts.none, counts.new, counts.activated, counts.na, counts.notRead]);
        // The five groups add up to the rows of the table
        const drawn = file.pdf.sections.flatMap((section) => section.rows);
        expect(file.pdf.totals.reduce((sum, total) => sum + total.value, 0)).toBe(drawn.length);
        expect(drawn).toHaveLength(rows.length);
        expect(file.pdf.meta.find((item) => item.label === "Reading this")?.value).toBe(INPUT.honesty);
        expect(file.pdf.closingNote).toContain("cannot prove it was not changed afterwards");
    });

    it("puts every row under its own verdict, the warnings first, and says the verdict once", () => {
        const file = planNoActivationExport(INPUT, { format: "pdf", replaceNames: false });
        if (file.format !== "pdf") throw new Error("pdf expected");
        const { sections } = file.pdf;
        const order = ["none", "new", "notRead", "activated", "na"];
        expect(sections.map((section) => section.group)).toEqual(order.filter((group) => counts[group as keyof typeof counts] > 0));
        for (const section of sections) expect(section.rows).toHaveLength(counts[section.group]);
        const last = sections.find((section) => section.group === "na");
        expect(last?.rows.map((row) => row.activation)).toContain("Never activates");
        expect(JSON.stringify(last)).not.toContain("Not applicable");
        // Emergency access and the group are their own lines, so they stay whatever the name is
        expect(sections.flatMap((section) => section.rows).filter((row) => row.isEmergency)).toHaveLength(rows.filter((row) => row.isEmergency).length);
        expect(sections.flatMap((section) => section.rows).filter((row) => row.via)).toHaveLength(rows.filter((row) => row.viaGroup).length);
    });

    it("names one shared scope in the facts, and the scope of each row as soon as they differ", () => {
        const planOf = (scopeNames: string[]) => {
            const file = planNoActivationExport({ ...INPUT, rows: scopeNames.map((scopeName) => ({ ...rows[0], scopeName })) }, { format: "pdf", replaceNames: false });
            if (file.format !== "pdf") throw new Error("pdf expected");
            return file.pdf;
        };
        const same = planOf(["Directory", "Directory"]);
        expect(same.meta.find((item) => item.label === "Scope")?.value).toBe("Directory, for every assignment");
        expect(same.sections.flatMap((section) => section.rows.map((row) => row.scope))).toEqual([undefined, undefined]);
        const mixed = planOf(["Directory", "Admin unit Sales"]);
        expect(mixed.meta.find((item) => item.label === "Scope")?.value).toBe("Directory, unless a row names another");
        expect(mixed.sections.flatMap((section) => section.rows.map((row) => row.scope))).toEqual([undefined, "Admin unit Sales"]);
        const azure = planOf(["Contoso Production", "Contoso Sandbox"]);
        expect(azure.meta.some((item) => item.label === "Scope")).toBe(false);
        expect(azure.sections.flatMap((section) => section.rows.map((row) => row.scope))).toEqual(["Contoso Production", "Contoso Sandbox"]);
    });
});

async function render(replaceNames: boolean, input: NoActivationExportInput = INPUT): Promise<Buffer> {
    Font.register({
        family: "IBM Plex Sans",
        fonts: [
            { src: path.join(FONTS, "plex-sans-400.woff"), fontWeight: 400 },
            { src: path.join(FONTS, "plex-sans-600.woff"), fontWeight: 600 },
        ],
    });
    Font.register({ family: "IBM Plex Mono", src: path.join(FONTS, "plex-mono-400.woff") });
    Font.registerHyphenationCallback((word) => [word]);
    const file = planNoActivationExport(input, { format: "pdf", replaceNames });
    if (file.format !== "pdf") throw new Error("pdf expected");
    const stream = await pdf(createElement(NoActivationReportDocument, { data: file.pdf, version: "v3.2.0" }) as unknown as ReactElement<DocumentProps>).toBuffer();
    const chunks: Buffer[] = [];
    for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
}

const pageCount = (bytes: Buffer): number => (bytes.toString("latin1").match(/\/Type \/Page(?!s)/g) ?? []).length;

describe("NoActivationReportDocument", () => {
    it("renders a PDF with the real renderer", async () => {
        const bytes = await render(false);
        expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
        expect(pageCount(bytes)).toBeGreaterThanOrEqual(1);
        const out = process.env.AUDIT_PDF_OUT;
        if (out) {
            mkdirSync(out, { recursive: true });
            writeFileSync(path.join(out, "no-activation.pdf"), bytes);
            writeFileSync(path.join(out, "no-activation-pages.txt"), String(pageCount(bytes)));
        }
    }, 30_000);

    it("renders about 60 rows over more than one page", async () => {
        const many = Array.from({ length: 60 }, (_, index) => ({ ...rows[index % rows.length], who: `${rows[index % rows.length].who} ${index}`, whoId: `${rows[index % rows.length].whoId}-${index}`, resourceId: `${rows[index % rows.length].resourceId}-${index}` }));
        const bytes = await render(false, { ...INPUT, rows: many });
        expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
        expect(pageCount(bytes)).toBeGreaterThan(1);
        const out = process.env.AUDIT_PDF_OUT;
        if (out) {
            mkdirSync(out, { recursive: true });
            writeFileSync(path.join(out, "no-activation-large.pdf"), bytes);
        }
    }, 30_000);

    it("renders with names replaced", async () => {
        expect((await render(true)).subarray(0, 5).toString("latin1")).toBe("%PDF-");
    }, 30_000);
});
