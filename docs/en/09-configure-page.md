# Configure Page

This document explains the features and functionality of the Configure page, where you can configure PIM settings for roles and groups.

---

## Overview

The Configure page provides three modes for managing PIM configurations:

1. **Wizard Mode** — A guided step-by-step process for bulk configuration
2. **Manual Mode** — Direct access to role/group selection and settings forms, with staged changes
3. **Bulk Mode** — CSV-based batch configuration for rapid policy and assignment changes across all four CSV types (Role Policies, Group Policies, Role Assignments, Group Assignments)

```
┌─────────────────────────────────────────────────────────────────┐
│                      Configure PIM                               │
│   Manage PIM roles and groups efficiently.                       │
├─────────────────────────────────────────────────────────────────┤
│  [🪄 Wizard]  [⚙ Manual]  [📊 Bulk]                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Selected mode content appears here                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Wizard Mode

The wizard guides you through PIM configuration in a series of steps. The exact number of steps depends on your workload and configuration type selections (minimum 8, up to 10 for dual-workload flows).

### Step 1: Safety Check (Backup)

Ensures your data is current before making changes.

| Check | Description |
|-------|-------------|
| **Last Synced** | Shows when data was last refreshed |
| **Refresh Button** | Fetches latest data from Graph API |

> [!TIP]
> Always refresh data before configuring to ensure you're working with the latest settings.

---

### Step 2: Workload Selection

Select which PIM workloads you want to configure.

| Workload | Description |
|----------|-------------|
| **Directory Roles** | Entra ID administrative roles |
| **PIM for Groups** | Groups managed by PIM |

You can select one or both workloads. The wizard will show relevant options based on your selection.

> [!NOTE]
> You must have consented to the required permissions for each workload. If not consented, the workload will be unavailable.

---

### Step 3: Configuration Type

Choose what type of configuration you want to perform.

| Type | Description |
|------|-------------|
| **Policies Only** | Configure activation rules, expiration, approval requirements, and notification settings |
| **Assignments Only** | Manage eligible and active member assignments for roles or groups |
| **Both** | Configure policy settings and member assignments in one flow |

---

### Step 4: Scope Selection

Select the specific roles and/or groups you want to configure.

**Configuration Modes:**

| Mode | Description |
|------|-------------|
| **Start Fresh** | Begin with Microsoft default settings |
| **Load Current** | Load settings from the selected role/group (single selection only) |
| **Clone From** | Copy settings from another role/group |

**For Directory Roles:**
- Search and filter available roles
- Select multiple roles at once
- See current assignment counts
- Clone settings from any existing role

**Role filter pills:**

| Filter | Options |
|--------|---------|
| **Type** | All · Built-in · Custom |
| **Privilege** | All · Privileged |
| **Assignments** | All · With · Without |

**For PIM Groups:**
- View PIM-managed groups
- Toggle to show unmanaged (role-assignable) groups
- Select multiple groups

**Group type filter pill:** All · Security · M365 · Mail-enabled

> [!TIP]
> Use "Clone From" to copy a well-configured role's settings to other roles.

> [!NOTE]
> **Load Current** works for both Directory Roles and PIM Groups. Select exactly one item to enable it.

---

### Step 5: Policies *(if Policies or Both selected)*

Define the policy settings to apply.

**Activation Settings:**
- Maximum activation duration (30 minutes to 24 hours)
- Authentication requirement (None, MFA, or Conditional Access)
- Require justification on activation
- Require ticket information
- Require approval (with approver selection)

**Assignment Expiration:**
- Allow permanent eligible assignments
- Maximum eligible assignment duration
- Allow permanent active assignments
- Maximum active assignment duration
- Require MFA on active assignment
- Require justification on active assignment

**Notification Settings:**
Configure email notifications for three event types:
- **Eligible Assignment**: When members are assigned as eligible
- **Active Assignment**: When members are assigned as active
- **Activation**: When eligible members activate the role

For each event, configure notifications to:
- Role administrators
- Assignees/Requestors
- Approvers

> [!NOTE]
> For PIM Groups, you can toggle between **Member** and **Owner** policies.

---

### Step 6: Assignments *(if Assignments or Both selected)*

Manage role/group assignments for users or groups.

**Create New Assignments:**

| Setting | Description |
|---------|-------------|
| **Assignment Type** | Eligible (recommended) or Active |
| **Members** | Search and select users or groups |
| **Duration** | Permanent or time-bound (with start/end dates) |
| **Scope** | Directory-wide (`/`) or specific Administrative Unit |
| **Justification** | Reason for the assignment |

**Permanent Assignment Policy Check:**

When creating assignments, the **Permanent** toggle automatically checks the actual PIM policy for each selected role or group:
- **Checking policy...** — shown briefly while the policy is being loaded
- **Blocked by Policy** — shown when the role/group policy does not allow permanent assignments

If multiple roles/groups are selected, permanent is only allowed if **all** selected items allow it.

**Manage Existing Assignments:**
- View all current assignments for selected roles
- Filter by Eligible, Active, or Expired
- Mark assignments for removal
- Preview affected users before applying

> [!TIP]
> Use eligible assignments for most scenarios. Active assignments should only be used when immediate access is required without activation.

---

### Step 7: Review

Review all changes before applying.

The review step shows:
- Summary of selected items
- Policy settings to be applied
- Assignments to be created
- Assignments to be removed
- High-risk role warnings

> [!IMPORTANT]
> Review carefully — changes will be applied to all selected roles/groups.

---

### Step 8: Apply

Execute the configuration changes.

**Process Phases:**
1. **Policies** — Updates PIM settings for each selected role/group
2. **Assignments** — Creates new role/group assignments
3. **Removals** — Removes marked assignments

**Features:**
- Real-time progress indicator
- Success/failure status per operation
- Detailed error messages
- Retry failed operations button
- Expandable operation details

> [!NOTE]
> You can see detailed logs in the browser console for debugging purposes.

---

### Step 9: Checkpoint *(dual-workload flows only)*

When configuring both Directory Roles and PIM Groups, a checkpoint step shows the results of the first workload and lets you continue to the second workload or exit early.

---

### Step 10: Final

Completion summary with navigation links to the Report page and Dashboard.

---

## Manual Mode

For users who prefer direct access to configuration tools with a staged-changes workflow.

```
┌──────────────────────────────────────────────────────────────────┐
│  [Directory Roles]  [PIM Groups]                                  │
├───────────────────────┬──────────────────────────────────────────┤
│    Role Selection     │    Settings Form                         │
├───────────────────────┼──────────────────────────────────────────┤
│ ☐ Global Admin        │  Activation Settings                     │
│ ☑ User Admin          │  ─────────────────────────────────────   │
│ ☑ Groups Admin        │  Max Duration: [4 hours]                 │
│ ☐ Exchange Admin      │  ☑ Require MFA                           │
│ ☑ SharePoint Admin    │  ☑ Require Justification                 │
│ ...                   │  ☐ Require Approval                      │
│                       │                                          │
│ 3 roles selected      │  [Stage Changes]                         │
└───────────────────────┴──────────────────────────────────────────┘
│  Staged Changes (2)   [Apply All]  [Clear All]                    │
│  ✓ User Admin — Policy settings staged                            │
│  ✓ Groups Admin — Policy settings staged                          │
└──────────────────────────────────────────────────────────────────┘
```

### Workload Tabs

Switch between **Directory Roles** and **PIM Groups** using the tabs at the top of the page.

### Role / Group Selector

The left panel shows all available items for the selected workload.

**Features:**
- Search to filter roles/groups by name
- Quick-filter pills to narrow the list without typing
- Click to select/deselect
- Shows assignment counts
- Tags indicate role type

**Role filter pills:**

| Filter | Options |
|--------|---------|
| **Type** | All · Built-in · Custom |
| **Privilege** | All · Privileged |
| **Assignments** | All · With · Without |

**Group filter pill:** All · Security · M365 · Mail-enabled

### Settings Form

The right panel shows configuration options when roles or groups are selected.

**Load From Selected Role/Group:**
If exactly one item is selected, you can load that item's current settings as a template.

### Staged Changes

Changes are staged locally before being sent to the API. Review all queued changes in the panel at the bottom of the page.

- Click **Stage Changes** to queue a change for the selected roles/groups
- Click **Apply All** to submit all staged changes to the Graph API via a progress modal
- Click **Clear All** to discard all staged changes without applying

---

## Bulk Mode

For CSV-based batch configuration. Best suited when you have exported settings from the Report page and want to apply changes across many roles or groups at once.

```
Upload → Compare → Apply → Results
```

### Step 1: Upload

Upload a CSV file exported from the **Report page** or downloaded as a template. Four CSV types are supported:

| CSV Type | Auto-detected from headers | Use case |
|----------|---------------------------|----------|
| **Role Policies** | Headers include `Role ID`, `Max Activation Duration`, etc. | Apply policy settings to Directory Roles |
| **Group Policies** | Headers include `Group ID`, `Member Max Duration`, etc. | Apply policy settings to PIM Groups |
| **Role Assignments** | Headers include `Role ID`, `Principal ID`, `Assignment Type`, `Action` | Add and/or remove eligible/active assignments for Directory Roles |
| **Group Assignments** | Headers include `Group ID`, `Principal ID`, `Access Type`, `Action` | Add and/or remove eligible/active assignments for PIM Groups |

> [!TIP]
> Use **Download Template** buttons to get the correct column headers for each type. The Report page **Access Rights** export generates bulk-compatible assignment CSVs with Role ID / Group ID and Principal ID pre-filled — ready to edit and re-import.

> [!NOTE]
> Approver changes (adding/removing approvers) are not supported in Bulk mode because they require user ID lookup. Use **Wizard mode** for approver configuration.

### Action column — add and remove in one CSV

Assignment CSVs include an **Action** column that controls what happens to each row:

| Action value | Behavior |
|-------------|----------|
| `add` (default) | Creates the assignment; skips rows that already exist |
| `remove` | Removes the assignment; skips rows that are already gone |

A single CSV can contain both `add` and `remove` rows. The preview step shows each row's status: **New**, **Already exists**, **Will remove**, **Already removed**, or **Permanent not allowed**.

**Export → Edit → Import roundtrip:**
1. Go to **Report** → export **Access Rights**
2. Two CSV files are generated: one for role assignments, one for group assignments — both include Role/Group ID, Principal ID, and `Action = add`
3. Change `Action` to `remove` for any rows you want to delete
4. Upload to Bulk mode and apply

### Step 2: Compare / Preview

**For policy CSVs:** Review the diff between your CSV and the current live settings:
- All changes are pre-selected by default
- Deselect individual fields you want to skip
- Use **Select All / Deselect All** to batch-select

**For assignment CSVs:** A row-by-row preview validates each assignment before apply:
- Errors (missing required fields) are shown per row
- Select/deselect individual rows before applying
- Rows with status **Already exists** or **Already removed** are automatically skipped

### Step 3: Apply

Click **Apply N Changes** (policies) or the apply button (assignments) to execute. A progress bar tracks each update in real time.

### Step 4: Results

A per-row results table shows success or failure for each operation with detailed error messages. Click **Retry Failed** to re-queue only the failed rows, or **Start Over** to upload a new CSV.

**What can be changed via Bulk mode:**

| Field | Role Policies | Group Policies |
|-------|:-------------:|:--------------:|
| Max activation duration | ✅ | ✅ |
| MFA required | ✅ | ✅ |
| Justification required | ✅ | ❌ |
| Approval required | ✅ | ✅ |
| Approvers | ❌ (use Wizard) | ❌ (use Wizard) |
| Authentication Context | ❌ (use Wizard) | ❌ |

| Field | Role Assignments | Group Assignments |
|-------|:---------------:|:-----------------:|
| Add eligible assignment | ✅ | ✅ |
| Add active assignment | ✅ | ✅ |
| Remove assignment | ✅ | ✅ |
| Time-bound duration | ✅ | ✅ |
| Permanent assignment | ✅ (if policy allows) | ✅ (if policy allows) |
| Administrative Unit scope | ✅ | ❌ |

---

## Activation Settings

Settings that apply when users **activate** their eligible role.

| Setting | Description | Recommended |
|---------|-------------|-------------|
| **Max Duration** | Maximum activation time | 4-8 hours for most roles |
| **Require MFA** | Users must complete MFA | ✅ Always enable |
| **Require Justification** | Users must explain why | ✅ Enable for audit |
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

> [!IMPORTANT]
> Configuration operations require the `RoleManagementPolicy.ReadWrite.Directory` permission.

Without this permission:
- A warning banner will be displayed
- Settings form will work but apply will fail
- You will be prompted to grant permissions in Settings

To grant permissions:
1. Click the warning banner or go to **Settings**
2. Click **Grant Write Permissions**
3. Complete the consent flow
4. Refresh the page

---

## Best Practices

### Choose the Right Mode

| Scenario | Recommended Mode |
|----------|-----------------|
| Configure multiple roles/groups with full control | **Wizard** |
| Quick one-off policy change | **Manual** |
| Apply exported CSV settings at scale | **Bulk** |

### Use the Wizard for Bulk Changes

The wizard ensures you:
1. Have fresh data before configuring
2. Select the right workloads
3. Review scope before applying

### Standardize Settings

1. Define organization-wide standards
2. Select all similar roles
3. Apply consistent settings

Example standards:
- All privileged roles: 4h max, MFA required, approval required
- All standard roles: 8h max, MFA required

### Test First

1. Select one non-critical role
2. Apply settings
3. Verify in Azure Portal
4. Then apply to other roles

### Document Changes

1. Export current settings (Report page)
2. Make changes
3. Export new settings
4. Compare for audit trail

---

## Troubleshooting

### Write Permissions Required

**Symptom**: Warning banner "Write permissions required"

**Solution**:
1. Click **Open Settings** on the banner
2. Grant write permissions
3. Refresh and try again

### "Failed to apply settings"

**Cause**: Permission issues or API errors

**Solution**:
1. Verify you have `RoleManagementPolicy.ReadWrite.Directory`
2. Check if role is protected (e.g., Global Admin requires Global Admin)
3. Check browser console for detailed error

### Wizard State Lost

**Cause**: Session cleared or browser closed

**Solution**:
- Wizard state is stored in memory only (no persistence)
- Refreshing the page clears state (by design)
- Closing the browser clears state
- Use Manual mode for quick one-off changes

### Assignment Creation Fails

**Symptom**: "Invalid role assignment request" error

**Common causes**:
- **Permissions**: Ensure you have `RoleManagementPolicy.ReadWrite.Directory`
- **Conflicting assignment**: User may already have an active assignment
- **Policy restrictions**: The role's policy may block certain assignment types

**Solution**:
1. Check the browser console for detailed error messages
2. Verify the user doesn't already have an assignment for this role
3. If creating an active assignment, ensure the role allows permanent active assignments (if permanent is selected)
4. Try with a different role to isolate the issue

### Bulk Mode: Approver Changes Not Applied

**Cause**: Bulk mode only supports activation settings (duration, MFA, justification, approval toggle). Adding or removing approvers requires user ID lookup and is not supported via CSV.

**Solution**: Use **Wizard mode** to configure approvers.

### Bulk Mode: Assignment Removal Has No Effect

**Cause**: The row's status was **Already removed** — the assignment no longer exists.

**Solution**: Check the preview step before applying. Rows with status **Already removed** are automatically skipped. If you expected the assignment to exist, verify in the Report page.

### "Permanent" Toggle Shows "Blocked by Policy"

**Cause**: The selected role or group has a PIM policy that forbids permanent assignments.

**Solution**: Use a time-bound assignment instead, or update the role policy first (via the Wizard Policies step) to allow permanent assignments before creating the assignment.

---

## Next Steps

- [Report Page](./08-report-page.md) - View your configurations
- [Key Concepts](./06-key-concepts.md) - Understand terminology
- [Architecture](./00-architecture.md) - Technical details of the wizard

---

*Last updated: March 8, 2026*
