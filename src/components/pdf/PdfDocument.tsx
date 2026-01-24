// PDF Components for Dashboard Export - Premium Design
// Using @react-pdf/renderer with styled cards and colored accents
// Config-driven: Add sections in pdfExportConfig.ts

import {
    Document,
    Page,
    Text,
    View,
    Image,
    StyleSheet,
} from "@react-pdf/renderer";
import { CHART_SECTIONS, OVERVIEW_STATS, calculateOverviewStats, WorkloadSelection } from "@/config/pdfExportConfig";
import { RoleDetailData } from "@/types/directoryRole.types";
import { PimGroupData } from "@/types/pimGroup.types";
import { SecurityAlert, getSeverityLabel } from "@/types/securityAlerts";
import { formatAlertString } from "@/utils/alertFormatting";

// Color Palette (matching app design)
const colors = {
    primary: "#3b82f6",      // Blue
    success: "#10b981",      // Green (Emerald)
    warning: "#f59e0b",      // Amber/Orange
    danger: "#ef4444",       // Red
    purple: "#8b5cf6",       // Purple
    indigo: "#6366f1",       // Indigo
    pink: "#ec4899",         // Pink
    teal: "#14b8a6",         // Teal
    textPrimary: "#18181b",
    textSecondary: "#71717a",
    textMuted: "#a1a1aa",
    cardBg: "#f8fafc",
    border: "#e2e8f0",
    white: "#ffffff",
};

// Map config color names to Hex
const configColorMap: Record<string, string> = {
    blue: colors.primary,
    emerald: colors.success,
    green: colors.success,
    orange: colors.warning,
    amber: colors.warning,
    purple: colors.purple,
    indigo: colors.indigo,
    pink: colors.pink,
    teal: colors.teal,
    red: colors.danger,
};

// Stat card color mapping (Fallback/Legacy)
const statColors: Record<string, { bg: string; accent: string }> = {
    totalRoles: { bg: "#eff6ff", accent: colors.primary },
    totalResources: { bg: "#eff6ff", accent: colors.primary },
    activeSessions: { bg: "#ecfdf5", accent: colors.success },
    permanentAssignments: { bg: "#fffbeb", accent: colors.warning },
    pimCoverage: { bg: "#faf5ff", accent: colors.purple },
    eligibleAssignments: { bg: "#ecfdf5", accent: colors.teal }, // Updated to teal match
    customRoles: { bg: "#eef2ff", accent: colors.indigo },
    rolesRequiringApproval: { bg: "#fdf2f8", accent: colors.pink },
};

