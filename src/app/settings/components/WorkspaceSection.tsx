"use client";

import type { CSSProperties, ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons/Icon";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatusBox } from "@/components/ui/StatusBox";
import type { WorkspaceListItem, WorkspaceProps, WorkspaceStatusItem, WorkspaceStatusLine } from "./settingsTypes";
import { SettingsSection } from "./SettingsSection";

/** The texts are those of the canvas (`Settings.dc.html`). One step shows at a time. */

const BOX = "rounded border border-line bg-surface";
const SMALL = "text-[13px] leading-[18px] text-muted";
const LINK_BUTTON = "text-accent underline max-sm:min-h-11";

const TONE_ICON: Record<WorkspaceStatusLine["tone"], { icon: IconName; accent?: string }> = {
    ok: { icon: "success", accent: "var(--success-text)" },
    quiet: { icon: "info", accent: "var(--muted)" },
    warn: { icon: "alert", accent: "var(--warn-text)" },
    error: { icon: "error", accent: "var(--danger-text)" },
    pending: { icon: "info" },
};

function Actions({ children }: { children: ReactNode }) {
    return <div className="mt-4 flex flex-wrap items-center gap-2">{children}</div>;
}

function WorkspaceRow({ item, onToggle }: { item: WorkspaceListItem; onToggle: (customerId: string) => void }) {
    return (
        <label className={`flex cursor-pointer items-start gap-3 border-t border-line px-3 py-3 first:border-t-0 max-sm:min-h-11 ${item.isSelected ? "bg-accent-tint shadow-[inset_2px_0_0_var(--accent)]" : ""}`}>
            <input type="checkbox" checked={item.isSelected} onChange={() => onToggle(item.customerId)} className="mt-0.5 h-4 w-4 shrink-0 rounded-[3px] accent-[var(--accent)]" />
            <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-[15px] leading-5 font-medium text-ink [overflow-wrap:anywhere]">{item.name}</span>
                    {item.receivesEntraLogs && (
                        <span className="rounded bg-accent-tint px-1.5 text-[11px] leading-[16px] text-accent">Receives Entra audit logs</span>
                    )}
                    {item.receivesActivityLogs && (
                        <span className="rounded bg-accent-tint px-1.5 text-[11px] leading-[16px] text-accent">Receives Azure activity logs</span>
                    )}
                </span>
                {item.where && <span className="mt-0.5 block text-[13px] leading-[18px] text-muted">{item.where}</span>}
            </span>
        </label>
    );
}

/** The name of a workspace, then one line per log: each line has its own icon, so a status is never colour alone */
function StatusRow({ item }: { item: WorkspaceStatusItem }) {
    return (
        <div className="border-t border-line px-3 py-3 first:border-t-0">
            <p className="text-[15px] leading-5 font-medium text-ink [overflow-wrap:anywhere]">{item.name}</p>
            {item.lines.map((line, index) => {
                const tone = TONE_ICON[line.tone];
                return (
                    <div key={index} className="mt-1 flex items-start gap-2" style={tone.accent ? ({ "--pim-icon-accent": tone.accent } as CSSProperties) : undefined}>
                        <Icon name={tone.icon} size={16} className="mt-0.5 shrink-0" />
                        <p className="min-w-0 flex-1 text-[13px] leading-[18px] text-muted [overflow-wrap:anywhere]">{line.text}</p>
                    </div>
                );
            })}
        </div>
    );
}

/**
 * The Log Analytics workspace section of Settings (implementation spec section 7): choose one or more workspaces for the Audit
 * page, with Azure access if it is missing, one list across subscriptions, the Log Analytics permission, a check per
 * workspace and a status per workspace. Driven by props only (no MSAL, no Azure), so the fixture page can show every step.
 */
export function WorkspaceSection(props: WorkspaceProps) {
    const { tenantLabel, step, items, failedSubscriptions, listError, selectedCount, manualDraft, manualError, consentMessage, isBusy, summary, statuses, checkedLine } = props;
    const useText = selectedCount === 1 ? "Use this workspace" : `Use these ${selectedCount} workspaces`;
    return (
        <SettingsSection
            id="workspace"
            title="Log Analytics workspace"
            subline={`Optional. Without it, Audit shows up to 30 days on Entra and 90 days on Azure, the most their logs keep. A workspace goes back as far as it keeps its logs; choose one or more. They are read from your browser with your own access; PIM Manager stores only which ones you chose, in this browser${tenantLabel ? ` for tenant ${tenantLabel}` : ""}.`}
        >
            <div data-visual-section="settings-workspace" className="max-w-[720px] text-[13px] leading-[18px] text-body">
                {step === "none" && (
                    <div>
                        <p className={`mb-3 ${SMALL}`}>No workspaces chosen. Audit uses the Entra audit log and the Azure activity log.</p>
                        <Button variant="primary" onClick={props.onChoose}>Choose workspaces</Button>
                    </div>
                )}

                {step === "azure" && (
                    <div className={`${BOX} p-4`}>
                        <p className="mb-1 font-semibold text-ink">Allow PIM Manager to list your workspaces</p>
                        <p className={`mb-3 ${SMALL}`}>This asks for read access to Azure, the same permission the Azure pages use. It shows only what your account may already see.</p>
                        <div className="flex flex-wrap items-center gap-2">
                            <Button variant="primary" isLoading={isBusy} onClick={props.onGrantAzure}>Grant Azure access</Button>
                            <Button onClick={props.onShowManual}>Enter a workspace ID instead</Button>
                            <Button onClick={props.onCancel}>Cancel</Button>
                        </div>
                        {consentMessage && <p role="alert" className="mt-3 text-danger-text">{consentMessage}</p>}
                    </div>
                )}

                {step === "listing" && (
                    <div role="status" aria-busy="true" className={`${BOX} p-4`}>
                        <p className={`mb-3 ${SMALL}`}>Listing the workspaces your account can see, in every subscription.</p>
                        <Skeleton className="block" width="100%" height={64} />
                    </div>
                )}

                {step === "list" && (
                    <div>
                        {listError ? (
                            <StatusBox variant="error" title="The workspaces could not be listed" action={<Button onClick={props.onRetryList}>Try again</Button>}>
                                {listError}
                            </StatusBox>
                        ) : (
                            <div className={`${BOX} overflow-hidden`}>
                                <div className="flex justify-between gap-3 border-b border-line px-3 py-2.5 text-xs leading-[17px] text-muted">
                                    <span>Workspaces your account can see, across all subscriptions</span>
                                    <span className="font-mono">{selectedCount} of {items.length} selected</span>
                                </div>
                                <div role="group" aria-label="Workspaces">
                                    {items.map((item) => <WorkspaceRow key={item.customerId} item={item} onToggle={props.onToggle} />)}
                                </div>
                            </div>
                        )}
                        {failedSubscriptions.length > 0 && (
                            <StatusBox variant="warn" className="mt-3">
                                {failedSubscriptions.length === 1 ? `Subscription ${failedSubscriptions[0]} could not be read, so its workspaces may be missing.` : `Subscriptions ${failedSubscriptions.join(", ")} could not be read, so their workspaces may be missing.`}{" "}
                                <span className="block"><button type="button" className={LINK_BUTTON} onClick={props.onRetryList}>Try again</button></span>
                            </StatusBox>
                        )}
                        <p className={`mt-3 ${SMALL}`}>
                            Audit combines the workspaces you select and shows each event once. The list shows what your account can see, so it does not prove a workspace does not exist. Not listed?{" "}
                            <button type="button" className={LINK_BUTTON} onClick={props.onShowManual}>Enter a workspace ID</button>
                        </p>
                        {manualError && <p role="alert" className="mt-3 text-danger-text">{manualError}</p>}
                        <Actions>
                            <Button variant="primary" disabled={selectedCount === 0 || isBusy} onClick={props.onUse}>{selectedCount === 0 ? "Choose a workspace" : useText}</Button>
                            <Button onClick={props.onCancel}>Cancel</Button>
                        </Actions>
                    </div>
                )}

                {step === "nolist" && (
                    <div>
                        <StatusBox variant="consent" icon="info" title="Your account sees no workspaces.">
                            That does not mean there are none: without an Azure role this list is simply empty. Ask whoever manages your logs for the workspace ID, or for access.
                        </StatusBox>
                        {failedSubscriptions.length > 0 && (
                            <StatusBox variant="warn" className="mt-3">
                                {failedSubscriptions.length === 1 ? `Subscription ${failedSubscriptions[0]} could not be read, so its workspaces may be missing.` : `Subscriptions ${failedSubscriptions.join(", ")} could not be read, so their workspaces may be missing.`}{" "}
                                <span className="block"><button type="button" className={LINK_BUTTON} onClick={props.onRetryList}>Try again</button></span>
                            </StatusBox>
                        )}
                        <Actions>
                            <Button variant="primary" onClick={props.onShowManual}>Enter a workspace ID</Button>
                            <Button onClick={props.onCancel}>Cancel</Button>
                        </Actions>
                    </div>
                )}

                {step === "manual" && (
                    <form
                        className={`${BOX} p-4`}
                        onSubmit={(event) => {
                            event.preventDefault();
                            props.onUse();
                        }}
                    >
                        <label htmlFor="workspace-id" className="mb-1 block font-semibold text-ink">Workspace ID</label>
                        <p id="workspace-id-help" className={`mb-2 ${SMALL}`}>Shown on the workspace&apos;s Overview page in the Azure portal. PIM Manager checks it before using it.</p>
                        <input
                            id="workspace-id"
                            value={manualDraft}
                            onChange={(event) => props.onManualChange(event.target.value)}
                            placeholder="00000000-0000-0000-0000-000000000000"
                            autoComplete="off"
                            spellCheck={false}
                            aria-describedby={manualError ? "workspace-id-help workspace-id-error" : "workspace-id-help"}
                            aria-invalid={manualError ? true : undefined}
                            className="h-[34px] w-full max-w-[380px] rounded-md border border-line bg-surface px-3 font-mono text-[13px] text-ink placeholder:text-muted max-sm:h-11"
                        />
                        {manualError && <p id="workspace-id-error" role="alert" className="mt-2 text-danger-text">{manualError}</p>}
                        <Actions>
                            <Button variant="primary" type="submit" disabled={isBusy}>Add and check</Button>
                            <Button onClick={props.onCancel}>Cancel</Button>
                        </Actions>
                    </form>
                )}

                {step === "consent" && (
                    <div className={`${BOX} p-4`}>
                        <p className="mb-1 font-semibold text-ink">One more permission to read these workspaces</p>
                        <p className={`mb-3 ${SMALL}`}>
                            PIM Manager asks for <span className="font-mono">Data.Read</span> on Log Analytics. It reads in your browser, is optional and the rest of the app works without it. Your tenant may need an admin to approve it. You also need read access to each workspace itself, such as Log Analytics Reader.
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                            <Button variant="primary" isLoading={isBusy} onClick={props.onGrantLogAnalytics}>Grant permission</Button>
                            <Button onClick={props.onCancel}>Cancel</Button>
                        </div>
                        {consentMessage && <p role="alert" className="mt-3 text-danger-text">{consentMessage}</p>}
                    </div>
                )}

                {step === "checking" && (
                    <div role="status" aria-busy="true" className={`${BOX} p-4`}>
                        <p className={`mb-3 ${SMALL}`}>Checking each workspace: can it be read, and which logs does it hold?</p>
                        <Skeleton className="block" width="100%" height={48} />
                    </div>
                )}

                {step === "chosen" && (
                    <div>
                        {summary && (
                            <div className={`${BOX} p-4`}>
                                <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
                                    <span className="text-[15px] leading-5 font-medium text-ink">{summary.text}</span>
                                    <span className={SMALL}>{summary.detail}</span>
                                </div>
                            </div>
                        )}
                        <div className={`${BOX} mt-3 overflow-hidden`}>
                            {statuses.map((item) => <StatusRow key={item.customerId} item={item} />)}
                        </div>
                        {checkedLine && <p className={`mt-3 ${SMALL}`}>{checkedLine}</p>}
                        <Actions>
                            <Button isLoading={isBusy} onClick={props.onCheckAgain}>Check again</Button>
                            <Button onClick={props.onChoose}>Change</Button>
                            <Button onClick={props.onRemoveAll}>Remove all</Button>
                        </Actions>
                    </div>
                )}
            </div>
        </SettingsSection>
    );
}
