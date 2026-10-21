import { Document, Font, Page, Path, Circle, StyleSheet, Svg, Text, View, Link } from "@react-pdf/renderer";
import type { ChartStyle, ExportReport, ReportChart, ReportTable } from "@/utils/exportReport";

/**
 * The PDF of the export (spec 3.5): drawn from an `ExportReport`, no captured images, charts are vector (Svg and boxes).
 * Direction A of `docs/Assets/next-gen/dashboard/design-options/pdf-options.md`: white page, IBM Plex, big numbers, no severity labels.
 */

export function registerReportFonts(origin: string): void {
    Font.register({
        family: "IBM Plex Sans",
        fonts: [
            { src: `${origin}/fonts/plex-sans-400.woff`, fontWeight: 400 },
            { src: `${origin}/fonts/plex-sans-600.woff`, fontWeight: 600 },
        ],
    });
    Font.register({ family: "IBM Plex Mono", src: `${origin}/fonts/plex-mono-400.woff` });
    // Names and role titles are never hyphenated
    Font.registerHyphenationCallback((word) => [word]);
}

const c = {
    ink: "#1c1c1a",
    body: "#4a4a46",
    muted: "#6a6a64",
    line: "#e3e3de",
    track: "#e8e8e3",
    accent: "#0a6fa8",
    warn: "#b45309",
    warnTint: "#fdf3e3",
    band: "#f0f0ec",
};
// The light tokens of palette B (globals.css): accent, bar-light, warn-fill, neutral-fill, success, danger, muted
const SERIES = ["#0a6fa8", "#8fcbea", "#d97706", "#8a8780", "#177330", "#b42318", "#6a6a64"];

const s = StyleSheet.create({
    page: { fontFamily: "IBM Plex Sans", fontSize: 9, color: c.ink, paddingTop: 40, paddingBottom: 54, paddingHorizontal: 44, lineHeight: 1.35 },
    eyebrow: { fontFamily: "IBM Plex Mono", fontSize: 8, color: c.accent, marginBottom: 4 },
    h1: { fontSize: 24, fontWeight: 600, lineHeight: 1.25, marginBottom: 8 },
    sub: { fontSize: 10, color: c.body, marginBottom: 14 },
    meta: { marginBottom: 14 },
    metaRow: { flexDirection: "row", marginBottom: 2 },
    metaKey: { width: 86, color: c.muted },
    metaVal: { flex: 1 },
    panel: { borderWidth: 1, borderColor: c.line, borderTopWidth: 3, borderTopColor: c.accent, borderRadius: 2, padding: 12, marginTop: 12 },
    h2: { fontSize: 14, fontWeight: 600, lineHeight: 1.25, marginBottom: 8 },
    panelEyebrow: { fontFamily: "IBM Plex Mono", fontSize: 7.5, color: c.accent, marginBottom: 2 },
    h3: { fontSize: 10.5, fontWeight: 600, marginTop: 12, marginBottom: 4 },
    kpis: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -4 },
    kpi: { width: "25%", paddingHorizontal: 4, marginBottom: 10 },
    kpiLabel: { color: c.muted, fontSize: 8 },
    kpiValue: { fontSize: 22, fontWeight: 400, lineHeight: 1.2, marginTop: 2, marginBottom: 3 },
    kpiNote: { color: c.muted, fontSize: 8 },
    attnRow: { flexDirection: "row", paddingVertical: 6, borderTopWidth: 1, borderTopColor: c.line },
    attnCount: { width: 34, fontSize: 16, lineHeight: 1.1, color: c.warn },
    attnTitle: { fontWeight: 600, fontSize: 10 },
    attnDetail: { color: c.body },
    note: { color: c.muted, fontSize: 8, marginTop: 4 },
    th: { color: c.muted, fontSize: 8 },
    row: { flexDirection: "row", borderTopWidth: 1, borderTopColor: c.line, paddingVertical: 3.5 },
    headRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: c.ink, paddingBottom: 3 },
    cell: { paddingRight: 8 },
    fix: { marginTop: 6, color: c.body },
    link: { color: c.accent, fontFamily: "IBM Plex Mono", fontSize: 7.5 },
    chartGrid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -6 },
    chartCard: { width: "50%", paddingHorizontal: 6, marginBottom: 12 },
    chartPanel: { borderWidth: 1, borderColor: c.line, borderTopWidth: 3, borderTopColor: c.accent, borderRadius: 2, padding: 10 },
    chartTitle: { fontWeight: 600, marginBottom: 6 },
    barRow: { marginBottom: 5 },
    barTop: { flexDirection: "row", justifyContent: "space-between", marginBottom: 2 },
    barTrack: { height: 6, backgroundColor: c.track },
    bar: { height: 6 },
    donutWrap: { flexDirection: "row", alignItems: "center" },
    legendRow: { flexDirection: "row", alignItems: "center", marginBottom: 3 },
    swatch: { width: 7, height: 7, marginRight: 5 },
    footer: { position: "absolute", bottom: 22, left: 44, right: 44, flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: c.line, paddingTop: 6, fontFamily: "IBM Plex Mono", fontSize: 7, color: c.muted },
    notes: { marginTop: 10, padding: 8, backgroundColor: c.band },
});