// Styles for the PDF document
const styles = StyleSheet.create({
    // ... (keep previous styles unchanged until statLabel) ...
    page: {
        padding: 40,
        fontSize: 10,
        fontFamily: "Helvetica",
        backgroundColor: colors.white,
    },
    // Header styles
    headerBar: {
        height: 4,
        backgroundColor: colors.primary,
        marginBottom: 20,
        borderRadius: 2,
    },
    headerContainer: {
        marginBottom: 24,
    },
    title: {
        fontSize: 28,
        fontWeight: "bold",
        color: colors.textPrimary,
        marginBottom: 2,
        letterSpacing: -0.5,
    },
    titleAccent: {
        fontSize: 28,
        fontWeight: "bold",
        color: colors.primary,
    },
    subtitle: {
        fontSize: 12,
        color: colors.textSecondary,
        marginTop: 4,
    },
    // Metadata card
    metadataCard: {
        backgroundColor: colors.cardBg,
        padding: 16,
        borderRadius: 8,
        marginBottom: 24,
        borderWidth: 1,
        borderColor: colors.border,
    },
    metadataTitle: {
        fontSize: 11,
        fontWeight: "bold",
        color: colors.primary,
        marginBottom: 12,
        textTransform: "uppercase",
        letterSpacing: 0.5,
    },
    metadataGrid: {
        flexDirection: "row",
        flexWrap: "wrap",
    },
    metadataItem: {
        width: "50%",
        marginBottom: 8,
    },
    metadataLabel: {
        fontSize: 8,
        color: colors.textMuted,
        textTransform: "uppercase",
        letterSpacing: 0.3,
        marginBottom: 2,
    },
    metadataValue: {
        fontSize: 10,
        color: colors.textPrimary,
        fontWeight: "bold",
    },
    // Stats cards grid
    statsGrid: {
        flexDirection: "row",
        flexWrap: "wrap",
        marginBottom: 24,
        gap: 8,
    },
    statCard: {
        width: "24%",
        padding: 12,
        borderRadius: 8,
        marginBottom: 8,
    },
    statCardWide: {
        width: "32%",
        padding: 12,
        borderRadius: 8,
        marginBottom: 8,
    },
    statAccent: {
        width: 4,
        height: 24,
        borderRadius: 2,
        marginBottom: 8,
    },
    statValue: {
        fontSize: 20,
        fontWeight: "bold",
        color: colors.textPrimary,
        marginBottom: 2,
    },
    statLabel: {
        fontSize: 9,
        fontWeight: "bold", // Bold label
        color: colors.textPrimary,
        marginBottom: 2,
    },
    statSubtext: {
        fontSize: 8,
        color: colors.textSecondary,
        lineHeight: 1.2,
    },
    // Section styles
    section: {
        marginBottom: 20,
    },
    sectionHeader: {
        flexDirection: "row",
        alignItems: "center",
        marginBottom: 12,
        paddingBottom: 8,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    sectionAccent: {
        width: 4,
        height: 20,
        backgroundColor: colors.primary,
        borderRadius: 2,
        marginRight: 10,
    },
    sectionTitle: {
        fontSize: 14,
        fontWeight: "bold",
        color: colors.textPrimary,
    },
    // Chart styles
    chartContainer: {
        backgroundColor: colors.cardBg,
        padding: 16,
        borderRadius: 8,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: colors.border,
    },
    chartImage: {
        width: "100%",
        maxHeight: 180,
        objectFit: "contain",
    },
    // Table styles
    table: {
        marginTop: 8,
    },
    tableRow: {
        flexDirection: "row",
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        paddingVertical: 8,
    },
    tableHeader: {
        flexDirection: "row",
        backgroundColor: colors.primary,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 4,
        marginBottom: 4,
    },
    tableCell: {
        flex: 1,
        paddingHorizontal: 12,
        fontSize: 9,
        color: colors.textPrimary,
    },
    tableCellHeader: {
        flex: 1,
        paddingHorizontal: 0,
        fontWeight: "bold",
        color: colors.white,
        fontSize: 9,
    },
    tableCellBold: {
        flex: 1,
        paddingHorizontal: 12,
        fontWeight: "bold",
        fontSize: 9,
        color: colors.textPrimary,
    },
    // Filter summary
    filterBadge: {
        backgroundColor: colors.primary,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
        alignSelf: "flex-start",
        marginBottom: 16,
    },
    filterText: {
        color: colors.white,
        fontSize: 9,
        fontWeight: "bold",
    },
    // Alert styles
    alertCard: {
        backgroundColor: colors.cardBg,
        borderRadius: 8,
        padding: 12,
        marginBottom: 10,
        borderLeftWidth: 4,
    },
    alertHeader: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 8,
    },
    alertTitle: {
        fontSize: 11,
        fontWeight: "bold",
        color: colors.textPrimary,
        flex: 1,
    },
    alertBadge: {
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 4,
    },
    alertBadgeText: {
        fontSize: 7,
        fontWeight: "bold",
        color: colors.white,
    },
    alertDescription: {
        fontSize: 9,
        color: colors.textSecondary,
        marginBottom: 8,
    },
    alertIncidents: {
        backgroundColor: colors.white,
        borderRadius: 4,
        padding: 8,
    },
    alertIncidentTitle: {
        fontSize: 8,
        fontWeight: "bold",
        color: colors.textMuted,
        marginBottom: 4,
        textTransform: "uppercase",
    },
    alertIncidentItem: {
        fontSize: 9,
        color: colors.textPrimary,
        marginBottom: 2,
    },
    alertMitigation: {
        backgroundColor: "#fef3c7",  // Amber-50
        borderRadius: 4,
        padding: 8,
        marginTop: 8,
        borderLeftWidth: 3,
        borderLeftColor: colors.warning,
    },
    alertMitigationText: {
        fontSize: 8,
        color: "#92400e",  // Amber-800
    },
    alertMitigationLabel: {
        fontSize: 8,
        fontWeight: "bold",
        color: "#92400e",
        marginBottom: 4,
    },
    // Footer
    footer: {
        position: "absolute",
        bottom: 30,
        left: 40,
        right: 40,
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        borderTopWidth: 1,
        borderTopColor: colors.border,
        paddingTop: 12,
    },
    footerText: {
        fontSize: 8,
        color: colors.textMuted,
    },
    footerBrand: {
        fontSize: 8,
        color: colors.primary,
        fontWeight: "bold",
    },
});

