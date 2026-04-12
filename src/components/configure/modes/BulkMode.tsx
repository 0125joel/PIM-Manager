"use client";

import React, { useState, useCallback, useMemo, useEffect } from "react";
import { ArrowLeft, FileSpreadsheet, Play, CheckCircle, XCircle, AlertTriangle, Download, X, Trash2, Info } from "lucide-react";
import { CsvUploader } from "../bulk/CsvUploader";
import { CompareView } from "../bulk/CompareView";
import { AssignmentPreview, RowStatus } from "../bulk/AssignmentPreview";
import { CsvParserService } from "@/services/csvParserService";
import {
    ParsedRolePolicyRow,
    ParsedGroupPolicyRow,
    ParsedRoleAssignmentRow,
    ParsedGroupAssignmentRow,
    ParsedRoleAssignmentRemovalRow,
    ParsedGroupAssignmentRemovalRow,
    ParseResult,
    AnyParsedRow,
} from "@/types/csvParser.types";
import { BulkRemovalRequest } from "@/types/wizard.types";
import { useToastActions } from "@/contexts/ToastContext";
import { usePimData } from "@/hooks/usePimData";
import { useUnifiedPimData } from "@/contexts/UnifiedPimContext";
import { useGraphClient } from "@/hooks/usePimSelectors";
import { applyGroupPolicies, applyDirectoryRolePolicies, applyDirectoryRoleAssignments, applyGroupAssignments, applyBulkRoleRemovals, applyBulkGroupRemovals } from "@/services/wizardApplyService";
import { PolicySettings } from "@/hooks/useWizardState";
import { PimGroupData } from "@/types/pimGroup.types";
import { parseGraphPolicy } from "@/services/policyParserService";
import { DEFAULT_POLICY_SETTINGS } from "@/components/configure/shared/PolicySettingsForm";
import { isWriteConsentGranted } from "@/hooks/useIncrementalConsent";
import { ProgressModal, ProgressStep } from "@/components/ProgressModal";
import { SettingsModal } from "@/components/SettingsModal";
import { WorkloadType } from '@/types/workload.types';
import { Logger } from "@/utils/logger";

interface BulkModeProps {
    onBack: () => void;
}

type BulkStep = "upload" | "compare" | "results";
type ApplyPhase = "idle" | "applying" | "validating" | "complete";

interface ApplyResult {
    id: string;
    name: string;
    field: string;
    success: boolean;
    message: string;
}

interface RoleCurrentData {
    maxActivationDuration: string;
    mfaRequired: boolean;
    justificationRequired: boolean;
    approvalRequired: boolean;
}

interface GroupCurrentData {
    memberMaxDuration: string;
    memberMfa: boolean;
    memberApproval: boolean;
    ownerMaxDuration: string;
    ownerMfa: boolean;
    ownerApproval: boolean;
}