const pct = (value: number, total: number): string => (total > 0 ? `${Math.round((value / total) * 100)}%` : "0%");
const stamp = (iso: string): string => iso.slice(0, 10) + " " + iso.slice(11, 16);

function polar(cx: number, cy: number, r: number, fraction: number): [number, number] {
    const angle = fraction * 2 * Math.PI - Math.PI / 2;
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
}

function Donut({ items, total }: { items: ReportChart["items"]; total: number }) {
    const size = 76;
    const r = 28;
    const cx = size / 2;
    const stroke = 12;
    const starts = items.map((_, i) => items.slice(0, i).reduce((sum, it) => sum + (total > 0 ? it.value / total : 0), 0));
    return (
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            {items.map((item, index) => {
                const start = starts[index];
                const fraction = total > 0 ? item.value / total : 0;
                const color = SERIES[index % SERIES.length];
                if (fraction >= 0.9999) return <Circle key={item.name} cx={cx} cy={cx} r={r} stroke={color} strokeWidth={stroke} fill="none" />;
                const [x0, y0] = polar(cx, cx, r, start);
                const [x1, y1] = polar(cx, cx, r, start + fraction);
                const d = `M ${x0} ${y0} A ${r} ${r} 0 ${fraction > 0.5 ? 1 : 0} 1 ${x1} ${y1}`;
                return <Path key={item.name} d={d} stroke={color} strokeWidth={stroke} fill="none" />;
            })}
        </Svg>
    );
}

function Chart({ chart, style }: { chart: ReportChart; style: ChartStyle }) {
    return (
        <View style={s.chartCard} wrap={false}>
          <View style={s.chartPanel}>
            <Text style={s.chartTitle}>{chart.title}</Text>
            {style === "bars" &&
                chart.items.map((item, index) => (
                    <View key={item.name} style={s.barRow}>
                        <View style={s.barTop}>
                            <Text>{item.name}</Text>
                            <Text style={{ fontFamily: "IBM Plex Mono", fontSize: 8 }}>{item.value} of {chart.total}, {pct(item.value, chart.total)}</Text>
                        </View>
                        <View style={s.barTrack}>
                            <View style={[s.bar, { width: pct(item.value, chart.total), backgroundColor: SERIES[index % SERIES.length] }]} />
                        </View>
                    </View>
                ))}
            {style === "donuts" && (
                <View style={s.donutWrap}>
                    <Donut items={chart.items} total={chart.total} />
                    <View style={{ marginLeft: 10, flex: 1 }}>
                        {chart.items.map((item, index) => (
                            <View key={item.name} style={s.legendRow}>
                                <View style={[s.swatch, { backgroundColor: SERIES[index % SERIES.length] }]} />
                                <Text>{item.name}: {item.value} ({pct(item.value, chart.total)})</Text>
                            </View>
                        ))}
                    </View>
                </View>
            )}
            {style === "tables" &&
                chart.items.map((item) => (
                    <View key={item.name} style={s.row}>
                        <Text style={{ flex: 1 }}>{item.name}</Text>
                        <Text style={{ width: 28, textAlign: "right" }}>{item.value}</Text>
                        <Text style={{ width: 34, textAlign: "right" }}>{pct(item.value, chart.total)}</Text>
                    </View>
                ))}
          </View>
        </View>
    );
}

