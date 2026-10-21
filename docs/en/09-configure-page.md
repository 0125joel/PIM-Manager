# Configure Page

This document explains the Configure page, where you change PIM settings and assignments for roles and groups. Every change goes through one basket, one review and one apply.

---

## Overview

The start page shows your **write access** (what you may change, per area), the **entry cards**, the **access model** panel and **Last applies**. Four modes sit in the mode bar, kept in the URL (`mode=edit|guided|import|model`):

1. **Edit**: a master-detail list of roles and groups. Pick a target, change settings on the Activation, Assignment and Notification tabs, see and change who has access (Who has it, Add people). *Select several* changes one value on many targets at once; *Copy settings to* copies a target's settings.
2. **Guided**: a route in steps (Start, Targets, Settings, People) for a change on many targets, optionally from the PIM Monitor access model.
3. **Import**: drop a CSV or JSON file (assignments, role or group settings, an access model file, or a file of the access model choices saved from the Access model page; a backup is recognised but cannot be imported yet). PIM Manager recognises the file, shows a reference of the columns and a template, and compares every row with the tenant.
4. **Access model**: the board of the Enterprise Access Model (planes and levels), the catalog of roles with their expected settings, and the placement of your groups. Export saves the recommended role settings as a CSV you can edit and import again, and your label choices and group placements as JSON. Nothing here writes to the tenant.

Keep is the default everywhere: a value you do not touch, and an empty cell in a file, changes nothing.

---

## The basket

Every mode adds changes to the **basket** (bar at the bottom). The basket is kept per tenant in the tab, so a reload or consent popup keeps it. Changes are compared by meaning with what the tenant has now. Leave out removes one change, Discard empties the basket.

## Review

*Review* reads the tenant again, sends new assignments once as a validation-only dry run (nothing is written), and shows a verdict, what needs attention and every check with its outcome. A blocking check keeps Apply disabled. Removals are confirmed in the review.

## Apply, result and Undo

Apply saves a **snapshot** of the touched targets first (their policy rules and assignments) (a failure writes nothing), then writes in order with throttling, retries 429 and 5xx, and never repeats a write that may have succeeded without checking. The result lists every change (Done, Failed, Not written), reads the tenant again and shows values that differ from your intent. *Try the failed ones again* returns to the review; the result can be downloaded as CSV. The last ten applies are kept in **Last applies** with their snapshot, in this browser until you sign out; *Undo this apply* builds a basket from the snapshot, with warnings when someone else changed the target since, or the apply is younger than five minutes.

---

## Custom Extensions (Preview)

PIM custom extensions let an activation call an external REST API that approves, auto-approves or denies the request. PIM Manager links an existing extension to a policy; building the endpoint happens in the Microsoft Entra admin center.

- **Edit and Guided**: the Activation tab ends with a *Custom extension* section. Pick an extension for the pre-approval or post-approval slot. A slot switched on without a pick is never written.
- **Picker access**: the list needs `PrivilegedAccess-CustomExt.Read.All` (incremental consent) and a Microsoft Entra ID Governance or Entra Suite licence. A policy that already links an extension shows its name without that scope.
- **Import**: the settings files carry the extension id and Enabled columns. An empty cell keeps the link; a file cannot unlink.

---

## Activation Settings

Settings that apply when users **activate** their eligible role.

| Setting | Description | Recommended |
|---------|-------------|-------------|
| **Max Duration** | Maximum activation time | 4-8 hours for most roles |
| **Require MFA** | Users must complete MFA | Always enable |
| **Require Justification** | Users must explain why | Enable for audit |
| **Require Ticket Info** | Link to ticket system | Optional |
| **Require Approval** | Must be approved first | For sensitive roles |
| **Approvers** | Who can approve | Security team or managers |

### Max Duration Options

| Duration | Use Case |
|----------|----------|
| 1 hour | Highly sensitive, short tasks |
| 4 hours | Standard workday support |
| 8 hours | Full workday coverage |
| 12+ hours | On-call or extended operations |

> [!WARNING]
> Longer durations increase risk. Users remain privileged for the entire duration.

---

## Assignment Settings

Settings that apply to eligible/active **assignments**.

| Setting | Description |
|---------|-------------|
| **Allow Permanent Eligible** | Eligible assignments never expire |
| **Max Eligible Duration** | If not permanent, how long |
| **Allow Permanent Active** | Active assignments never expire |
| **Max Active Duration** | If not permanent, how long |

> [!CAUTION]
> Permanent active assignments bypass PIM entirely. Avoid unless absolutely necessary.

---

## Permissions Required

Writes need the write scopes of the workload, requested when you press Grant permission on the start page or in Settings (Directory Roles: `RoleManagementPolicy.ReadWrite.Directory`, `RoleEligibilitySchedule.ReadWrite.Directory`, `RoleAssignmentSchedule.ReadWrite.Directory`; PIM for Groups: the three `.AzureADGroup` equivalents). The **access row** on the start page shows per area whether you can write now (open), must activate a role first, have no role that allows it, are missing consent, or whether a group is locked (dynamic or synced). The optional Conditional Access check asks for `Policy.Read.All` on demand.

---

## Troubleshooting

- **Apply is disabled**: open the review; a blocking check names the cause (a missing role, a policy not read, a refused dry run).
- **A group cannot be changed**: dynamic and synced groups are locked; a group not under PIM comes under PIM when you apply a change.
- **Import says "Need a fix"**: the row has a cell the file reader refused; the row says which cell and why. Nothing of that row is added.
- **The basket and Last applies are empty after sign-out**: both are cleared on sign-out by design, so no names or snapshots stay on the device. Undo an apply before you sign out.

## Next Steps

- [Report Page](./08-report-page.md): where a role or group has a "Change in Configure" button
- [Settings](./11-settings.md): permissions and emergency access accounts
