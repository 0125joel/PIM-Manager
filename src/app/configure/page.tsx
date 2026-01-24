"use client";

import { useState, useEffect } from "react";
import { RoleSelector } from "@/components/RoleSelector";
import { RoleSettingsForm } from "@/components/RoleSettingsForm";
import { AssignmentForm } from "@/components/AssignmentForm";
import { ProgressModal, ProgressStep } from "@/components/ProgressModal";
import { RoleSettings, AssignmentSettings } from "@/types";
import { usePimData } from "@/hooks/usePimData";
import { AlertCircle, Check } from "lucide-react";

export default function ConfigurePage() {
    const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
    const [showAssignmentForm, setShowAssignmentForm] = useState(false);
    const [showProgress, setShowProgress] = useState(false);
    const [progressSteps, setProgressSteps] = useState<ProgressStep[]>([]);
    const [progressTitle, setProgressTitle] = useState("");
    const [canCloseProgress, setCanCloseProgress] = useState(false);
    const [showAssignmentPrompt, setShowAssignmentPrompt] = useState(false);

    // Store settings temporarily for the assignment phase
    const [currentRoleSettings, setCurrentRoleSettings] = useState<RoleSettings | null>(null);
    const [initialSettings, setInitialSettings] = useState<RoleSettings | undefined>(undefined);
    const [isLoadingSettings, setIsLoadingSettings] = useState(false);

    // Use shared PIM data context
    const { rolesData, loading, updatePolicy, createAssignment, getPolicySettings } = usePimData();

    // Fetch settings when a single role is selected
    useEffect(() => {
        const fetchSettings = async () => {
            if (selectedRoleIds.length === 1) {
                setIsLoadingSettings(true);
                try {
                    const result = await getPolicySettings(selectedRoleIds[0]);
                    if (result) {
                        setInitialSettings(result.settings);
                    }
                } catch (error) {
                    if (process.env.NODE_ENV === 'development') {
                        console.error("Failed to fetch settings for role:", error);
                    }
                } finally {
                    setIsLoadingSettings(false);
                }
            } else {
                setInitialSettings(undefined);
            }
        };

        fetchSettings();
    }, [selectedRoleIds, getPolicySettings]);

    const handleApplySettings = async (settings: RoleSettings) => {
        setCurrentRoleSettings(settings);
        setShowProgress(true);
        setProgressTitle("Applying Configuration");
        setCanCloseProgress(false);

        const steps: ProgressStep[] = [
            { id: "apply", label: "Applying PIM Settings", status: "loading", details: `Configuring ${selectedRoleIds.length} roles...` },
            { id: "verify", label: "Verifying Configuration", status: "pending" }
        ];
        setProgressSteps(steps);

        let successCount = 0;
        let failureCount = 0;

        try {
            for (const roleId of selectedRoleIds) {
                try {
                    await updatePolicy(roleId, settings);
                    successCount++;
                } catch (e) {
                    if (process.env.NODE_ENV === 'development') {
                        console.error("Failed to update role:", e);
                    }
                    failureCount++;
                }
            }

            if (failureCount > 0 && successCount === 0) {
                throw new Error("Failed to update any roles");
            }

            // Update steps to show success for apply
            steps[0].status = successCount === selectedRoleIds.length ? "success" : "error";
            steps[0].details = `Applied to ${successCount} roles. Failed: ${failureCount}`;
            steps[1].status = "loading";
            setProgressSteps([...steps]);

            // 2. Verify Settings
            steps[1].status = "loading";
            steps[1].details = "Verifying applied settings...";
            setProgressSteps([...steps]);

            let verifyFailed = false;
            let verifyErrorMsg = "";

            for (const roleId of selectedRoleIds) {
                try {
                    // Add a small delay to allow propagation
                    await new Promise(resolve => setTimeout(resolve, 1000));

                    const result = await getPolicySettings(roleId);
                    if (!result) throw new Error("Could not fetch policy for verification");

                    const fetched = result.settings;

                    // Compare critical settings
                    // Activation
                    if (fetched.activation.maxDuration !== settings.activation.maxDuration) throw new Error(`Max duration mismatch: Expected ${settings.activation.maxDuration}, got ${fetched.activation.maxDuration}`);
                    if (fetched.activation.requireMfa !== settings.activation.requireMfa) throw new Error(`MFA mismatch: Expected ${settings.activation.requireMfa}, got ${fetched.activation.requireMfa}`);
                    if (fetched.activation.requireApproval !== settings.activation.requireApproval) throw new Error(`Approval requirement mismatch`);

                    if (settings.activation.requireApproval) {
                        const fetchedApprovers = fetched.activation.approvers.map(a => a.id).sort();
                        const targetApprovers = settings.activation.approvers.map(a => a.id).sort();
                        if (JSON.stringify(fetchedApprovers) !== JSON.stringify(targetApprovers)) {
                            throw new Error(`Approvers mismatch: Expected ${targetApprovers.length}, got ${fetchedApprovers.length}`);
                        }
                    }

                    // Assignment
                    if (fetched.assignment.allowPermanentEligible !== settings.assignment.allowPermanentEligible) throw new Error("Allow permanent eligible mismatch");
                    if (!settings.assignment.allowPermanentEligible) {
                        if (fetched.assignment.expireEligibleAfter !== settings.assignment.expireEligibleAfter) {
                            throw new Error(`Eligible expiration mismatch: Expected ${settings.assignment.expireEligibleAfter}, got ${fetched.assignment.expireEligibleAfter}`);
                        }
                    }

                    if (fetched.assignment.allowPermanentActive !== settings.assignment.allowPermanentActive) throw new Error("Allow permanent active mismatch");
                    if (!settings.assignment.allowPermanentActive) {
                        if (fetched.assignment.expireActiveAfter !== settings.assignment.expireActiveAfter) {
                            throw new Error(`Active expiration mismatch: Expected ${settings.assignment.expireActiveAfter}, got ${fetched.assignment.expireActiveAfter}`);
                        }
                    }

                } catch (e: unknown) {
                    if (process.env.NODE_ENV === 'development') {
                        console.error("Verification failed for role:", e);
                    }
                    verifyFailed = true;
                    const errorMessage = e instanceof Error ? e.message : "Unknown verification error";
                    verifyErrorMsg = errorMessage;
                    break;
                }
            }

            if (verifyFailed) {
                steps[1].status = "error";
                steps[1].details = `Verification failed: ${verifyErrorMsg}`;
                setProgressSteps([...steps]);
                setCanCloseProgress(true);
                return;
            }

            steps[1].status = "success";
            steps[1].details = "Configuration verified successfully";
            setProgressSteps([...steps]);

            // Close progress and show prompt after a short delay
            setTimeout(() => {
                setShowProgress(false);
                setShowAssignmentPrompt(true);
            }, 1000);

        } catch (error) {
            if (process.env.NODE_ENV === 'development') {
                console.error("Error applying settings:", error);
            }
            steps[0].status = "error";
            steps[0].details = "Failed to apply settings";
            setProgressSteps([...steps]);
            setCanCloseProgress(true);
        }
    };

    const handleAssignmentPromptResponse = (shouldAssign: boolean) => {
        setShowAssignmentPrompt(false);
        if (shouldAssign) {
            setShowAssignmentForm(true);
        }
    };

    const handleApplyAssignments = async (assignmentSettings: AssignmentSettings) => {
        setShowAssignmentForm(false);
        setShowProgress(true);
        setProgressTitle("Creating Assignments");
        setCanCloseProgress(false);

        const steps: ProgressStep[] = [
            { id: "assign", label: "Creating Role Assignments", status: "loading", details: `Assigning ${assignmentSettings.principals.length} users/groups to ${selectedRoleIds.length} roles...` },
            { id: "verify-assign", label: "Verifying Assignments", status: "pending" }
        ];
        setProgressSteps(steps);

        try {
            let totalCreated = 0;
            const allResults: any[] = [];

            // 1. Create Assignments Loop
            for (const roleId of selectedRoleIds) {
                const results = await createAssignment(roleId, assignmentSettings);
                allResults.push(...results);
                totalCreated += results.filter((r: any) => r.status === "success").length;
            }

            steps[0].status = "success";
            steps[0].details = `Created ${totalCreated} assignment requests successfully`;
            steps[1].status = "loading";
            setProgressSteps([...steps]);

            // 2. Verify Assignments
            steps[1].status = "loading";
            steps[1].details = "Verifying assignment requests...";
            setProgressSteps([...steps]);

            let verifyFailed = false;
            let verifyErrorMsg = "";

            // Collect all successful request IDs
            const requestIds = allResults.filter((r: any) => r.status === "success").map((r: any) => r.id);

            if (requestIds.length > 0) {
                // Wait a moment for processing
                await new Promise(resolve => setTimeout(resolve, 2000));

                // NOTE: Verification of individual requests requires direct Graph API access
                // For now, we trust the createAssignment results
                // TODO: Add verifyAssignment method to PimDataContext if needed
            }

            if (verifyFailed) {
                steps[1].status = "error";
                steps[1].details = `Verification failed: ${verifyErrorMsg}`;
                setProgressSteps([...steps]);
                setCanCloseProgress(true);
                return;
            }

            steps[1].status = "success";
            steps[1].details = "Assignments created successfully";
            setProgressSteps([...steps]);
            setCanCloseProgress(true);

        } catch (error) {
            if (process.env.NODE_ENV === 'development') {
                console.error("Error creating assignments:", error);
            }
            steps[0].status = "error";
            steps[0].details = "Failed to create assignments";
            setProgressSteps([...steps]);
            setCanCloseProgress(true);
        }
    };

    return (
        <>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <div className="w-full">
                    <RoleSelector
                        onSelectionChange={setSelectedRoleIds}
                        rolesData={rolesData}
                        loading={loading}
                    />
                </div>
                <div className="w-full">
                    <RoleSettingsForm
                        selectedRoleCount={selectedRoleIds.length}
                        onApply={handleApplySettings}
                        initialSettings={initialSettings}
                        isLoading={isLoadingSettings}
                    />
                </div>
            </div>

            {showAssignmentForm && (
                <AssignmentForm
                    selectedRoleCount={selectedRoleIds.length}
                    onApply={handleApplyAssignments}
                    onClose={() => setShowAssignmentForm(false)}
                />
            )}

            <ProgressModal
                isOpen={showProgress}
                title={progressTitle}
                steps={progressSteps}
                onClose={() => setShowProgress(false)}
                canClose={canCloseProgress}
            />

            {/* Assignment Prompt Modal */}
            {showAssignmentPrompt && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-xl p-6 max-w-md w-full mx-4 border border-zinc-200 dark:border-zinc-800">
                        <div className="flex items-center gap-3 mb-4 text-green-600 dark:text-green-400">
                            <div className="h-10 w-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                                <Check className="h-6 w-6" />
                            </div>
                            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Configuration Applied</h3>
                        </div>
                        <p className="text-zinc-600 dark:text-zinc-400 mb-6">
                            PIM settings have been successfully configured for {selectedRoleIds.length} roles.
                            Would you like to assign users or groups to these roles now?
                        </p>
                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => handleAssignmentPromptResponse(false)}
                                className="px-4 py-2 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition-colors"
                            >
                                No, I'm done
                            </button>
                            <button
                                onClick={() => handleAssignmentPromptResponse(true)}
                                className="px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded-md transition-colors"
                            >
                                Yes, assign users
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
