import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { AuditPdfData } from "@/utils/auditExportPlan";
import { pdfCellBreak } from "@/utils/pdfText";

/** The action sentences wrap on their spaces; only a word too long for a cell, such as a UPN or an error code, breaks */
const tableCellBreak = (word: string): string[] => {
    if (word.length <= 20) return [word];
    // An error code in camel case breaks between its words: ActiveDuration-TooShort, not ActiveDurationT-ooShort
    const words = word.split(/(?<=[a-z])(?=[A-Z])/);
    return words.length > 1 && words.every((part) => part.length <= 20) ? words : pdfCellBreak(word);
};
import { c } from "@/components/pdf/ReportDocument";

/**
 * The PDF of the Audit export (canvas `PdfReport.dc.html`): the block of facts, four totals, then every action in a table
 * over as many pages as needed, page numbers and the closing note. Same fonts and colours as `ReportDocument`
 * (`registerReportFonts` is called by the caller before rendering). Drawn from `AuditPdfData`, which `planAuditExport` builds.
 */

export const auditPdfStyles = StyleSheet.create({
    page: { fontFamily: "IBM Plex Sans", fontSize: 9, color: c.ink, paddingTop: 40, paddingBottom: 54, paddingHorizontal: 44 },
    body: { fontSize: 9, lineHeight: 1.35 },
    eyebrow: { fontFamily: "IBM Plex Mono", fontSize: 8, color: c.accent, marginBottom: 4 },
    h1: { fontSize: 24, fontWeight: 600, lineHeight: 1.25, marginBottom: 8 },
    sub: { fontSize: 10, color: c.body, marginBottom: 14 },
    meta: { marginBottom: 14, borderTopWidth: 1, borderTopColor: c.line, borderBottomWidth: 1, borderBottomColor: c.line, paddingTop: 7, paddingBottom: 5 },
    metaRow: { flexDirection: "row", marginBottom: 2.5 },
    metaKey: { width: 86, color: c.muted },
    metaVal: { flex: 1 },
    kpis: { flexDirection: "row", gap: 6, marginBottom: 16 },
    kpi: { flex: 1, borderWidth: 1, borderColor: c.line, borderRadius: 2, paddingHorizontal: 8, paddingVertical: 7 },
    kpiLabel: { color: c.muted, fontSize: 8 },
    kpiValue: { fontFamily: "IBM Plex Mono", fontSize: 20, lineHeight: 1.2, marginTop: 2, marginBottom: 3 },
    kpiNote: { color: c.muted, fontSize: 8 },
    h2: { fontSize: 14, fontWeight: 600, lineHeight: 1.25, marginBottom: 6 },
    th: { color: c.muted, fontSize: 8 },
    row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: c.line, paddingVertical: 4.5 },
    headRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: c.ink, paddingBottom: 3 },
    cell: { paddingRight: 8 },
    main: { fontWeight: 600 },
    side: { color: c.body },
    under: { color: c.muted, fontSize: 8 },
    warn: { color: c.warn },
    danger: { color: c.danger },
    band: { backgroundColor: c.band, paddingVertical: 5, paddingHorizontal: 6 },
    bandTitle: { fontSize: 10.5, fontWeight: 600, lineHeight: 1.3 },
    bandNote: { fontSize: 8.5, lineHeight: 1.3, color: c.muted, marginTop: 2.5 },
    note: { marginTop: 14, padding: 8, backgroundColor: c.band },
    footer: { position: "absolute", bottom: 22, left: 44, right: 44, flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: c.line, paddingTop: 6, fontFamily: "IBM Plex Mono", fontSize: 7, color: c.muted },
});

const COLUMNS: { label: string; flex: number; get: (row: AuditPdfData["rows"][number]) => string }[] = [
    { label: "Time (UTC)", flex: 0.9, get: (row) => row.time },
    { label: "Action", flex: 2, get: (row) => row.action },
    { label: "By", flex: 1.2, get: (row) => row.by },
    { label: "Reason and ticket", flex: 1.6, get: (row) => row.reasonAndTicket },
    { label: "Result", flex: 1.5, get: (row) => row.result },
];

const s = auditPdfStyles;

export function AuditReportDocument({ data, version }: { data: AuditPdfData; version: string }) {
    return (
        <Document title={`${data.title}, ${data.tenantName}`} creator={`PIM Manager ${version}`}>
            <Page size="A4" style={s.page}>
                <View style={s.body}>
                    <Text style={s.eyebrow}>pim manager, audit report</Text>
                    <Text style={s.h1}>{data.title}</Text>
                    <Text style={s.sub} hyphenationCallback={pdfCellBreak}>{data.subtitle}</Text>
                    <View style={s.meta}>
                        {data.meta.map((item) => (
                            <View key={item.label} style={s.metaRow}>
                                <Text style={s.metaKey}>{item.label}</Text>
                                <Text style={s.metaVal} hyphenationCallback={pdfCellBreak}>{item.value}</Text>
                            </View>
                        ))}
                    </View>
                    <View style={s.kpis}>
                        {data.totals.map((total) => (
                            <View key={total.label} style={s.kpi} wrap={false}>
                                <Text style={s.kpiLabel}>{total.label}</Text>
                                <Text style={s.kpiValue}>{total.value}</Text>
                                <Text style={s.kpiNote}>{total.note}</Text>
                            </View>
                        ))}
                    </View>
                    <Text style={s.h2}>Actions</Text>
                    <View style={s.headRow} fixed>
                        {COLUMNS.map((col) => <Text key={col.label} style={[s.th, s.cell, { flex: col.flex }]}>{col.label}</Text>)}
                    </View>
                    {data.rows.map((row, index) => (
                        <View key={index} style={s.row} wrap={false}>
                            {COLUMNS.map((col) => <Text key={col.label} style={[s.cell, { flex: col.flex }, col.label === "Action" ? s.main : col.label === "Result" && row.isFailed ? s.danger : s.side]} hyphenationCallback={tableCellBreak}>{col.get(row)}</Text>)}
                        </View>
                    ))}
                    <View style={s.note} wrap={false}>
                        <Text>{data.closingNote}</Text>
                    </View>
                </View>
                <View style={s.footer} fixed>
                    <Text>PIM Manager {version}</Text>
                    <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
                </View>
            </Page>
        </Document>
    );
}