function Table({ table }: { table: ReportTable }) {
    const widths = table.columns.map((col, i) => (i === 0 ? 2 : col.align === "right" ? 0.8 : 1.4));
    const cell = (i: number) => ({ flex: widths[i], textAlign: table.columns[i].align === "right" ? ("right" as const) : ("left" as const) });
    // Findings tables hold at most ten rows, so a table moves to the next page whole instead of splitting
    return (
        <View style={s.panel} wrap={false}>
            <Text style={s.panelEyebrow}>{BLOCK_TITLES[table.block]?.toLowerCase() ?? table.block}</Text>
            <Text style={s.h2}>{table.title} <Text style={{ color: c.warn }}>{table.count}</Text></Text>
            <View style={s.headRow} wrap={false}>
                {table.columns.map((col, i) => <Text key={col.label} style={[s.th, s.cell, cell(i)]}>{col.label}</Text>)}
            </View>
            {table.rows.map((row, r) => (
                <View key={r} style={s.row} wrap={false}>
                    {row.map((value, i) => <Text key={i} style={[s.cell, cell(i)]}>{value}</Text>)}
                </View>
            ))}
            {table.note && <Text style={s.note}>{table.note}</Text>}
            {table.fix && (
                <Text style={s.fix}>
                    <Text style={{ fontWeight: 600 }}>Fix: </Text>{table.fix.text}{table.fix.url ? " " : ""}
                    {table.fix.url && <Link src={table.fix.url} style={s.link}>{table.fix.url.replace("https://", "")}</Link>}
                </Text>
            )}
        </View>
    );
}

const BLOCK_TITLES: Record<string, string> = {
    findings: "Findings",
    groups: "PIM for Groups",
    emergency: "Emergency access accounts",
    extensions: "Custom extensions",
    accounts: "Accounts and approvers",
    rightNow: "Right now",
};
const BLOCK_ORDER = ["findings", "groups", "emergency", "extensions", "accounts", "rightNow"];

function Footer({ report }: { report: ExportReport }) {
    const h = report.header;
    return (
        <View style={s.footer} fixed>
            <Text>{h.tenant} | exported {stamp(h.exportedAt)} by {h.exporter}{h.dataReadAt ? ` | data read ${stamp(h.dataReadAt)}` : ""}</Text>
            <Text render={({ pageNumber, totalPages }) => `PIM Manager ${h.version} | page ${pageNumber} of ${totalPages}`} />
        </View>
    );
}