export function BulkMode({ onBack }: BulkModeProps) {
    const toast = useToastActions();
    const { rolesData, getPolicySettings, loading: rolesLoading } = usePimData();
    const { workloads, isWorkloadLoading, refreshWorkload } = useUnifiedPimData();
    const groupsData = workloads.pimGroups.data as PimGroupData[];
    const getGraphClient = useGraphClient();

    // Step state
    const [step, setStep] = useState<BulkStep>("upload");
    const [isLoading, setIsLoading] = useState(false);
    const [currentFile, setCurrentFile] = useState<{ name: string; rowCount: number } | null>(null);
    const [parseResult, setParseResult] = useState<ParseResult<AnyParsedRow> | null>(null);
    const [selectedChanges, setSelectedChanges] = useState<Set<string>>(new Set());
    const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
    const [applyResults, setApplyResults] = useState<ApplyResult[]>([]);
    const [applyPhase, setApplyPhase] = useState<ApplyPhase>("idle");

    // Consent gate
    const [missingWriteConsent, setMissingWriteConsent] = useState(false);
    const [detectedWorkload, setDetectedWorkload] = useState<"directoryRoles" | "pimGroups" | null>(null);
    const [showSettingsModal, setShowSettingsModal] = useState(false);
    const [consentChecked, setConsentChecked] = useState(false);

    // Progress modal
    const [showProgress, setShowProgress] = useState(false);
    const [progressSteps, setProgressSteps] = useState<ProgressStep[]>([]);
    const [canCloseProgress, setCanCloseProgress] = useState(false);
    const [progressTitle, setProgressTitle] = useState("Applying Changes");

    // Recheck write consent when settings modal closes
    useEffect(() => {
        if (!detectedWorkload) return;
        const id = setTimeout(() => {
            const granted = isWriteConsentGranted(detectedWorkload);
            setMissingWriteConsent(!granted);
            if (granted) {
                setStep(prev => prev === "upload" ? "compare" : prev);
            }
        }, 0);
        return () => clearTimeout(id);
    }, [showSettingsModal, detectedWorkload]);

    // Build current data map from loaded roles and groups (for policy diff view)
    const currentDataMap = useMemo(() => {
        const map = new Map<string, Record<string, unknown>>();

        if (rolesData && rolesData.length > 0) {
            rolesData.forEach(roleData => {
                const id = roleData.definition.id;
                const name = roleData.definition.displayName;
                const policy = roleData.policy;

                let maxActivationDuration = "";
                let mfaRequired = false;
                let justificationRequired = false;
                let approvalRequired = false;

                if (policy?.details?.rules) {
                    for (const rule of policy.details.rules) {
                        const ruleType = rule["@odata.type"];
                        const target = rule.target;
                        const isTarget = (c: string, l: string) => target?.caller === c && target?.level === l;

                        if (isTarget("EndUser", "Assignment")) {
                            if (ruleType === "#microsoft.graph.unifiedRoleManagementPolicyExpirationRule") {
                                maxActivationDuration = rule.maximumDuration || "";
                            }
                            if (ruleType === "#microsoft.graph.unifiedRoleManagementPolicyEnablementRule") {
                                const enabledRules = (rule.enabledRules as string[]) || [];
                                mfaRequired = enabledRules.includes("MultiFactorAuthentication");
                                justificationRequired = enabledRules.includes("Justification");
                            }
                            if (ruleType === "#microsoft.graph.unifiedRoleManagementPolicyApprovalRule") {
                                const setting = rule.setting as Record<string, unknown> | undefined;
                                approvalRequired = (setting?.isApprovalRequired as boolean) || false;
                            }
                        }
                    }
                }

                const entry = { maxActivationDuration, mfaRequired, justificationRequired, approvalRequired } satisfies RoleCurrentData;
                map.set(id, entry);
                map.set(name.toLowerCase(), entry);
            });
        }

        if (groupsData && groupsData.length > 0) {
            groupsData.forEach(groupData => {
                const id = groupData.group.id;
                const name = groupData.group.displayName;
                const memberRules = groupData.policies?.member?.rules;
                const ownerRules = groupData.policies?.owner?.rules;

                const extractActivation = (rules: typeof memberRules) => {
                    if (!rules) return { maxDuration: "", mfa: false, approval: false };
                    const parsed = parseGraphPolicy({ rules });
                    return {
                        maxDuration: parsed.maxActivationDuration,
                        mfa: parsed.activationRequirement !== "none",
                        approval: parsed.requireApproval,
                    };
                };

                const member = extractActivation(memberRules);
                const owner = extractActivation(ownerRules);

                const entry = {
                    memberMaxDuration: member.maxDuration,
                    memberMfa: member.mfa,
                    memberApproval: member.approval,
                    ownerMaxDuration: owner.maxDuration,
                    ownerMfa: owner.mfa,
                    ownerApproval: owner.approval,
                } satisfies GroupCurrentData;
                map.set(id, entry);
                map.set(name.toLowerCase(), entry);
            });
        }

        return map;
    }, [rolesData, groupsData]);

    // Compute per-row status for assignment/removal CSVs
    const rowStatuses = useMemo(() => {
        const map = new Map<number, RowStatus>();
        if (!parseResult) return map;
        const { csvType, rows } = parseResult;
        if (csvType !== "roleAssignments" && csvType !== "groupAssignments" &&
            csvType !== "roleAssignmentRemovals" && csvType !== "groupAssignmentRemovals") {
            return map;
        }

        const isRoleType = csvType === "roleAssignments" || csvType === "roleAssignmentRemovals";
        const isCsvRemoval = csvType === "roleAssignmentRemovals" || csvType === "groupAssignmentRemovals";

        for (const row of rows) {
            const r = row as ParsedRoleAssignmentRow | ParsedGroupAssignmentRow | ParsedRoleAssignmentRemovalRow | ParsedGroupAssignmentRemovalRow;
            // Combined assignment CSVs carry per-row action; dedicated removal CSVs are always remove
            const isRemoval = isCsvRemoval || (r as ParsedRoleAssignmentRow).action === "remove";

            if (isRoleType) {
                const roleRow = r as ParsedRoleAssignmentRow | ParsedRoleAssignmentRemovalRow;
                const roleData = roleRow.roleId
                    ? rolesData?.find(rd => rd.definition.id === roleRow.roleId)
                    : roleRow.roleName
                        ? rolesData?.find(rd => rd.definition.displayName.toLowerCase() === roleRow.roleName.toLowerCase().trim())
                        : undefined;

                if (!roleData) {
                    map.set(r.rowNumber, "not-found");
                    continue;
                }

                // Without principalId, we can't compare locally — optimistic default
                if (!roleRow.principalId) {
                    map.set(r.rowNumber, isRemoval ? "will-remove" : "new");
                    continue;
                }

                const assignmentType = roleRow.assignmentType;
                const assignments = assignmentType === "eligible"
                    ? roleData.assignments.eligible
                    : roleData.assignments.active;
                const exists = assignments.some(a => a.principalId === roleRow.principalId);

                if (isRemoval) {
                    map.set(r.rowNumber, exists ? "will-remove" : "already-removed");
                } else if (exists) {
                    map.set(r.rowNumber, "exists");
                } else {
                    const assignRow = roleRow as ParsedRoleAssignmentRow;
                    if (assignRow.durationDays === "permanent" && roleData.policy?.details?.rules) {
                        const ps = parseGraphPolicy({ rules: roleData.policy.details.rules });
                        const allowed = assignmentType === "eligible" ? ps.allowPermanentEligible : ps.allowPermanentActive;
                        map.set(r.rowNumber, allowed ? "new" : "permanent-blocked");
                    } else {
                        map.set(r.rowNumber, "new");
                    }
                }
            } else {
                const groupRow = r as ParsedGroupAssignmentRow | ParsedGroupAssignmentRemovalRow;
                const groupData = groupRow.groupId
                    ? groupsData?.find(g => g.group.id === groupRow.groupId)
                    : groupRow.groupName
                        ? groupsData?.find(g => g.group.displayName.toLowerCase() === groupRow.groupName.toLowerCase().trim())
                        : undefined;

                if (!groupData) {
                    map.set(r.rowNumber, "not-found");
                    continue;
                }

                if (!groupRow.principalId) {
                    map.set(r.rowNumber, isRemoval ? "will-remove" : "new");
                    continue;
                }

                const accessType = groupRow.accessType;
                const assignmentType = groupRow.assignmentType;
                const exists = groupData.assignments.some(a =>
                    a.principalId === groupRow.principalId &&
                    a.accessType === accessType &&
                    a.assignmentType === assignmentType
                );

                if (isRemoval) {
                    map.set(r.rowNumber, exists ? "will-remove" : "already-removed");
                } else if (exists) {
                    map.set(r.rowNumber, "exists");
                } else {
                    const assignRow = groupRow as ParsedGroupAssignmentRow;
                    if (assignRow.durationDays === "permanent") {
                        const rawPolicy = accessType === "member"
                            ? groupData.policies?.member
                            : groupData.policies?.owner;
                        if (rawPolicy?.rules) {
                            const ps = parseGraphPolicy({ rules: rawPolicy.rules });
                            const allowed = assignmentType === "eligible" ? ps.allowPermanentEligible : ps.allowPermanentActive;
                            map.set(r.rowNumber, allowed ? "new" : "permanent-blocked");
                        } else {
                            map.set(r.rowNumber, "new");
                        }
                    } else {
                        map.set(r.rowNumber, "new");
                    }
                }
            }
        }

        return map;
    }, [parseResult, rolesData, groupsData]);

    // Count of unique targets with at least one selected change
    const uniqueTargetCount = useMemo(() => {
        if (!parseResult) return 0;
        if (parseResult.csvType === "roleAssignments" || parseResult.csvType === "groupAssignments" ||
            parseResult.csvType === "roleAssignmentRemovals" || parseResult.csvType === "groupAssignmentRemovals") {
            return selectedRows.size;
        }
        const applicableFields = parseResult.csvType === "rolePolicies"
            ? ["maxActivationDuration", "mfaRequired", "justificationRequired", "approvalRequired"]
            : ["memberMaxDuration", "memberMfa", "memberApproval", "ownerMaxDuration", "ownerMfa", "ownerApproval"];
        return parseResult.rows.filter(row => {
            const name = parseResult.csvType === "rolePolicies"
                ? (row as ParsedRolePolicyRow).roleName
                : (row as ParsedGroupPolicyRow).groupName;
            return applicableFields.some(f => selectedChanges.has(`${name}-${f}`));
        }).length;
    }, [parseResult, selectedChanges, selectedRows]);

    // Handle file loaded
    const handleFileLoaded = useCallback((content: string, filename: string) => {
        setIsLoading(true);

        try {
            const result = CsvParserService.parse(content);
            const rowCount = CsvParserService.getRowCount(content);

            setCurrentFile({ name: filename, rowCount });
            setParseResult(result);
            setConsentChecked(false);

            if (result.success) {
                const requiredWorkload: WorkloadType =
                    (result.csvType === "rolePolicies" || result.csvType === "roleAssignments" || result.csvType === "roleAssignmentRemovals")
                        ? "directoryRoles"
                        : "pimGroups";

                const dataIsLoading = requiredWorkload === "directoryRoles"
                    ? rolesLoading
                    : isWorkloadLoading("pimGroups");
                if (dataIsLoading) {
                    toast.warning("Data Still Loading", "Current role/group data is still being fetched. Diff comparison may be incomplete.");
                }

                if (!isWriteConsentGranted(requiredWorkload)) {
                    setMissingWriteConsent(true);
                    setDetectedWorkload(requiredWorkload);
                    toast.warning("Write Permission Required", "Grant write permissions in Settings to continue");
                    return;
                }

                // Warn if group CSV loaded without PIM Groups data
                const isGroupCsv = result.csvType === "groupAssignments" || result.csvType === "groupPolicies" || result.csvType === "groupAssignmentRemovals";
                if (isGroupCsv && (!groupsData || groupsData.length === 0) && !isWorkloadLoading("pimGroups")) {
                    toast.warning(
                        "PIM Groups Not Loaded",
                        "Enable the PIM Groups workload (chip at the top) and wait for data to load before processing this CSV."
                    );
                }

                // Assignment and removal CSVs: auto-select all rows
                if (result.csvType === "roleAssignments" || result.csvType === "groupAssignments" ||
                    result.csvType === "roleAssignmentRemovals" || result.csvType === "groupAssignmentRemovals") {
                    const allRowNumbers = new Set((result.rows as AnyParsedRow[]).map(r => r.rowNumber));
                    setSelectedRows(allRowNumbers);
                    setStep("compare");
                    const noun = (result.csvType === "roleAssignmentRemovals" || result.csvType === "groupAssignmentRemovals") ? "removal" : "assignment";
                    toast.success("CSV Loaded", `Successfully parsed ${rowCount} ${noun} row${rowCount !== 1 ? 's' : ''}`);
                    return;
                }

                // Policy CSVs: pre-select only changed fields
                const initialChangeIds = new Set<string>();
                const applicableFields = result.csvType === "rolePolicies"
                    ? ["maxActivationDuration", "mfaRequired", "justificationRequired", "approvalRequired"]
                    : ["memberMaxDuration", "memberMfa", "memberApproval", "ownerMaxDuration", "ownerMfa", "ownerApproval"];
                result.rows.forEach((row) => {
                    const isRole = result.csvType === "rolePolicies";
                    const name = isRole
                        ? (row as ParsedRolePolicyRow).roleName
                        : (row as ParsedGroupPolicyRow).groupName;
                    const id = isRole
                        ? (row as ParsedRolePolicyRow).roleId
                        : (row as ParsedGroupPolicyRow).groupId;
                    const current = (id && currentDataMap.get(id)) || currentDataMap.get(name.toLowerCase());
                    const rowRecord = row as unknown as Record<string, unknown>;
                    applicableFields.forEach(field => {
                        if (current === undefined) {
                            initialChangeIds.add(`${name}-${field}`);
                        } else if (current[field] !== rowRecord[field]) {
                            initialChangeIds.add(`${name}-${field}`);
                        }
                    });
                });
                setSelectedChanges(initialChangeIds);

                setStep("compare");
                toast.success("CSV Loaded", `Successfully parsed ${rowCount} configuration row${rowCount !== 1 ? 's' : ''}`);
            }
        } catch (error) {
            Logger.error("BulkMode", "CSV parse error", error);
            toast.error("Parse Error", "Failed to parse CSV file");
        } finally {
            setIsLoading(false);
        }
    }, [toast, currentDataMap, rolesLoading, isWorkloadLoading, groupsData]);

    // Handle clear file
    const handleClear = useCallback(() => {
        setCurrentFile(null);
        setParseResult(null);
        setSelectedChanges(new Set());
        setSelectedRows(new Set());
        setStep("upload");
        setApplyResults([]);
        setApplyPhase("idle");
        setMissingWriteConsent(false);
        setDetectedWorkload(null);
        setConsentChecked(false);
    }, []);

    // Policy selection handlers
    const handleSelectionChange = useCallback((changeId: string, selected: boolean) => {
        setSelectedChanges(prev => {
            const next = new Set(prev);
            if (selected) next.add(changeId); else next.delete(changeId);
            return next;
        });
        setConsentChecked(false);
    }, []);

    const handleSelectAll = useCallback((selected: boolean) => {
        if (!selected) {
            setSelectedChanges(new Set());
            setConsentChecked(false);
            return;
        }
        if (!parseResult) return;

        const applicableFields = parseResult.csvType === "rolePolicies"
            ? ["maxActivationDuration", "mfaRequired", "justificationRequired", "approvalRequired"]
            : ["memberMaxDuration", "memberMfa", "memberApproval", "ownerMaxDuration", "ownerMfa", "ownerApproval"];
        const allIds = new Set<string>();
        parseResult.rows.forEach((row) => {
            const isRole = parseResult.csvType === "rolePolicies";
            const name = isRole
                ? (row as ParsedRolePolicyRow).roleName
                : (row as ParsedGroupPolicyRow).groupName;
            const id = isRole
                ? (row as ParsedRolePolicyRow).roleId
                : (row as ParsedGroupPolicyRow).groupId;
            const current = (id && currentDataMap.get(id)) || currentDataMap.get(name.toLowerCase());
            const rowRecord = row as unknown as Record<string, unknown>;
            applicableFields.forEach(field => {
                if (current === undefined) {
                    allIds.add(`${name}-${field}`);
                } else if (current[field] !== rowRecord[field]) {
                    allIds.add(`${name}-${field}`);
                }
            });
        });
        setSelectedChanges(allIds);
        setConsentChecked(false);
    }, [parseResult, currentDataMap]);

    // Assignment/removal row selection handlers
    const handleRowSelectionChange = useCallback((rowNumber: number, selected: boolean) => {
        setSelectedRows(prev => {
            const next = new Set(prev);
            if (selected) next.add(rowNumber); else next.delete(rowNumber);
            return next;
        });
        setConsentChecked(false);
    }, []);

    const handleSetSelectedRows = useCallback((rows: Set<number>) => {
        setSelectedRows(rows);
        setConsentChecked(false);
    }, []);

    // Close progress modal and navigate to results
    const handleProgressClose = useCallback(() => {
        setShowProgress(false);
        setStep("results");
    }, []);

    // Post-apply: refresh data + 3s validating phase, then allow close
    const runPostApplyValidation = useCallback(async (workload: WorkloadType) => {
        setApplyPhase("validating");
        setProgressTitle("Verifying changes…");
        void refreshWorkload(workload, true);
        await new Promise(resolve => setTimeout(resolve, 3000));
        setApplyPhase("complete");
        setProgressTitle("Changes Applied");
        setCanCloseProgress(true);
    }, [refreshWorkload]);

    // Apply policy changes
    const handleApply = useCallback(async () => {
        if (selectedChanges.size === 0) {
            toast.warning("No Changes Selected", "Please select at least one change to apply");
            return;
        }
        if (!parseResult) return;

        if (parseResult.csvType === "rolePolicies" && (!rolesData || rolesData.length === 0)) {
            toast.error("Data Not Loaded", "Role data hasn't finished loading yet. Wait for the dashboard to fully load, then try again.");
            return;
        }
        if (parseResult.csvType === "groupPolicies" && (!groupsData || groupsData.length === 0)) {
            toast.error("Data Not Loaded", "PIM Groups data hasn't finished loading yet. Enable the PIM Groups workload and wait for it to load.");
            return;
        }

        const applicableRoleFields = ["maxActivationDuration", "mfaRequired", "justificationRequired", "approvalRequired"];
        const allGroupFields = ["memberMaxDuration", "memberMfa", "memberApproval", "ownerMaxDuration", "ownerMfa", "ownerApproval"];

        let targetNames: string[];
        if (parseResult.csvType === "rolePolicies") {
            const rows = parseResult.rows as ParsedRolePolicyRow[];
            targetNames = rows
                .filter(row => applicableRoleFields.some(f => selectedChanges.has(`${row.roleName}-${f}`)))
                .map(row => row.roleName);
        } else {
            const rows = parseResult.rows as ParsedGroupPolicyRow[];
            targetNames = rows
                .filter(row => allGroupFields.some(f => selectedChanges.has(`${row.groupName}-${f}`)))
                .map(row => row.groupName);
        }

        const steps: ProgressStep[] = targetNames.map(name => ({
            id: name,
            label: name,
            status: "pending" as const,
            details: parseResult.csvType === "rolePolicies" ? "Role policy update" : "Group policy update",
        }));
        setProgressSteps(steps);
        setProgressTitle("Applying Changes");
        setShowProgress(true);
        setCanCloseProgress(false);
        setApplyPhase("applying");

        const updateStep = (name: string, status: ProgressStep["status"]) => {
            setProgressSteps(prev => prev.map(s => s.id === name ? { ...s, status } : s));
        };

        setIsLoading(true);
        const results: ApplyResult[] = [];

        if (parseResult.csvType === "rolePolicies") {
            const rows = parseResult.rows as ParsedRolePolicyRow[];
            const affectedRows = rows.filter(row =>
                applicableRoleFields.some(field => selectedChanges.has(`${row.roleName}-${field}`))
            );

            for (const row of affectedRows) {
                updateStep(row.roleName, "loading");
                const roleData = row.roleId
                    ? rolesData?.find(r => r.definition.id === row.roleId)
                    : rolesData?.find(r => r.definition.displayName.toLowerCase() === row.roleName.toLowerCase().trim());

                if (!roleData) {
                    updateStep(row.roleName, "error");
                    results.push({ id: row.roleName, name: row.roleName, field: "Policy settings", success: false, message: "Role not found in loaded data — refresh data and retry" });
                    continue;
                }

                try {
                    const roleClient = await getGraphClient();
                    const current = await getPolicySettings(roleData.definition.id);
                    if (!current?.rules) throw new Error("Could not fetch current policy settings");

                    const policySettings: PolicySettings = { ...parseGraphPolicy({ rules: current.rules }) };

                    if (selectedChanges.has(`${row.roleName}-maxActivationDuration`)) {
                        policySettings.maxActivationDuration = row.maxActivationDuration;
                    }
                    if (selectedChanges.has(`${row.roleName}-mfaRequired`)) {
                        policySettings.activationRequirement = row.mfaRequired ? "mfa" : "none";
                    }
                    if (selectedChanges.has(`${row.roleName}-justificationRequired`)) {
                        policySettings.requireJustificationOnActivation = row.justificationRequired;
                    }
                    if (selectedChanges.has(`${row.roleName}-approvalRequired`)) {
                        policySettings.requireApproval = row.approvalRequired;
                    }

                    await applyDirectoryRolePolicies(roleClient, [roleData.definition.id], policySettings);
                    updateStep(row.roleName, "success");
                    results.push({ id: roleData.definition.id, name: row.roleName, field: "Policy settings", success: true, message: "Policy updated successfully" });
                } catch (error: unknown) {
                    updateStep(row.roleName, "error");
                    const message = error instanceof Error ? error.message : "Failed to update policy";
                    results.push({ id: row.roleName, name: row.roleName, field: "Policy settings", success: false, message });
                }
            }

        } else if (parseResult.csvType === "groupPolicies") {
            const groupClient = await getGraphClient().catch(() => null);
            if (!groupClient) {
                toast.error("Not Authenticated", "Could not get Graph client. Please re-authenticate.");
                setIsLoading(false);
                setShowProgress(false);
                return;
            }

            const rows = parseResult.rows as ParsedGroupPolicyRow[];
            const memberFields = ["memberMaxDuration", "memberMfa", "memberApproval"];
            const ownerFields = ["ownerMaxDuration", "ownerMfa", "ownerApproval"];
            const affectedRows = rows.filter(row =>
                [...memberFields, ...ownerFields].some(field => selectedChanges.has(`${row.groupName}-${field}`))
            );

            for (const row of affectedRows) {
                updateStep(row.groupName, "loading");
                const groupData = row.groupId
                    ? groupsData?.find(g => g.group.id === row.groupId)
                    : groupsData?.find(g => g.group.displayName.toLowerCase() === row.groupName.toLowerCase().trim());

                if (!groupData) {
                    updateStep(row.groupName, "error");
                    results.push({ id: row.groupName, name: row.groupName, field: "Policy settings", success: false, message: "Group not found in loaded data — refresh data and retry" });
                    continue;
                }

                try {
                    const hasMemberChanges = memberFields.some(f => selectedChanges.has(`${row.groupName}-${f}`));
                    const hasOwnerChanges = ownerFields.some(f => selectedChanges.has(`${row.groupName}-${f}`));

                    if (hasMemberChanges) {
                        const memberRules = groupData.policies?.member?.rules;
                        const memberSettings: PolicySettings = memberRules
                            ? { ...parseGraphPolicy({ rules: memberRules }) }
                            : { ...DEFAULT_POLICY_SETTINGS };
                        if (selectedChanges.has(`${row.groupName}-memberMaxDuration`)) {
                            memberSettings.maxActivationDuration = row.memberMaxDuration || memberSettings.maxActivationDuration;
                        }
                        if (selectedChanges.has(`${row.groupName}-memberMfa`)) {
                            memberSettings.activationRequirement = row.memberMfa ? "mfa" : "none";
                        }
                        if (selectedChanges.has(`${row.groupName}-memberApproval`)) {
                            memberSettings.requireApproval = row.memberApproval;
                        }
                        await applyGroupPolicies(groupClient, [groupData.group.id], memberSettings, "member");
                    }
                    if (hasOwnerChanges) {
                        const ownerRules = groupData.policies?.owner?.rules;
                        const ownerSettings: PolicySettings = ownerRules
                            ? { ...parseGraphPolicy({ rules: ownerRules }) }
                            : { ...DEFAULT_POLICY_SETTINGS };
                        if (selectedChanges.has(`${row.groupName}-ownerMaxDuration`)) {
                            ownerSettings.maxActivationDuration = row.ownerMaxDuration || ownerSettings.maxActivationDuration;
                        }
                        if (selectedChanges.has(`${row.groupName}-ownerMfa`)) {
                            ownerSettings.activationRequirement = row.ownerMfa ? "mfa" : "none";
                        }
                        if (selectedChanges.has(`${row.groupName}-ownerApproval`)) {
                            ownerSettings.requireApproval = row.ownerApproval;
                        }
                        await applyGroupPolicies(groupClient, [groupData.group.id], ownerSettings, "owner");
                    }

                    updateStep(row.groupName, "success");
                    results.push({ id: groupData.group.id, name: row.groupName, field: "Policy settings", success: true, message: "Policy updated successfully" });
                } catch (error: unknown) {
                    updateStep(row.groupName, "error");
                    const message = error instanceof Error ? error.message : "Failed to update policy";
                    results.push({ id: row.groupName, name: row.groupName, field: "Policy settings", success: false, message });
                }
            }
        }

        setApplyResults(results);
        setIsLoading(false);

        const successCount = results.filter(r => r.success).length;
        const failCount = results.filter(r => !r.success).length;
        if (failCount === 0) {
            toast.success("All Changes Applied", `Successfully updated ${successCount} ${parseResult.csvType === "rolePolicies" ? "role" : "group"}${successCount !== 1 ? "s" : ""}`);
        } else {
            toast.warning("Partial Success", `${successCount} succeeded, ${failCount} failed`);
        }

        const workload: WorkloadType = parseResult.csvType === "rolePolicies" ? "directoryRoles" : "pimGroups";
        await runPostApplyValidation(workload);
    }, [selectedChanges, parseResult, toast, rolesData, groupsData, getPolicySettings, getGraphClient, runPostApplyValidation]);

    // Apply assignment rows (handles add and remove actions in one pass)
    const handleApplyAssignments = useCallback(async () => {
        if (selectedRows.size === 0) {
            toast.warning("No Rows Selected", "Please select at least one row");
            return;
        }
        if (!parseResult) return;

        const isRoleAssignments = parseResult.csvType === "roleAssignments";

        if (isRoleAssignments && (!rolesData || rolesData.length === 0)) {
            toast.error("Data Not Loaded", "Role data hasn't finished loading yet. Wait for the dashboard to fully load, then try again.");
            return;
        }
        if (!isRoleAssignments && (!groupsData || groupsData.length === 0)) {
            toast.error("Data Not Loaded", "PIM Groups data hasn't finished loading yet. Enable the PIM Groups workload and wait for it to load.");
            return;
        }

        const rows = (parseResult.rows as (ParsedRoleAssignmentRow | ParsedGroupAssignmentRow)[]).filter(r => selectedRows.has(r.rowNumber));
        const addRows = rows.filter(r => r.action !== "remove");
        const removeRows = rows.filter(r => r.action === "remove");

        const steps: ProgressStep[] = rows.map(row => ({
            id: String(row.rowNumber),
            label: isRoleAssignments
                ? `${(row as ParsedRoleAssignmentRow).roleName || (row as ParsedRoleAssignmentRow).roleId} — ${row.principalUPN || row.principalId}`
                : `${(row as ParsedGroupAssignmentRow).groupName || (row as ParsedGroupAssignmentRow).groupId} — ${row.principalUPN || row.principalId}`,
            status: "pending" as const,
            details: `${row.action === "remove" ? "Remove" : "Add"} ${row.assignmentType}`,
        }));
        setProgressSteps(steps);
        const hasRemoves = removeRows.length > 0;
        const hasAdds = addRows.length > 0;
        setProgressTitle(hasAdds && hasRemoves ? "Applying Changes" : hasRemoves ? "Removing Assignments" : "Creating Assignments");
        setShowProgress(true);
        setCanCloseProgress(false);
        setApplyPhase("applying");
        setIsLoading(true);

        const updateStep = (rowNumber: number, status: ProgressStep["status"], details?: string) => {
            setProgressSteps(prev => prev.map(s => s.id === String(rowNumber) ? { ...s, status, ...(details ? { details } : {}) } : s));
        };

        const results: ApplyResult[] = [];

        try {
            const graphClient = await getGraphClient();

            // --- ADD rows ---
            for (const row of addRows) {
                updateStep(row.rowNumber, "loading");
                try {
                    let principalId = row.principalId;
                    if (!principalId && row.principalUPN) {
                        const res = await graphClient.api("/users")
                            .filter(`userPrincipalName eq '${row.principalUPN}'`)
                            .select("id")
                            .get() as { value: { id: string }[] };
                        if (!res.value?.length) throw new Error(`User not found via UPN: ${row.principalUPN}. For groups or service principals, provide a Principal ID instead.`);
                        principalId = res.value[0].id;
                    }
                    if (!principalId) throw new Error("No Principal ID (Object ID) provided. UPN fallback is supported for users only — groups and service principals require a Principal ID.");

                    const durationDays = row.durationDays;
                    const isPermanent = durationDays === "permanent";
                    const endDateTime = (!isPermanent && durationDays && !isNaN(parseInt(durationDays, 10)))
                        ? new Date(Date.now() + parseInt(durationDays, 10) * 86400000).toISOString()
                        : undefined;

                    if (isRoleAssignments) {
                        const roleRow = row as ParsedRoleAssignmentRow;
                        const roleData = roleRow.roleId
                            ? rolesData?.find(r => r.definition.id === roleRow.roleId)
                            : rolesData?.find(r => r.definition.displayName.toLowerCase() === roleRow.roleName.toLowerCase().trim());
                        if (!roleData) throw new Error(`Role not found: ${roleRow.roleName || roleRow.roleId}`);

                        const rolePolicySettings = roleData.policy?.details?.rules
                            ? parseGraphPolicy({ rules: roleData.policy.details.rules })
                            : null;
                        const allowPermanent = roleRow.assignmentType === "eligible"
                            ? (rolePolicySettings?.allowPermanentEligible ?? false)
                            : (rolePolicySettings?.allowPermanentActive ?? false);

                        await applyDirectoryRoleAssignments(graphClient, [roleData.definition.id], {
                            principalIds: [principalId],
                            assignmentType: roleRow.assignmentType,
                            duration: isPermanent ? "permanent" as const : undefined,
                            endDateTime,
                            justification: roleRow.justification || "Configured via PIM Manager Bulk Import",
                            directoryScopeId: "/",
                        }, allowPermanent);
                        updateStep(row.rowNumber, "success");
                        results.push({ id: principalId, name: steps.find(s => s.id === String(row.rowNumber))?.label ?? String(row.rowNumber), field: "Assignment", success: true, message: "Assignment created successfully" });
                    } else {
                        const groupRow = row as ParsedGroupAssignmentRow;
                        const groupData = groupRow.groupId
                            ? groupsData?.find(g => g.group.id === groupRow.groupId)
                            : groupsData?.find(g => g.group.displayName.toLowerCase() === groupRow.groupName.toLowerCase().trim());
                        if (!groupData) throw new Error(`Group not found: ${groupRow.groupName || groupRow.groupId}`);

                        const groupRawPolicy = groupRow.accessType === "member"
                            ? groupData.policies?.member
                            : groupData.policies?.owner;
                        const groupPolicySettings = groupRawPolicy?.rules
                            ? parseGraphPolicy({ rules: groupRawPolicy.rules })
                            : null;
                        const allowPermanent = groupRow.assignmentType === "eligible"
                            ? (groupPolicySettings?.allowPermanentEligible ?? false)
                            : (groupPolicySettings?.allowPermanentActive ?? false);

                        await applyGroupAssignments(graphClient, [groupData.group.id], {
                            principalIds: [principalId],
                            assignmentType: groupRow.assignmentType,
                            accessType: groupRow.accessType,
                            duration: isPermanent ? "permanent" as const : undefined,
                            endDateTime,
                            justification: groupRow.justification || "Configured via PIM Manager Bulk Import",
                        }, allowPermanent);
                        updateStep(row.rowNumber, "success");
                        results.push({ id: principalId, name: steps.find(s => s.id === String(row.rowNumber))?.label ?? String(row.rowNumber), field: "Assignment", success: true, message: "Assignment created successfully" });
                    }
                } catch (error: unknown) {
                    updateStep(row.rowNumber, "error");
                    const message = error instanceof Error ? error.message : "Failed to create assignment";
                    results.push({ id: String(row.rowNumber), name: steps.find(s => s.id === String(row.rowNumber))?.label ?? String(row.rowNumber), field: "Assignment", success: false, message });
                }
            }

            // --- REMOVE rows ---
            if (removeRows.length > 0) {
                const resolvedRemovals: BulkRemovalRequest[] = [];

                for (const row of removeRows) {
                    updateStep(row.rowNumber, "loading");
                    try {
                        let principalId = row.principalId;
                        if (!principalId && row.principalUPN) {
                            const res = await graphClient.api("/users")
                                .filter(`userPrincipalName eq '${row.principalUPN}'`)
                                .select("id")
                                .get() as { value: { id: string }[] };
                            if (!res.value?.length) throw new Error(`User not found via UPN: ${row.principalUPN}. For groups or service principals, provide a Principal ID instead.`);
                            principalId = res.value[0].id;
                        }
                        if (!principalId) throw new Error("No Principal ID (Object ID) provided.");

                        if (isRoleAssignments) {
                            const roleRow = row as ParsedRoleAssignmentRow;
                            let roleDefinitionId = roleRow.roleId;
                            if (!roleDefinitionId && roleRow.roleName) {
                                const rd = rolesData?.find(r => r.definition.displayName.toLowerCase() === roleRow.roleName.toLowerCase().trim());
                                if (!rd) throw new Error(`Role not found: ${roleRow.roleName}`);
                                roleDefinitionId = rd.definition.id;
                            }
                            if (!roleDefinitionId) throw new Error("No Role ID or Role Name provided");
                            resolvedRemovals.push({ principalId, roleDefinitionId, assignmentType: roleRow.assignmentType, directoryScopeId: "/", rowNumber: row.rowNumber });
                        } else {
                            const groupRow = row as ParsedGroupAssignmentRow;
                            let groupId = groupRow.groupId;
                            if (!groupId && groupRow.groupName) {
                                const gd = groupsData?.find(g => g.group.displayName.toLowerCase() === groupRow.groupName.toLowerCase().trim());
                                if (!gd) throw new Error(`Group not found: ${groupRow.groupName}`);
                                groupId = gd.group.id;
                            }
                            if (!groupId) throw new Error("No Group ID or Group Name provided");
                            resolvedRemovals.push({ principalId, groupId, accessType: groupRow.accessType, assignmentType: groupRow.assignmentType, rowNumber: row.rowNumber });
                        }
                    } catch (error: unknown) {
                        updateStep(row.rowNumber, "error");
                        const message = error instanceof Error ? error.message : "Failed to resolve identifiers";
                        results.push({ id: String(row.rowNumber), name: steps.find(s => s.id === String(row.rowNumber))?.label ?? String(row.rowNumber), field: "Removal", success: false, message });
                    }
                }

                if (resolvedRemovals.length > 0) {
                    const applyFn = isRoleAssignments ? applyBulkRoleRemovals : applyBulkGroupRemovals;
                    const opResults = await applyFn(graphClient, resolvedRemovals, () => {});
                    opResults.forEach((op, idx) => {
                        const rn = resolvedRemovals[idx]?.rowNumber;
                        if (rn !== undefined) {
                            updateStep(rn, op.success ? "success" : "error");
                            results.push({ id: op.targetId, name: steps.find(s => s.id === String(rn))?.label ?? String(rn), field: "Removal", success: op.success, message: op.warning ?? op.error ?? (op.success ? "Removed successfully" : "Removal failed") });
                        }
                    });
                }
            }
        } catch {
            toast.error("Not Authenticated", "Could not get Graph client. Please re-authenticate.");
            setIsLoading(false);
            setShowProgress(false);
            return;
        }

        setApplyResults(results);
        setIsLoading(false);

        const successCount = results.filter(r => r.success).length;
        const failCount = results.filter(r => !r.success).length;
        if (failCount === 0) {
            toast.success("All Changes Applied", `${successCount} operation${successCount !== 1 ? "s" : ""} completed successfully`);
        } else {
            toast.warning("Partial Success", `${successCount} succeeded, ${failCount} failed`);
        }

        const workload: WorkloadType = parseResult.csvType === "roleAssignments" ? "directoryRoles" : "pimGroups";
        await runPostApplyValidation(workload);
    }, [selectedRows, parseResult, rolesData, groupsData, getGraphClient, toast, runPostApplyValidation]);

    // Apply assignment removals
    const handleApplyRemovals = useCallback(async () => {
        if (selectedRows.size === 0) {
            toast.warning("No Rows Selected", "Please select at least one removal to apply");
            return;
        }
        if (!parseResult) return;

        const isRoleRemovals = parseResult.csvType === "roleAssignmentRemovals";
        const rows = (parseResult.rows as (ParsedRoleAssignmentRemovalRow | ParsedGroupAssignmentRemovalRow)[])
            .filter(r => selectedRows.has(r.rowNumber));

        const steps: ProgressStep[] = rows.map(row => ({
            id: String(row.rowNumber),
            label: isRoleRemovals
                ? `${(row as ParsedRoleAssignmentRemovalRow).roleName || (row as ParsedRoleAssignmentRemovalRow).roleId} — ${row.principalUPN || row.principalId}`
                : `${(row as ParsedGroupAssignmentRemovalRow).groupName || (row as ParsedGroupAssignmentRemovalRow).groupId} — ${row.principalUPN || row.principalId}`,
            status: "pending" as const,
            details: `Remove ${row.assignmentType} assignment`,
        }));
        setProgressSteps(steps);
        setProgressTitle("Removing Assignments");
        setShowProgress(true);
        setCanCloseProgress(false);
        setApplyPhase("applying");
        setIsLoading(true);

        const updateStep = (rowNumber: number, status: ProgressStep["status"], details?: string) => {
            setProgressSteps(prev => prev.map(s => s.id === String(rowNumber) ? { ...s, status, ...(details ? { details } : {}) } : s));
        };

        const results: ApplyResult[] = [];

        try {
            const graphClient = await getGraphClient();
            const resolvedRemovals: BulkRemovalRequest[] = [];

            // Resolution phase
            for (const row of rows) {
                updateStep(row.rowNumber, "loading");
                try {
                    let principalId = row.principalId;
                    if (!principalId && row.principalUPN) {
                        const res = await graphClient.api("/users")
                            .filter(`userPrincipalName eq '${row.principalUPN}'`)
                            .select("id")
                            .get() as { value: { id: string }[] };
                        if (!res.value?.length) throw new Error(`User not found via UPN: ${row.principalUPN}. For groups or service principals, provide a Principal ID instead.`);
                        principalId = res.value[0].id;
                    }
                    if (!principalId) throw new Error("No Principal ID (Object ID) provided. UPN fallback is supported for users only — groups and service principals require a Principal ID.");

                    if (isRoleRemovals) {
                        const roleRow = row as ParsedRoleAssignmentRemovalRow;
                        let roleDefinitionId = roleRow.roleId;
                        if (!roleDefinitionId && roleRow.roleName) {
                            const roleData = rolesData?.find(r =>
                                r.definition.displayName.toLowerCase() === roleRow.roleName.toLowerCase().trim()
                            );
                            if (!roleData) throw new Error(`Role not found: ${roleRow.roleName}`);
                            roleDefinitionId = roleData.definition.id;
                        }
                        if (!roleDefinitionId) throw new Error("No Role ID or Role Name provided");

                        resolvedRemovals.push({
                            principalId,
                            roleDefinitionId,
                            assignmentType: roleRow.assignmentType,
                            directoryScopeId: roleRow.scopeId || "/",
                            rowNumber: row.rowNumber,
                        });
                    } else {
                        const groupRow = row as ParsedGroupAssignmentRemovalRow;
                        let groupId = groupRow.groupId;
                        if (!groupId && groupRow.groupName) {
                            const groupData = groupsData?.find(g =>
                                g.group.displayName.toLowerCase() === groupRow.groupName.toLowerCase().trim()
                            );
                            if (!groupData) throw new Error(`Group not found: ${groupRow.groupName}`);
                            groupId = groupData.group.id;
                        }
                        if (!groupId) throw new Error("No Group ID or Group Name provided");

                        resolvedRemovals.push({
                            principalId,
                            groupId,
                            accessType: groupRow.accessType,
                            assignmentType: groupRow.assignmentType,
                            rowNumber: row.rowNumber,
                        });
                    }
                } catch (error: unknown) {
                    updateStep(row.rowNumber, "error");
                    const message = error instanceof Error ? error.message : "Failed to resolve identifiers";
                    results.push({
                        id: String(row.rowNumber),
                        name: steps.find(s => s.id === String(row.rowNumber))?.label ?? String(row.rowNumber),
                        field: "Removal",
                        success: false,
                        message
                    });
                }
            }

            // Apply phase
            const applyFn = isRoleRemovals ? applyBulkRoleRemovals : applyBulkGroupRemovals;
            const opResults = await applyFn(
                graphClient,
                resolvedRemovals,
                (current, total) => {
                    if (current <= resolvedRemovals.length && resolvedRemovals[current - 1]) {
                        updateStep(resolvedRemovals[current - 1].rowNumber, current <= total ? "loading" : "success");
                    }
                }
            );

            opResults.forEach((op, idx) => {
                const rn = resolvedRemovals[idx]?.rowNumber;
                if (rn !== undefined) {
                    updateStep(rn, op.success ? "success" : "error");
                    results.push({
                        id: op.targetId,
                        name: steps.find(s => s.id === String(rn))?.label ?? String(rn),
                        field: "Removal",
                        success: op.success,
                        message: op.warning ?? op.error ?? (op.success ? "Removed successfully" : "Removal failed")
                    });
                }
            });

        } catch {
            toast.error("Not Authenticated", "Could not get Graph client. Please re-authenticate.");
            setIsLoading(false);
            setShowProgress(false);
            return;
        }

        setApplyResults(results);
        setIsLoading(false);

        const successCount = results.filter(r => r.success).length;
        const failCount = results.filter(r => !r.success).length;
        if (failCount === 0) {
            toast.success("All Removals Applied", `Successfully removed ${successCount} assignment${successCount !== 1 ? "s" : ""}`);
        } else {
            toast.warning("Partial Success", `${successCount} succeeded, ${failCount} failed`);
        }

        const workload: WorkloadType = isRoleRemovals ? "directoryRoles" : "pimGroups";
        await runPostApplyValidation(workload);
    }, [selectedRows, parseResult, rolesData, groupsData, getGraphClient, toast, runPostApplyValidation]);

    // Export apply results to CSV
    const handleExportResults = useCallback(() => {
        const csvRows = [
            ["Target", "Status", "Message"],
            ...applyResults.map(r => [r.name, r.success ? "Success" : "Failed", r.message])
        ];
        const csv = csvRows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `bulk-apply-results-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, [applyResults]);

    // Retry failed items
    const handleRetryFailed = useCallback(() => {
        if (!parseResult) return;

        const isRowBased =
            parseResult.csvType === "roleAssignments" || parseResult.csvType === "groupAssignments" ||
            parseResult.csvType === "roleAssignmentRemovals" || parseResult.csvType === "groupAssignmentRemovals";

        if (isRowBased) {
            const failedLabels = new Set(applyResults.filter(r => !r.success).map(r => r.name));
            const retryRowNumbers = new Set<number>();
            (parseResult.rows as (ParsedRoleAssignmentRow | ParsedGroupAssignmentRow | ParsedRoleAssignmentRemovalRow | ParsedGroupAssignmentRemovalRow)[]).forEach(row => {
                const isRole = "roleName" in row;
                const resourceName = isRole
                    ? ((row as ParsedRoleAssignmentRow).roleName || (row as ParsedRoleAssignmentRow).roleId)
                    : ((row as ParsedGroupAssignmentRow).groupName || (row as ParsedGroupAssignmentRow).groupId);
                const label = `${resourceName} — ${row.principalUPN || row.principalId}`;
                if (failedLabels.has(label)) retryRowNumbers.add(row.rowNumber);
            });
            setSelectedRows(retryRowNumbers);
            setConsentChecked(false);
            setApplyResults([]);
            setApplyPhase("idle");
            setStep("compare");
            return;
        }

        const failedNames = new Set(applyResults.filter(r => !r.success).map(r => r.name));
        const retryIds = new Set<string>();
        const fields = parseResult.csvType === "rolePolicies"
            ? ["maxActivationDuration", "mfaRequired", "justificationRequired", "approvalRequired"]
            : ["memberMaxDuration", "memberMfa", "memberApproval", "ownerMaxDuration", "ownerMfa", "ownerApproval"];
        parseResult.rows.forEach(row => {
            const name = parseResult.csvType === "rolePolicies"
                ? (row as ParsedRolePolicyRow).roleName
                : (row as ParsedGroupPolicyRow).groupName;
            if (failedNames.has(name)) {
                fields.forEach(f => retryIds.add(`${name}-${f}`));
            }
        });
        setSelectedChanges(retryIds);
        setConsentChecked(false);
        setApplyResults([]);
        setApplyPhase("idle");
        setStep("compare");
    }, [parseResult, applyResults]);

    // Render step content
    const renderStepContent = () => {
        switch (step) {
            case "upload":
                return (
                    <div className="max-w-2xl mx-auto">
                        <div className="bg-white dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl p-6">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                                    <FileSpreadsheet className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                                        Upload Configuration CSV
                                    </h2>
                                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                                        Upload a CSV file to bulk-configure PIM settings
                                    </p>
                                </div>
                            </div>

                            {/* Write consent warning */}
                            {missingWriteConsent && (
                                <div className="mb-4 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg flex items-start gap-3">
                                    <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                                    <div className="flex-1">
                                        <h4 className="text-sm font-medium text-amber-900 dark:text-amber-100">Write permissions required</h4>
                                        <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                                            To apply changes, you must grant write permissions for{" "}
                                            {detectedWorkload === "directoryRoles" ? "Directory Roles" : "PIM Groups"}.
                                        </p>
                                        <button
                                            onClick={() => setShowSettingsModal(true)}
                                            className="mt-2 text-sm font-medium text-amber-700 dark:text-amber-300 underline hover:text-amber-800 dark:hover:text-amber-200"
                                        >
                                            Open Settings
                                        </button>
                                    </div>
                                </div>
                            )}

                            <CsvUploader
                                onFileLoaded={handleFileLoaded}
                                onClear={handleClear}
                                isLoading={isLoading}
                                currentFile={currentFile}
                            />

                            {/* Persistent validation errors */}
                            {parseResult && !parseResult.success && parseResult.errors.length > 0 && (
                                <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                                    <h4 className="text-sm font-semibold text-red-800 dark:text-red-300 mb-2 flex items-center gap-2">
                                        <XCircle className="h-4 w-4 flex-shrink-0" />
                                        {parseResult.errors.length} validation error{parseResult.errors.length !== 1 ? 's' : ''} — fix and re-upload
                                    </h4>
                                    <ul className="space-y-1">
                                        {parseResult.errors.map((error, idx) => (
                                            <li key={idx} className="text-sm text-red-700 dark:text-red-400 flex items-start gap-1.5">
                                                <X className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                                                <span>
                                                    {error.rowNumber > 0 && <strong>Row {error.rowNumber} — </strong>}
                                                    {error.field}: {error.message}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    </div>
                );

            case "compare": {
                const isAssignmentCsv = parseResult?.csvType === "roleAssignments" || parseResult?.csvType === "groupAssignments";
                const isRemovalCsv = parseResult?.csvType === "roleAssignmentRemovals" || parseResult?.csvType === "groupAssignmentRemovals";
                const isRowBased = isAssignmentCsv || isRemovalCsv;
                const activeCount = isRowBased ? selectedRows.size : selectedChanges.size;

                return (
                    <div className="bg-white dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl p-6">
                        <div className="flex items-center justify-between mb-6">
                            <div className="flex items-center gap-3">
                                <div className={`p-2 rounded-lg ${isRemovalCsv ? "bg-orange-100 dark:bg-orange-900/30" : "bg-amber-100 dark:bg-amber-900/30"}`}>
                                    {isRemovalCsv
                                        ? <Trash2 className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                                        : <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                                    }
                                </div>
                                <div>
                                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                                        {isRemovalCsv ? "Review Removals" : isAssignmentCsv ? "Review Assignments" : "Review Changes"}
                                    </h2>
                                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                                        {isRemovalCsv
                                            ? "Select the assignments to remove"
                                            : isAssignmentCsv
                                                ? "Select the assignments to create"
                                                : "Compare your CSV configuration with current settings"}
                                    </p>
                                </div>
                            </div>

                            <button
                                onClick={handleClear}
                                className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                            >
                                Upload Different File
                            </button>
                        </div>

                        {/* PIM Groups not loaded warning */}
                        {parseResult && (
                            parseResult.csvType === "groupAssignments" ||
                            parseResult.csvType === "groupPolicies" ||
                            parseResult.csvType === "groupAssignmentRemovals"
                        ) && (!groupsData || groupsData.length === 0) && (
                            <div className="mb-4 flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg">
                                <Info className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
                                <p className="text-xs text-amber-700 dark:text-amber-300">
                                    <strong>PIM Groups not loaded.</strong> Enable the PIM Groups workload using the chip at the top of the page and wait for data to load. Without it, all rows show as <em>Not found</em> and group data cannot be verified before applying.
                                </p>
                            </div>
                        )}

                        {parseResult && (isRowBased ? (
                            <AssignmentPreview
                                csvType={parseResult.csvType as "roleAssignments" | "groupAssignments" | "roleAssignmentRemovals" | "groupAssignmentRemovals"}
                                parsedRows={parseResult.rows as (ParsedRoleAssignmentRow | ParsedGroupAssignmentRow | ParsedRoleAssignmentRemovalRow | ParsedGroupAssignmentRemovalRow)[]}
                                errors={parseResult.errors}
                                warnings={parseResult.warnings}
                                selectedRows={selectedRows}
                                onSelectionChange={handleRowSelectionChange}
                                onSetSelectedRows={handleSetSelectedRows}
                                rowStatuses={rowStatuses}
                            />
                        ) : (
                            <CompareView
                                csvType={parseResult.csvType as "rolePolicies" | "groupPolicies"}
                                parsedRows={parseResult.rows as (ParsedRolePolicyRow | ParsedGroupPolicyRow)[]}
                                currentData={currentDataMap}
                                errors={parseResult.errors}
                                warnings={parseResult.warnings}
                                selectedChanges={selectedChanges}
                                onSelectionChange={handleSelectionChange}
                                onSelectAll={handleSelectAll}
                            />
                        ))}

                        {/* Consent Gate */}
                        {activeCount > 0 && (
                            <div className="mt-6 p-4 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl">
                                <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-1">Ready to Apply</h3>
                                <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-3">
                                    {isRemovalCsv
                                        ? `${activeCount} assignment${activeCount !== 1 ? 's' : ''} will be removed. This action cannot be automatically reversed.`
                                        : isAssignmentCsv
                                            ? `${activeCount} assignment${activeCount !== 1 ? 's' : ''} will be created. Existing assignments will be skipped.`
                                            : `${activeCount} change${activeCount !== 1 ? 's' : ''} selected across ${uniqueTargetCount} ${parseResult?.csvType === 'rolePolicies' ? 'role' : 'group'}${uniqueTargetCount !== 1 ? 's' : ''}. Policy changes cannot be automatically reversed.`
                                    }
                                </p>
                                <label className="flex items-start gap-3 cursor-pointer mb-4">
                                    <input
                                        type="checkbox"
                                        checked={consentChecked}
                                        onChange={e => setConsentChecked(e.target.checked)}
                                        className="mt-0.5 h-4 w-4 rounded border-zinc-300 dark:border-zinc-600 text-blue-600 focus:ring-blue-500"
                                    />
                                    <span className="text-sm text-zinc-700 dark:text-zinc-300">
                                        I have reviewed the {isRemovalCsv ? "removals" : isAssignmentCsv ? "assignments" : "changes"} above and confirm I want to apply them.
                                    </span>
                                </label>
                                <button
                                    onClick={isRemovalCsv ? handleApplyRemovals : isAssignmentCsv ? handleApplyAssignments : handleApply}
                                    disabled={!consentChecked || activeCount === 0}
                                    className={`flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                                        isRemovalCsv
                                            ? "bg-orange-600 hover:bg-orange-700"
                                            : "bg-blue-600 hover:bg-blue-700"
                                    }`}
                                >
                                    {isRemovalCsv ? <Trash2 className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                                    {isRemovalCsv
                                        ? `Remove ${activeCount} Assignment${activeCount !== 1 ? 's' : ''}`
                                        : isAssignmentCsv
                                            ? `Create ${activeCount} Assignment${activeCount !== 1 ? 's' : ''}`
                                            : `Apply ${activeCount} Change${activeCount !== 1 ? 's' : ''}`
                                    }
                                </button>
                            </div>
                        )}
                    </div>
                );
            }

            case "results": {
                const successCount = applyResults.filter(r => r.success).length;
                const failCount = applyResults.filter(r => !r.success).length;

                return (
                    <div className="bg-white dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl p-6">
                        <div className="flex items-center justify-between mb-6">
                            <div className="flex items-center gap-3">
                                <div className={`p-2 rounded-lg ${failCount === 0
                                    ? 'bg-emerald-100 dark:bg-emerald-900/30'
                                    : 'bg-amber-100 dark:bg-amber-900/30'
                                    }`}>
                                    {failCount === 0 ? (
                                        <CheckCircle className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                                    ) : (
                                        <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                                    )}
                                </div>
                                <div>
                                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                                        {failCount === 0 ? 'All Changes Applied' : 'Partial Success'}
                                    </h2>
                                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                                        {successCount} succeeded, {failCount} failed
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-center gap-2">
                                <button
                                    onClick={handleExportResults}
                                    className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                                >
                                    <Download className="h-4 w-4" />
                                    Export Results
                                </button>
                                {failCount > 0 && (
                                    <button
                                        onClick={handleRetryFailed}
                                        className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded-lg transition-colors"
                                    >
                                        Retry Failed ({failCount})
                                    </button>
                                )}
                                <button
                                    onClick={handleClear}
                                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                                >
                                    Start Over
                                </button>
                            </div>
                        </div>

                        {/* Results List */}
                        <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
                            <div className="grid grid-cols-[auto_1fr_1fr_auto] gap-4 px-4 py-3 bg-zinc-100 dark:bg-zinc-800 text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                                <div className="w-6">Status</div>
                                <div>Target</div>
                                <div>Setting</div>
                                <div>Message</div>
                            </div>

                            <div className="max-h-96 overflow-y-auto">
                                {applyResults.map((result, idx) => (
                                    <div
                                        key={idx}
                                        className="grid grid-cols-[auto_1fr_1fr_auto] gap-4 px-4 py-3 border-t border-zinc-200 dark:border-zinc-700 items-center"
                                    >
                                        <div>
                                            {result.success ? (
                                                <CheckCircle className="h-5 w-5 text-emerald-500" />
                                            ) : (
                                                <XCircle className="h-5 w-5 text-red-500" />
                                            )}
                                        </div>
                                        <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                            {result.name}
                                        </div>
                                        <div className="text-sm text-zinc-600 dark:text-zinc-400">
                                            {result.field}
                                        </div>
                                        <div className={`text-sm ${result.success ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                                            {result.message}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                );
            }

            default:
                return null;
        }
    };

    const STEPS = [
        { key: "upload", label: "Upload" },
        { key: "compare", label: "Compare" },
        { key: "results", label: "Results" },
    ] as const;
    const stepOrder = STEPS.map(s => s.key);

    return (
        <div>
            {/* Back Button */}
            <button
                onClick={onBack}
                className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 mb-6 transition-colors"
            >
                <ArrowLeft className="h-4 w-4" />
                Back to Mode Selection
            </button>

            {/* Step Progress */}
            <div className="flex items-center justify-center gap-2 mb-8">
                {STEPS.map((s, idx) => {
                    const isActive = s.key === step;
                    const isPast = stepOrder.indexOf(step) > stepOrder.indexOf(s.key);

                    return (
                        <React.Fragment key={s.key}>
                            {idx > 0 && (
                                <div className={`w-8 h-0.5 ${isPast ? 'bg-blue-500' : 'bg-zinc-300 dark:bg-zinc-700'}`} />
                            )}
                            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${isActive
                                ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                                : isPast
                                    ? 'text-blue-600 dark:text-blue-400'
                                    : 'text-zinc-400 dark:text-zinc-500'
                                }`}>
                                <span className={`w-5 h-5 flex items-center justify-center rounded-full text-xs ${isActive
                                    ? 'bg-blue-600 text-white'
                                    : isPast
                                        ? 'bg-blue-500 text-white'
                                        : 'bg-zinc-300 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400'
                                    }`}>
                                    {isPast ? <CheckCircle className="h-3 w-3" /> : idx + 1}
                                </span>
                                {s.label}
                            </div>
                        </React.Fragment>
                    );
                })}
            </div>

            {/* Step Content */}
            {renderStepContent()}

            {/* Progress Modal */}
            <ProgressModal
                isOpen={showProgress}
                title={applyPhase === "validating" ? "Verifying changes…" : progressTitle}
                steps={progressSteps}
                onClose={handleProgressClose}
                canClose={canCloseProgress}
            />

            {/* Settings Modal */}
            <SettingsModal
                isOpen={showSettingsModal}
                onClose={() => setShowSettingsModal(false)}
            />
        </div>
    );
}
