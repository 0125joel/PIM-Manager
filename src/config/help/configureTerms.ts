/**
 * The words of Configure and what they mean, in one place (spec 18, as `reportTerms.ts` for the Report): the help panel
 * and `/help` read these strings, and the screens use the labels, so a rename cannot leave the help behind. Where a screen
 * shows the sentence itself (`SCHEDULED_NOTE`, `NOT_UNDER_PIM_LINE`) the test checks the term starts with it.
 */
import { NOT_UNDER_PIM_LINE } from "@/utils/configureTargets";
import { SCHEDULED_NOTE } from "@/utils/assignmentForm";

export type ConfigureTermKey =
    | "keep" | "setTo" | "selectSeveral" | "leaveOut" | "changesWaiting"
    | "snapshot" | "undo" | "scheduled" | "comesUnderPim" | "policyMaximum"
    | "accessModel" | "plane" | "level" | "notClassified"
    | "authenticationContext" | "customExtension";

export interface ConfigureTerm {
    label: string;
    text: string;
}

export const CONFIGURE_TERMS: Record<ConfigureTermKey, ConfigureTerm> = {
    keep: { label: "Keep", text: "leaves the value as it is now. Only what you Set is written; an empty cell in an imported file is Keep too." },
    setTo: { label: "Set to", text: "writes the value you choose to every target that does not have it yet. A target that already has it gets no change." },
    selectSeveral: { label: "Select several", text: "tick roles or groups to change the same settings on all of them. The Now column shows which value each one has." },
    leaveOut: { label: "Leave out", text: "takes one change out of the review before you apply. Nothing is written for it." },
    changesWaiting: { label: "Changes waiting", text: "the changes you collected in Edit, Guided or Import. They wait in this browser tab until you apply or discard them; nothing is written before the review." },
    snapshot: { label: "Snapshot", text: "the settings and assignments of every target as they were, saved in this browser before the first write, so the apply can be undone." },
    undo: { label: "Undo this apply", text: "builds the opposite changes from the snapshot and opens them in the review. A value someone else changed since is warned about, and an assignment added minutes ago may have to wait." },
    scheduled: { label: "Scheduled", text: SCHEDULED_NOTE },
    comesUnderPim: { label: "Comes under PIM", text: `${NOT_UNDER_PIM_LINE}: a group not under PIM has no PIM settings until its first assignment. Dynamic and on-premises groups cannot come under PIM.` },
    policyMaximum: { label: "Policy maximum", text: "the longest an assignment may run under the policy of its target. A new assignment without an end date gets it, and the row says so." },
    accessModel: { label: "Access model", text: "PIM Monitor's reading of Microsoft's Enterprise Access Model: roles sorted into planes and levels with recommended settings. An interpretation, not a Microsoft classification." },
    plane: { label: "Plane", text: "what a role governs: Control (identity, authentication, authorization), Management (one workload) or Data (reading and support)." },
    level: { label: "Level", text: "how strictly a role is treated: Privileged, Specialized or Enterprise, decided from Microsoft's privileged flag, the blast radius and the permissions." },
    notClassified: { label: "Not classified", text: "a role the catalog does not list. It gets no values from the access model." },
    authenticationContext: { label: "Authentication context", text: "a Conditional Access label that activation can require instead of MFA. It only protects when an enabled policy targets it." },
    customExtension: { label: "Custom extension", text: "an external check PIM calls before or after approval (Preview). Needs Entra ID Governance or Entra Suite." },
};

/** The order of the terms in the help panel */
export const CONFIGURE_HELP_TERM_KEYS: readonly ConfigureTermKey[] = [
    "keep", "setTo", "selectSeveral", "leaveOut", "changesWaiting", "snapshot", "undo", "scheduled", "comesUnderPim", "policyMaximum",
    "accessModel", "plane", "level", "notClassified", "authenticationContext", "customExtension",
];