// Types for PDF data
export interface ChartDataItem {
    name: string;
    value: number;
    color?: string;
}

export interface PdfExportData {
    [key: string]: ChartDataItem[] | undefined;
}

export interface PdfDocumentProps {
    data: PdfExportData;
    rolesData: RoleDetailData[];
    groupsData?: PimGroupData[];
    selectedWorkloads?: WorkloadSelection;
    chartImages: Record<string, string>;
    filterSummary?: string;
    selectedSections: Record<string, boolean>;
    includeTables: boolean;
    includeCharts: boolean;
    viewMode: "basic" | "advanced";
    tenantName?: string;
    tenantId?: string;
    primaryDomain?: string;
    userPrincipalName?: string;
    securityAlerts?: SecurityAlert[];
}


// Stat Card Component
function StatCard({
    statKey,
    value,
    label,
    colorName,
    subtext
}: {
    statKey: string;
    value: string | number;
    label: string;
    colorName?: string;
    subtext?: string;
}) {
    // Resolve color
    // 1. Try config color (mapped to hex)
    // 2. Try legacy hardcoded statColors
    // 3. Default to primary (Blue)

    let accentColor = colors.primary;
    let bgColor = colors.cardBg; // Default gray-ish

    if (colorName && configColorMap[colorName]) {
        accentColor = configColorMap[colorName];
        // Create a rudimentary light background based on accent?
        // For PDF we might just use white or keep cardBg (gray).
        // Legacy 'statColors' had specific nice pastel backgrounds.
        // If we want exact match we could map colors to bg colors too, but standardizing works.
        // Let's try to map the bg if it exists in legacy statColors for this KEY,
        // otherwise just use cardBg.
        if (statColors[statKey]) {
            bgColor = statColors[statKey].bg;
        } else {
            // Fallback for new keys or dynamic colors: keep standard card background
        }
    } else if (statColors[statKey]) {
        accentColor = statColors[statKey].accent;
        bgColor = statColors[statKey].bg;
    }

    // Force accent color update if colorName provided but legacy BG used
    if (colorName && configColorMap[colorName]) {
        accentColor = configColorMap[colorName];
    }

    return (
        <View style={[styles.statCard, { backgroundColor: bgColor }]}>
            <View style={[styles.statAccent, { backgroundColor: accentColor }]} />
            <Text style={styles.statValue}>{value}</Text>
            <Text style={styles.statLabel}>{label}</Text>
            {subtext && <Text style={styles.statSubtext}>{subtext}</Text>}
        </View>
    );
}

// Overview Stats Grid Component - Cards layout
function OverviewStatsCards({
    rolesData,
    groupsData,
    selectedWorkloads,
    viewMode,
}: {
    rolesData: RoleDetailData[];
    groupsData?: PimGroupData[];
    selectedWorkloads?: WorkloadSelection;
    viewMode: "basic" | "advanced";
}) {
    const statsToShow = calculateOverviewStats(rolesData, groupsData, selectedWorkloads, viewMode);

    return (
        <View style={styles.statsGrid}>
            {statsToShow.map((stat) => (
                <StatCard
                    key={stat.label}
                    statKey={stat.label === "Total Resources" ? "totalResources" : stat.label.replace(/\s+/g, '').replace('&', '').toLowerCase()}
                    value={stat.value}
                    label={stat.label}
                    colorName={stat.color}
                    subtext={stat.subtext || stat.description}
                />
            ))}
        </View>
    );
}

