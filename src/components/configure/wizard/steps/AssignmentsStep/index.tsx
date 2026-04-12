"use client";

import React, { useState, useEffect } from 'react';
import { WizardStep } from '../../WizardStep';
import { useWizardState, AssignmentConfig, AssignmentRemoval, PolicySettings } from '@/hooks/useWizardState';
import { PrincipalSelector, Principal } from '../../../shared/PrincipalSelector';
import { AlertTriangle } from 'lucide-react';
import { useUnifiedPimData } from '@/contexts/UnifiedPimContext';
import { usePimData } from '@/hooks/usePimData';
import { PimGroupData } from '@/types/pimGroup.types';
import { parseGraphPolicy } from '@/services/policyParserService';
import { isoToApproxDays, minIsoDuration } from '@/utils/durationUtils';
import { Logger } from '@/utils/logger';

// Sub-components (shared)
import { LocalAssignmentState, ExistingAssignment, ScopeDetail } from '@/components/configure/shared/assignmentTypes';
import { useAssignmentData } from '@/components/configure/shared/useAssignmentData';
import { ScopeHeader } from '@/components/configure/shared/ScopeHeader';
import { AssignmentScopePicker } from '@/components/configure/shared/AssignmentScopePicker';
import { AssignmentTypeCard } from '@/components/configure/shared/AssignmentTypeCard';
import { DurationSettingsCard } from '@/components/configure/shared/DurationSettingsCard';
import { ExistingAssignmentsPanel } from '@/components/configure/shared/ExistingAssignmentsPanel';

interface AssignmentsStepProps {
    workload: "directoryRoles" | "pimGroups";
    onNext: () => void;
    onBack: () => void;
}

function mergeRestrictive(a: PolicySettings, b: PolicySettings): PolicySettings {
    return {
        ...a,
        // Permanent allowed only if ALL selected roles allow it
        allowPermanentEligible: a.allowPermanentEligible && b.allowPermanentEligible,
        allowPermanentActive: a.allowPermanentActive && b.allowPermanentActive,
        // Max expiration: use the shortest (most restrictive) across selected roles
        eligibleExpiration: minIsoDuration(a.eligibleExpiration, b.eligibleExpiration),
        activeExpiration: minIsoDuration(a.activeExpiration, b.activeExpiration),
        // Enforcement flags: require if ANY selected role requires it
        requireMfaOnActiveAssignment: a.requireMfaOnActiveAssignment || b.requireMfaOnActiveAssignment,
        requireJustificationOnActiveAssignment: a.requireJustificationOnActiveAssignment || b.requireJustificationOnActiveAssignment,
    };
}