export function ReportDocument({ report, chartStyle }: { report: ExportReport; chartStyle: ChartStyle }) {
    const h = report.header;
    const detailLabel = h.detail === "summary" ? "Summary" : h.detail === "full" ? "Full" : "Full with appendix";
    return (
        <Document title={`${h.title}, ${h.tenant}`} author={h.exporter} creator={`PIM Manager ${h.version}`}>
            <Page size="A4" style={s.page}>
                <Text style={s.eyebrow}>pim manager report</Text>
                <Text style={s.h1}>{h.title}</Text>
                <Text style={s.sub}>{h.tenant} | Microsoft Entra ID | {detailLabel}{h.audience === "management" ? " | management" : ""}</Text>
                <View style={s.meta}>
                    {([
                        ["Data read", h.dataReadAt ? stamp(h.dataReadAt) : "not known"],
                        ["Counted", h.counted.join(", ") || "nothing"],
                        ["Filter", h.filter ?? "none"],
                        ["Exported by", `${h.exporter}, PIM Manager ${h.version}`],
                    ] as const).map(([k, v]) => (
                        <View key={k} style={s.metaRow}>
                            <Text style={s.metaKey}>{k}</Text>
                            <Text style={s.metaVal}>{v}</Text>
                        </View>
                    ))}
                </View>

                {report.numbers && (
                    <View style={s.panel}>
                        <Text style={s.panelEyebrow}>numbers</Text>
                        <Text style={s.h2}>Where you stand</Text>
                        <View style={s.kpis}>
                            {report.numbers.map((n) => (
                                <View key={n.label} style={s.kpi} wrap={false}>
                                    <Text style={s.kpiLabel}>{n.label}</Text>
                                    <Text style={[s.kpiValue, n.isWarning ? { color: c.warn } : {}]}>{n.value}</Text>
                                    <Text style={s.kpiNote}>{n.note}</Text>
                                </View>
                            ))}
                        </View>
                    </View>
                )}

                {report.attention && (
                    <View style={s.panel}>
                        <Text style={s.panelEyebrow}>attention</Text>
                        <Text style={s.h2}>What needs attention</Text>
                        {report.attention.length === 0 && <Text style={s.attnDetail}>Nothing stands out in what is counted.</Text>}
                        {report.attention.map((a) => (
                            <View key={a.label} style={s.attnRow} wrap={false}>
                                <Text style={s.attnCount}>{a.count}</Text>
                                <View style={{ flex: 1 }}>
                                    <Text style={s.attnTitle}>{a.label}</Text>
                                    <Text style={s.attnDetail}>{a.detail}</Text>
                                </View>
                            </View>
                        ))}
                    </View>
                )}

                {report.alerts && (
                    <View style={s.panel}>
                        <Text style={s.panelEyebrow}>alerts</Text>
                        <Text style={s.h2}>From Microsoft</Text>
                        <Text style={{ color: c.body }}>
                            {report.alerts.openCount === 0 ? "No active alerts" : `${report.alerts.openCount} active ${report.alerts.openCount === 1 ? "alert" : "alerts"}`}, {report.alerts.passedCount} {report.alerts.passedCount === 1 ? "check" : "checks"} passed.
                        </Text>
                        {report.alerts.rows.map((a) => (
                            <View key={a.title} style={s.row} wrap={false}>
                                <Text style={{ flex: 1 }}>{a.title}</Text>
                                <Text style={{ width: 70, color: c.muted }}>{a.severity}</Text>
                                <Text style={{ width: 60, textAlign: "right" }}>{a.affected} affected</Text>
                            </View>
                        ))}
                    </View>
                )}

                {report.notes.length > 0 && (
                    <View style={s.notes} wrap={false}>
                        {report.notes.map((note) => <Text key={note}>{note}</Text>)}
                    </View>
                )}
                <Footer report={report} />
            </Page>

            {report.charts && report.charts.length > 0 && (
                <Page size="A4" style={s.page}>
                    <Text style={s.eyebrow}>posture</Text>
                    <Text style={s.h1}>How access is set up</Text>
                    <View style={[s.chartGrid, { marginTop: 14 }]}>
                        {report.charts.map((chart) => <Chart key={chart.id} chart={chart} style={chartStyle} />)}
                    </View>
                    <Footer report={report} />
                </Page>
            )}

            {report.tables.length > 0 && (
                <Page size="A4" style={s.page}>
                    {BLOCK_ORDER.flatMap((block) => report.tables.filter((t) => t.block === block)).map((t) => <Table key={t.id} table={t} />)}
                    <Footer report={report} />
                </Page>
            )}

            {report.glossary && (
                <Page size="A4" style={s.page}>
                    <Text style={s.eyebrow}>definitions</Text>
                    <Text style={s.h1}>How the numbers are counted</Text>
                    <View style={s.panel}>
                        {report.glossary.map((g) => (
                            <View key={g.term} style={s.row} wrap={false}>
                                <Text style={{ width: 130, fontWeight: 600 }}>{g.term}</Text>
                                <Text style={{ flex: 1, color: c.body }}>{g.text}</Text>
                            </View>
                        ))}
                    </View>
                    <Footer report={report} />
                </Page>
            )}

            {report.appendix && (
                <Page size="A4" orientation="landscape" style={s.page}>
                    <Text style={s.eyebrow}>appendix</Text>
                    <Text style={s.h1}>All assignments</Text>
                    <Text style={s.note}>{report.appendix.length} rows. The CSV export has the same rows with the object ids.</Text>
                    <View style={[s.headRow, { marginTop: 8 }]} fixed>
                        {APPENDIX_COLUMNS.map((col) => <Text key={col.label} style={[s.th, s.cell, { width: col.width }]}>{col.label}</Text>)}
                    </View>
                    {report.appendix.map((row, i) => (
                        <View key={i} style={s.row} wrap={false}>
                            {APPENDIX_COLUMNS.map((col) => <Text key={col.label} style={[s.cell, { width: col.width }]}>{col.get(row)}</Text>)}
                        </View>
                    ))}
                    <Footer report={report} />
                </Page>
            )}
        </Document>
    );
}

type AppendixRow = NonNullable<ExportReport["appendix"]>[number];
const APPENDIX_COLUMNS: { label: string; width: number; get: (r: AppendixRow) => string }[] = [
    { label: "Role or group", width: 150, get: (r) => (r.access ? `${r.resource}, ${r.access.toLowerCase()}` : r.resource) },
    { label: "Assignment", width: 60, get: (r) => r.type },
    { label: "Name", width: 150, get: (r) => r.name || "unknown" },
    { label: "Kind", width: 50, get: (r) => r.kind },
    { label: "Via", width: 50, get: (r) => r.memberType },
    { label: "Start", width: 62, get: (r) => r.start },
    { label: "End", width: 62, get: (r) => r.end || "no end" },
    { label: "Scope", width: 110, get: (r) => r.scope },
];