// Data Table Component
function DataTable({ data }: { data: ChartDataItem[] }) {
    const total = data.reduce((sum, item) => sum + item.value, 0);

    return (
        <View style={styles.table}>
            <View style={styles.tableHeader}>
                <Text style={styles.tableCellHeader}>Category</Text>
                <Text style={styles.tableCellHeader}>Count</Text>
                <Text style={styles.tableCellHeader}>Percentage</Text>
            </View>
            {data.map((item, index) => (
                <View style={styles.tableRow} key={index}>
                    <Text style={styles.tableCell}>{item.name}</Text>
                    <Text style={styles.tableCellBold}>{item.value}</Text>
                    <Text style={styles.tableCell}>
                        {total > 0 ? `${((item.value / total) * 100).toFixed(1)}%` : "0%"}
                    </Text>
                </View>
            ))}
            <View style={[styles.tableRow, { borderBottomWidth: 2, borderBottomColor: colors.primary }]}>
                <Text style={styles.tableCellBold}>Total</Text>
                <Text style={styles.tableCellBold}>{total}</Text>
                <Text style={styles.tableCellBold}>100%</Text>
            </View>
        </View>
    );
}

// Chart Section Component
function ChartSection({
    section,
    data,
    chartImages,
    includeCharts,
    includeTables,
}: {
    section: (typeof CHART_SECTIONS)[number];
    data: PdfExportData;
    chartImages: Record<string, string>;
    includeCharts: boolean;
    includeTables: boolean;
}) {
    const sectionData = data[section.dataKey];
    if (!sectionData) return null;

    return (
        <View style={styles.section} wrap={false}>
            <View style={styles.sectionHeader}>
                <View style={styles.sectionAccent} />
                <Text style={styles.sectionTitle}>{section.label}</Text>
            </View>
            {includeCharts && chartImages[section.chartId] && (
                <View style={styles.chartContainer}>
                    <Image src={chartImages[section.chartId]} style={styles.chartImage} />
                </View>
            )}
            {includeTables && <DataTable data={sectionData} />}
        </View>
    );
}

// Security Alerts Section Component
function SecurityAlertsSection({ alerts }: { alerts: SecurityAlert[] }) {
    // Only show active alerts (non-passed checks)
    const activeAlerts = alerts.filter(alert => alert.isActive && alert.incidentCount > 0);

    if (activeAlerts.length === 0) {
        return (
            <View style={styles.section}>
                <View style={styles.sectionHeader}>
                    <View style={[styles.sectionAccent, { backgroundColor: colors.success }]} />
                    <Text style={styles.sectionTitle}>Security Alerts</Text>
                </View>
                <View style={[styles.alertCard, { borderLeftColor: colors.success }]}>
                    <Text style={styles.alertTitle}>✓ No active security alerts</Text>
                    <Text style={styles.alertDescription}>
                        All PIM security checks passed. Your privileged access configuration follows best practices.
                    </Text>
                </View>
            </View>
        );
    }

    const getSeverityColor = (severity: string): string => {
        switch (severity) {
            case 'high': return colors.danger;
            case 'medium': return colors.warning;
            case 'low': return colors.primary;
            default: return colors.textMuted;
        }
    };

    return (
        <View style={styles.section} wrap={false}>
            <View style={styles.sectionHeader}>
                <View style={[styles.sectionAccent, { backgroundColor: colors.danger }]} />
                <Text style={styles.sectionTitle}>Security Alerts ({activeAlerts.length})</Text>
            </View>
            {activeAlerts.map((alert, index) => {
                const severity = alert.alertDefinition?.severityLevel || 'unknown';
                const severityColor = getSeverityColor(severity);
                const incidents = alert.alertIncidents || []; // Show ALL incidents
                const formattedDescription = formatAlertString(alert.alertDefinition?.description, alert);
                const mitigationSteps = alert.alertDefinition?.mitigationSteps;

                return (
                    <View key={index} style={[styles.alertCard, { borderLeftColor: severityColor }]}>
                        <View style={styles.alertHeader}>
                            <Text style={styles.alertTitle}>
                                {alert.alertDefinition?.displayName || 'Security Alert'}
                            </Text>
                            <View style={[styles.alertBadge, { backgroundColor: severityColor }]}>
                                <Text style={styles.alertBadgeText}>{getSeverityLabel(severity)}</Text>
                            </View>
                        </View>
                        {formattedDescription && (
                            <Text style={styles.alertDescription}>
                                {formattedDescription}
                            </Text>
                        )}
                        {incidents.length > 0 && (
                            <View style={styles.alertIncidents}>
                                <Text style={styles.alertIncidentTitle}>
                                    Affected ({alert.incidentCount} total):
                                </Text>
                                {incidents.map((incident, i) => (
                                    <Text key={i} style={styles.alertIncidentItem}>
                                        • {incident.assigneeDisplayName || incident.roleDisplayName || `Incident ${i + 1}`}
                                        {incident.roleDisplayName && incident.assigneeDisplayName ? ` (${incident.roleDisplayName})` : ''}
                                    </Text>
                                ))}
                            </View>
                        )}
                        {mitigationSteps && (
                            <View style={styles.alertMitigation}>
                                <Text style={styles.alertMitigationLabel}>Mitigation:</Text>
                                <Text style={styles.alertMitigationText}>{mitigationSteps}</Text>
                            </View>
                        )}
                    </View>
                );
            })}
        </View>
    );
}