// OPTIMIZATION: Wrap in React.memo to prevent re-renders during wizard navigation
// This component is 777 lines with API calls - re-renders are expensive (200-400ms)
export const AssignmentsStep = React.memo(function AssignmentsStep({ workload, onNext, onBack }: AssignmentsStepProps) {
    const { wizardData, updateWorkloadConfig } = useWizardState();
    const { getWorkloadData } = useUnifiedPimData();
    const { rolesData, getPolicySettings } = usePimData();
    const isGroups = workload === "pimGroups";

    // --- Config & Selection ---
    const currentConfig = workload === "directoryRoles" ? wizardData.directoryRoles : wizardData.pimGroups;
    const currentPolicies = currentConfig.policies;
    const selectedIds = workload === "directoryRoles" ? wizardData.selectedRoleIds : wizardData.selectedGroupIds;

    // --- Policy Loading (assignments-only mode) ---
    const [loadedPolicies, setLoadedPolicies] = useState<PolicySettings | undefined>(undefined);
    const [isPoliciesLoading, setIsPoliciesLoading] = useState(false);

    // --- Removals Tracking ---
    const [removals, setRemovals] = useState<AssignmentRemoval[]>(currentConfig.removals || []);

    // --- Local Assignment State ---
    const [assignments, setAssignments] = useState<LocalAssignmentState>(() => {
        const saved = currentConfig.assignments;
        const now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        const defaultStart = now.toISOString().slice(0, 16);

        if (saved) {
            return {
                members: saved.principalIds.map(id => ({ id, displayName: id, type: 'user' as const })),
                type: saved.assignmentType,
                duration: (saved.duration === "permanent") ? "permanent" : "bounded",
                startDate: saved.startDateTime || defaultStart,
                endDate: saved.endDateTime || "",
                justification: saved.justification || "",
                groupRole: saved.accessType || "member",
                scopeId: saved.directoryScopeId || "/"
            };
        }
        return {
            members: [],
            type: "eligible",
            duration: "permanent",
            startDate: defaultStart,
            endDate: "",
            justification: "",
            groupRole: "member",
            scopeId: "/"
        };
    });

    // --- Scope Display State ---
    const [scopeDetails, setScopeDetails] = useState<ScopeDetail[]>([]);
    const [isLoadingScope, setIsLoadingScope] = useState(false);

    // --- Data Hook ---
    const {
        adminUnits,
        existingAssignments,
        isLoadingAssignments,
        fetchExistingAssignments
    } = useAssignmentData({ workload, selectedIds });

    // --- Load Actual Policy for Assignments-Only Mode ---
    useEffect(() => {
        // Skip if policy already loaded by PoliciesStep ("both" mode)
        if (currentConfig.policies !== undefined) return;
        if (selectedIds.length === 0) return;

        let cancelled = false;
        const loadPolicies = async () => {
            setIsPoliciesLoading(true);
            setLoadedPolicies(undefined);
            try {
                let merged: PolicySettings | undefined;

                if (workload === 'directoryRoles') {
                    for (const id of selectedIds) {
                        if (cancelled) return;
                        let rules: unknown[] | undefined;
                        const cached = rolesData?.find(r => r.definition.id === id);
                        if (cached?.policy?.details?.rules) {
                            rules = cached.policy.details.rules;
                        } else {
                            const result = await getPolicySettings(id);
                            rules = result?.rules;
                        }
                        if (!rules) continue;
                        const p = parseGraphPolicy({ rules });
                        merged = merged ? mergeRestrictive(merged, p) : p;
                    }
                } else {
                    const groupsData = getWorkloadData<PimGroupData>('pimGroups');
                    const accessType = assignments.groupRole;
                    for (const id of selectedIds) {
                        if (cancelled) return;
                        const groupData = groupsData.find(g => g.group.id === id);
                        const rules = groupData?.policies?.[accessType]?.rules;
                        if (!rules) continue;
                        const p = parseGraphPolicy({ rules });
                        merged = merged ? mergeRestrictive(merged, p) : p;
                    }
                }

                if (!cancelled) setLoadedPolicies(merged);
            } catch (e) {
                if (!cancelled) Logger.error('AssignmentsStep', 'Failed to load policies', e);
            } finally {
                if (!cancelled) setIsPoliciesLoading(false);
            }
        };

        loadPolicies();
        return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedIds, workload, currentConfig.policies, assignments.groupRole]);

    // --- Resolve Scope Display Names from Cache ---
    useEffect(() => {
        if (selectedIds.length === 0) return;
        if (workload === "directoryRoles") {
            const details = selectedIds.map(id => {
                const cached = rolesData?.find(r => r.definition.id === id);
                return cached?.definition ?? { id, displayName: "Unknown", description: "" };
            });
            setScopeDetails(details);
        } else {
            const groupsData = getWorkloadData<PimGroupData>('pimGroups');
            const details = selectedIds.map(id => {
                const cached = groupsData?.find(g => g.group.id === id);
                return cached?.group ?? { id, displayName: "Unknown", description: "" };
            });
            setScopeDetails(details);
        }
    }, [selectedIds, workload, rolesData, getWorkloadData]);

    // --- Sync to Wizard Context ---
    useEffect(() => {
        const globalConfig: AssignmentConfig = {
            principalIds: assignments.members.map(m => m.id),
            assignmentType: assignments.type,
            duration: assignments.duration,
            startDateTime: assignments.startDate,
            endDateTime: assignments.duration === "bounded" ? assignments.endDate : undefined,
            justification: assignments.justification || undefined,
            accessType: isGroups ? assignments.groupRole : undefined,
            directoryScopeId: !isGroups ? assignments.scopeId : undefined
        };

        updateWorkloadConfig(workload, {
            assignments: globalConfig,
            removals: removals.length > 0 ? removals : undefined
        });
    }, [assignments, removals, workload, updateWorkloadConfig, isGroups]);

    // --- Update Helper ---
    const updateLocalState = (updates: Partial<LocalAssignmentState>) => {
        setAssignments(prev => ({ ...prev, ...updates }));
    };

    // --- Removal Handlers ---
    const handleRemoveAssignment = (assignment: ExistingAssignment) => {
        setRemovals(prev => [...prev, {
            assignmentId: assignment.id,
            principalId: assignment.principalId,
            roleDefinitionId: assignment.roleDefinitionId,
            directoryScopeId: assignment.directoryScopeId,
            assignmentType: assignment.assignmentType,
            // For PIM Groups, store the actual group ID (directoryScopeId is always "/" for groups)
            groupId: isGroups ? selectedIds[0] : undefined
        }]);
    };

    const handleCancelRemoval = (assignmentId: string) => {
        setRemovals(prev => prev.filter(r => r.assignmentId !== assignmentId));
    };

    return (
        <WizardStep
            title={isGroups ? "Group Assignments" : "Role Assignments"}
            description="Assign users or groups to configuration"
            onNext={onNext}
            onBack={onBack}
            isNextDisabled={assignments.members.length === 0 && removals.length === 0}
        >
            <div className="flex gap-6 h-full items-start">
                {/* Left Column: Configuration */}
                <div className="flex-1 space-y-4 min-w-0">
                    {/* Assignment Only Warning */}
                    {wizardData.configType === 'assignment' && currentPolicies && (
                        <div className="bg-yellow-50 dark:bg-yellow-900/20 p-3 rounded-lg border border-yellow-200 dark:border-yellow-900 flex items-center gap-3">
                            <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-500 flex-shrink-0" />
                            <div className="text-xs text-yellow-700 dark:text-yellow-400">
                                Assignments Only mode active. Local policies are bypassed for input, but cloud policies still apply.
                            </div>
                        </div>
                    )}

                    {/* Scope Header */}
                    <ScopeHeader
                        isGroups={isGroups}
                        isLoading={isLoadingScope}
                        scopeDetails={scopeDetails}
                        selectedCount={selectedIds.length}
                    />

                    {/* Scope Picker (AU for roles, Member/Owner for groups) */}
                    <AssignmentScopePicker
                        isGroups={isGroups}
                        assignments={assignments}
                        adminUnits={adminUnits}
                        onUpdate={updateLocalState}
                    />

                    {/* Member Selector */}
                    <div className={`bg-white dark:bg-zinc-800 p-4 rounded-lg border shadow-sm transition-colors ${assignments.members.length === 0 && removals.length === 0
                            ? 'border-amber-300 dark:border-amber-700'
                            : 'border-zinc-200 dark:border-zinc-700'
                        }`}>
                        <PrincipalSelector
                            selectedPrincipals={assignments.members}
                            onChange={(p) => updateLocalState({ members: p })}
                            label="Who needs access?"
                            addLabel="+ Add members"
                            description="Search for users or groups to assign."
                        />
                        {assignments.members.length === 0 && removals.length === 0 && (
                            <div className="mt-3 flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 rounded-md">
                                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                                <span>Add at least one member, or stage a removal in the panel on the right to continue.</span>
                            </div>
                        )}
                    </div>

                    {/* Assignment Type */}
                    <AssignmentTypeCard
                        assignments={assignments}
                        onUpdate={updateLocalState}
                    />

                    {/* Duration & Settings */}
                    <DurationSettingsCard
                        assignments={assignments}
                        currentPolicies={currentPolicies ?? loadedPolicies}
                        skipJustification={wizardData.configType === 'assignment'}
                        isLoadingPolicies={isPoliciesLoading}
                        onUpdate={updateLocalState}
                    />
                </div>

                {/* Right Column: Existing Assignments */}
                <ExistingAssignmentsPanel
                    isGroups={isGroups}
                    existingAssignments={existingAssignments}
                    isLoading={isLoadingAssignments}
                    removals={removals}
                    adminUnits={adminUnits}
                    selectedCount={selectedIds.length}
                    onFetchAssignments={fetchExistingAssignments}
                    onRemoveAssignment={handleRemoveAssignment}
                    onCancelRemoval={handleCancelRemoval}
                />
            </div>
        </WizardStep>
    );
});
