import { Document, Page, Text, View } from "@react-pdf/renderer";
import type { NoActivationPdfData, NoActivationPdfRow, NoActivationPdfSection } from "@/utils/auditExportPlan";
import { pdfCellBreak } from "@/utils/pdfText";
import { auditPdfStyles as s } from "@/components/pdf/AuditReportDocument";

/** The role and group column is wide enough for a long group name, so only a longer word breaks */
const tableCellBreak = (word: string): string[] => (word.length <= 24 ? [word] : pdfCellBreak(word));

/**
 * The PDF of the No activation export: the block of facts with the honesty text, five totals, then one table with a band per verdict (the
 * warnings first) over as many pages as needed, page numbers and the closing note. The heading of a table says the verdict
 * once, the role is the bold word of a row, and the scope and the group stand below what they belong to. Same parts and look
 * as `AuditReportDocument` (`registerReportFonts` is called by the caller before rendering). Drawn from `NoActivationPdfData`.
 */

const WIDTH = { resource: 1.75, who: 1.65, type: 1.4, activation: 1.65 } as const;

function Row({ row, isWarning }: { row: NoActivationPdfRow; isWarning: boolean }) {
    return (
        <View style={s.row} wrap={false}>
            <View style={[s.cell, { flex: WIDTH.resource }]}>
                <Text style={s.main} hyphenationCallback={tableCellBreak}>{row.resource}</Text>
                {row.scope && <Text style={s.under} hyphenationCallback={tableCellBreak}>{row.scope}</Text>}
            </View>
            <View style={[s.cell, { flex: WIDTH.who }]}>
                <Text hyphenationCallback={tableCellBreak}>{row.who}</Text>
                {row.isEmergency && <Text style={[s.under, s.warn]}>Emergency access</Text>}
                {row.via && <Text style={s.under} hyphenationCallback={tableCellBreak}>{row.via}</Text>}
            </View>
            <Text style={[s.cell, s.side, { flex: WIDTH.type }]}>{row.type}</Text>
            <Text style={[s.cell, isWarning ? s.warn : s.side, { flex: WIDTH.activation }]} hyphenationCallback={tableCellBreak}>{row.activation}</Text>
        </View>
    );
}

function Section({ section, isFirst }: { section: NoActivationPdfSection; isFirst: boolean }) {
    const isWarning = section.group === "none";
    const [first, ...rest] = section.rows;
    return (
        <View>
            {/* The band and the first row stay together, so a band never stands alone at the foot of a page */}
            <View wrap={false}>
                <View style={[s.band, { marginTop: isFirst ? 0 : 8 }]}>
                    <Text>
                        <Text style={s.bandTitle}>{section.title} </Text>
                        <Text style={[s.bandTitle, isWarning ? s.warn : s.side]}>{section.rows.length}</Text>
                    </Text>
                    <Text style={s.bandNote}>{section.note}</Text>
                </View>
                <Row row={first} isWarning={isWarning} />
            </View>
            {rest.map((row, index) => <Row key={index} row={row} isWarning={isWarning} />)}
        </View>
    );
}

export function NoActivationReportDocument({ data, version }: { data: NoActivationPdfData; version: string }) {
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
                        {data.totals.map((total, index) => (
                            <View key={total.label} style={s.kpi} wrap={false}>
                                <Text style={s.kpiLabel}>{total.label}</Text>
                                <Text style={index === 0 && total.value > 0 ? [s.kpiValue, s.warn] : s.kpiValue}>{total.value}</Text>
                                <Text style={s.kpiNote}>{total.note}</Text>
                            </View>
                        ))}
                    </View>
                    <Text style={s.h2}>Assignments</Text>
                    <View style={s.headRow} fixed>
                        <Text style={[s.th, s.cell, { flex: WIDTH.resource }]}>Role or group</Text>
                        <Text style={[s.th, s.cell, { flex: WIDTH.who }]}>Who</Text>
                        <Text style={[s.th, s.cell, { flex: WIDTH.type }]}>Type</Text>
                        <Text style={[s.th, s.cell, { flex: WIDTH.activation }]}>Activation</Text>
                    </View>
                    {data.sections.map((section, index) => <Section key={section.group} section={section} isFirst={index === 0} />)}
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