// Main PDF Document Component - Premium Design
export function PdfDocument({
    data,
    rolesData,
    groupsData,
    selectedWorkloads,
    chartImages,
    filterSummary,
    selectedSections,
    includeTables,
    includeCharts,
    viewMode,
    tenantName,
    tenantId,
    primaryDomain,
    userPrincipalName,
    securityAlerts,
}: PdfDocumentProps) {
    const generatedDate = new Date().toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });

    return (
        <Document>
            <Page size="A4" style={styles.page}>
                {/* Colored Header Bar */}
                <View style={styles.headerBar} />

                {/* Header */}
                <View style={styles.headerContainer}>
                    <Text style={styles.title}>
                        PIM <Text style={styles.titleAccent}>Security Report</Text>
                    </Text>
                    <Text style={styles.subtitle}>
                        {tenantName || "Microsoft Entra ID"} • {generatedDate}
                    </Text>
                </View>

                {/* Report Metadata Card */}
                <View style={styles.metadataCard}>
                    <Text style={styles.metadataTitle}>Report Details</Text>
                    <View style={styles.metadataGrid}>
                        {tenantName && (
                            <View style={styles.metadataItem}>
                                <Text style={styles.metadataLabel}>Tenant Name</Text>
                                <Text style={styles.metadataValue}>{tenantName}</Text>
                            </View>
                        )}
                        {tenantId && (
                            <View style={styles.metadataItem}>
                                <Text style={styles.metadataLabel}>Tenant ID</Text>
                                <Text style={styles.metadataValue}>{tenantId}</Text>
                            </View>
                        )}
                        {primaryDomain && (
                            <View style={styles.metadataItem}>
                                <Text style={styles.metadataLabel}>Primary Domain</Text>
                                <Text style={styles.metadataValue}>{primaryDomain}</Text>
                            </View>
                        )}
                        {userPrincipalName && (
                            <View style={styles.metadataItem}>
                                <Text style={styles.metadataLabel}>Exported By</Text>
                                <Text style={styles.metadataValue}>{userPrincipalName}</Text>
                            </View>
                        )}
                    </View>
                </View>

                {/* Filter Badge */}
                {filterSummary && (
                    <View style={styles.filterBadge}>
                        <Text style={styles.filterText}>🔍 {filterSummary}</Text>
                    </View>
                )}

                {/* Overview Stats Cards - Only if Data Available */}
                {selectedSections.overview && (rolesData.length > 0 || (groupsData && groupsData.length > 0)) && (
                    <View style={styles.section}>
                        <View style={styles.sectionHeader}>
                            <View style={styles.sectionAccent} />
                            <Text style={styles.sectionTitle}>Overview</Text>
                        </View>
                        <OverviewStatsCards
                            rolesData={rolesData}
                            groupsData={groupsData}
                            selectedWorkloads={selectedWorkloads}
                            viewMode={viewMode}
                        />
                    </View>
                )}

                {/* Chart Sections - Dynamically rendered from config */}
                {CHART_SECTIONS.map((section) =>
                    selectedSections[section.key] ? (
                        <ChartSection
                            key={section.key}
                            section={section}
                            data={data}
                            chartImages={chartImages}
                            includeCharts={includeCharts}
                            includeTables={includeTables}
                        />
                    ) : null
                )}

                {/* Security Alerts Section - Only shown if alerts data available */}
                {selectedSections.securityAlerts && securityAlerts && securityAlerts.length > 0 && (
                    <SecurityAlertsSection alerts={securityAlerts} />
                )}

                {/* Footer */}
                <View style={styles.footer}>
                    <Text style={styles.footerText}>
                        Generated {generatedDate}
                    </Text>
                    <Text style={styles.footerBrand}>
                        PIM Manager • Powered by Microsoft Graph API
                    </Text>
                </View>
            </Page>
        </Document>
    );
}
