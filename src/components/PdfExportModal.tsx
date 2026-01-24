"use client";

import { useState, useCallback } from "react";
import { X, FileDown, Loader2, Check, Image, Table, AlertTriangle, Layers, Users } from "lucide-react";
import { pdf } from "@react-pdf/renderer";
import { PdfDocument, PdfExportData } from "./pdf/PdfDocument";
import { captureChartsAsImages } from "@/utils/chartCapture";
import {
    CHART_SECTIONS,
    getInitialSelectedSections,
    getChartIdsToCapture,
    WorkloadSelection,
} from "@/config/pdfExportConfig";
import { RoleDetailData } from "@/types/directoryRole.types";
import { PimGroupData } from "@/types/pimGroup.types";
import { SecurityAlert } from "@/types/securityAlerts";

interface PdfExportModalProps {
    isOpen: boolean;
    onClose: () => void;
    chartData: PdfExportData;
    rolesData: RoleDetailData[];
    groupsData?: PimGroupData[];
    initialWorkloadSelection?: WorkloadSelection;
    filterSummary?: string;
    viewMode: "basic" | "advanced";
    tenantId?: string;
    userPrincipalName?: string;
    securityAlerts?: SecurityAlert[];
}

export function PdfExportModal({
    isOpen,
    onClose,
    chartData,
    rolesData,
    groupsData = [],
    initialWorkloadSelection,
    filterSummary,
    viewMode,
    tenantId,
    userPrincipalName,
    securityAlerts,
}: PdfExportModalProps) {
    const [isGenerating, setIsGenerating] = useState(false);
    // Config-driven: sections are initialized from config
    const [selectedSections, setSelectedSections] = useState(getInitialSelectedSections);
    const [includeCharts, setIncludeCharts] = useState(true);
    const [includeTables, setIncludeTables] = useState(true);

    // Workload Selection State
    const [selectedWorkloads, setSelectedWorkloads] = useState<WorkloadSelection>(
        initialWorkloadSelection || { directoryRoles: true, pimGroups: true }
    );

    const toggleSection = (sectionKey: string) => {
        setSelectedSections((prev) => ({
            ...prev,
            [sectionKey]: !prev[sectionKey],
        }));
    };

    const toggleWorkload = (workload: keyof WorkloadSelection) => {
        setSelectedWorkloads(prev => ({
            ...prev,
            [workload]: !prev[workload]
        }));
    };

    const handleExport = useCallback(async () => {
        setIsGenerating(true);

        try {
            // Config-driven: get chart IDs from config based on selection
            const chartIds = includeCharts ? getChartIdsToCapture(selectedSections) : [];

            // Capture charts as images
            const chartImages = includeCharts ? await captureChartsAsImages(chartIds) : {};

            // Generate PDF
            const doc = (
                <PdfDocument
                    data={chartData}
                    rolesData={rolesData}
                    groupsData={groupsData}
                    selectedWorkloads={selectedWorkloads}
                    chartImages={chartImages}
                    filterSummary={filterSummary}
                    selectedSections={selectedSections}
                    includeTables={includeTables}
                    includeCharts={includeCharts}
                    viewMode={viewMode}
                    tenantId={tenantId}
                    userPrincipalName={userPrincipalName}
                    securityAlerts={securityAlerts}
                />
            );

            const blob = await pdf(doc).toBlob();

            // Download the PDF
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `PIM_Report_${new Date().toISOString().split("T")[0]}.pdf`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            onClose();
        } catch (error) {
            console.error("Failed to generate PDF:", error);
            alert("Failed to generate PDF. Please try again.");
        } finally {
            setIsGenerating(false);
        }
    }, [chartData, rolesData, groupsData, selectedWorkloads, filterSummary, selectedSections, includeCharts, includeTables, viewMode, tenantId, userPrincipalName, securityAlerts, onClose]);

    if (!isOpen) return null;

    // Config-driven: sections array built from config
    const sections = [
        { key: "overview", label: "Overview summary", hasData: rolesData.length > 0 || groupsData.length > 0 },
        ...CHART_SECTIONS.map((section) => {
            const data = chartData[section.dataKey as keyof typeof chartData];
            return {
                key: section.key,
                label: section.label,
                hasData: data ? (Array.isArray(data) ? data.length > 0 : true) : false,
            };
        }),
        // Security Alerts section - only shown if we have alerts data
        { key: "securityAlerts", label: "Security alerts", hasData: !!securityAlerts && securityAlerts.length > 0, icon: AlertTriangle },
    ];

    const selectedCount = Object.values(selectedSections).filter(Boolean).length;

    // Workload definitions for UI
    const workloadOptions = [
        { key: 'directoryRoles', label: 'Directory roles', icon: Users, count: rolesData.length },
        { key: 'pimGroups', label: 'PIM groups', icon: Layers, count: groupsData.length },
    ] as const;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-xl max-w-md w-full max-h-[90vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded-lg">
                            <FileDown className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                        </div>
                        <div>
                            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                                Export to PDF
                            </h2>
                            <p className="text-sm text-zinc-500 dark:text-zinc-400">
                                Customize your report
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                    >
                        <X className="h-5 w-5 text-zinc-500" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-4 space-y-6 overflow-y-auto flex-1 min-h-0">

                    {/* Workload Selection - NEW */}
                    <div>
                        <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                            Included workloads
                        </h3>
                        <div className="flex gap-3">
                            {workloadOptions.map((workload) => (
                                <button
                                    key={workload.key}
                                    onClick={() => toggleWorkload(workload.key)}
                                    className={`flex-1 flex items-center gap-3 p-3 rounded-lg border transition-colors text-left ${selectedWorkloads[workload.key]
                                        ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                                        : "border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                                        }`}
                                >
                                    <div className={`p-1.5 rounded-md ${selectedWorkloads[workload.key] ? "bg-blue-200 dark:bg-blue-800" : "bg-zinc-100 dark:bg-zinc-800"
                                        }`}>
                                        <workload.icon className={`h-4 w-4 ${selectedWorkloads[workload.key] ? "text-blue-700 dark:text-blue-300" : "text-zinc-500"
                                            }`} />
                                    </div>
                                    <div>
                                        <div className={`text-sm font-medium ${selectedWorkloads[workload.key] ? "text-blue-900 dark:text-blue-100" : "text-zinc-700 dark:text-zinc-300"
                                            }`}>
                                            {workload.label}
                                        </div>
                                        <div className="text-xs text-zinc-500 dark:text-zinc-400">
                                            {workload.count} resources
                                        </div>
                                    </div>
                                    <div className={`ml-auto w-4 h-4 rounded border flex items-center justify-center ${selectedWorkloads[workload.key]
                                        ? "bg-blue-500 border-transparent text-white"
                                        : "border-zinc-300 dark:border-zinc-600"
                                        }`}>
                                        {selectedWorkloads[workload.key] && <Check className="h-3 w-3" />}
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Section Selection */}
                    <div>
                        <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                            Include sections
                        </h3>
                        <div className="space-y-2">
                            {sections.map((section) => (
                                <label
                                    key={section.key}
                                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${selectedSections[section.key]
                                        ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                                        : "border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                                        } ${!section.hasData ? "opacity-50 cursor-not-allowed" : ""}`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedSections[section.key]}
                                        onChange={() => section.hasData && toggleSection(section.key)}
                                        disabled={!section.hasData}
                                        className="sr-only"
                                    />
                                    <div
                                        className={`w-5 h-5 rounded flex items-center justify-center ${selectedSections[section.key]
                                            ? "bg-blue-500 text-white"
                                            : "border-2 border-zinc-300 dark:border-zinc-600"
                                            }`}
                                    >
                                        {selectedSections[section.key] && <Check className="h-3 w-3" />}
                                    </div>
                                    <span className="text-sm text-zinc-900 dark:text-zinc-100">
                                        {section.label}
                                    </span>
                                    {!section.hasData && (
                                        <span className="text-xs text-zinc-400 ml-auto">No data</span>
                                    )}
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* Display Options */}
                    <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800">
                        <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                            Display options
                        </h3>
                        <div className="flex gap-3">
                            <button
                                onClick={() => setIncludeCharts(!includeCharts)}
                                className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-lg border transition-colors ${includeCharts
                                    ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                                    : "border-zinc-200 dark:border-zinc-700 text-zinc-500"
                                    }`}
                            >
                                <Image className="h-4 w-4" />
                                <span className="text-sm font-medium">Charts</span>
                            </button>
                            <button
                                onClick={() => setIncludeTables(!includeTables)}
                                className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-lg border transition-colors ${includeTables
                                    ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                                    : "border-zinc-200 dark:border-zinc-700 text-zinc-500"
                                    }`}
                            >
                                <Table className="h-4 w-4" />
                                <span className="text-sm font-medium">Data tables</span>
                            </button>
                        </div>
                        <p className="text-xs text-zinc-400 mt-2">
                            Data tables contain selectable/copyable text
                        </p>
                    </div>

                    {/* Filter Summary Preview */}
                    {filterSummary && (
                        <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800">
                            <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                                Active filters (will be included)
                            </h3>
                            <p className="text-xs text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 p-2 rounded">
                                {filterSummary}
                            </p>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                    <p className="text-sm text-zinc-500">
                        {selectedCount} section{selectedCount !== 1 ? "s" : ""} selected
                    </p>
                    <div className="flex gap-2">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleExport}
                            disabled={isGenerating || selectedCount === 0 || (!includeCharts && !includeTables)}
                            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors flex items-center gap-2"
                        >
                            {isGenerating ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Generating...
                                </>
                            ) : (
                                <>
                                    <FileDown className="h-4 w-4" />
                                    Export PDF
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
