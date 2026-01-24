# Report Page

This document explains the features and functionality of the Report page, the main view for analyzing your PIM configuration.

---

## Overview

The Report Page provides a comprehensive view of all Microsoft Entra ID roles and their PIM configurations.

```
┌─────────────────────────────────────────────────────────┐
│                    Report Page                          │
├─────────────────────────────────────────────────────────┤
│ [Filters]  [Search]  [Export (PDF/CSV) ▼]  [Refresh]    │
├─────────────────────────────────────────────────────────┤
│ Showing 45 of 130 roles                                 │
│                    Fetching role configuration (15/130) │
├─────────────────────────────────────────────────────────┤
│ ┌───────────────────────────────────────────────────┐   │
│ │ Global Administrator                     [Expand] │   │
│ │ 👤 2 eligible │ ⚡ 1 active │ 🔒 1 permanent      │   │
│ │ Tags: [Privileged] [Built-in] [PIM Configured]   │   │
│ └───────────────────────────────────────────────────┘
│ ┌───────────────────────────────────────────────────┐
│ │ User Administrator                       [Expand] │
│ │ 👤 5 eligible │ ⚡ 0 active │ 🔒 3 permanent      │
│ └───────────────────────────────────────────────────┘
│ ...                                                     │
└─────────────────────────────────────────────────────────┘
```

---

## Features

### 🔍 Search

Type in the search box to filter roles by name.

- Searches role display names
- Case-insensitive
- Real-time filtering
- **Drill-down Support:** Supports direct navigation from Dashboard with pre-selected filters

---

### 👁️ Workload Toggles

At the top of the page, you can toggle the visibility of different PIM workloads:

- **Directory Roles:** Show/Hide Entra ID roles.
- **PIM Groups:** Show/Hide PIM-enabled groups.

> [!NOTE]
> These toggles are smart:
> 1. They persist your preference (if you hide Groups, they stay hidden).
> 2. They support **Transient Filtering**: If you navigate from the Dashboard via "View Full Report", the view will automatically filter to show only that workload *without* changing your permanent saved settings.

---

### 🏷️ Filters

Filter roles by various criteria:

| Filter | Options | Purpose |
|--------|---------|---------|
| **Role Type** | Built-in, Custom | Separate Microsoft roles from your custom roles |
| **Assignment Type** | Has Eligible, Has Active, Has Permanent | Find roles with specific assignment types |
| **Member Type** | Has Users, Has Groups | Find roles assigned to users vs groups |
| **Max Duration** | <1h, 1-8h, 8-24h, >24h | Filter by max activation duration |
| **Privileged** | Privileged Only, Non-Privileged | Focus on high-risk roles |
| **PIM Status** | Configured, Not Configured | Find roles without PIM policies |
| **User** | Search by name | Find roles assigned to a specific user or group |
| **Scope** | Tenant-wide, App, Admin Unit, RMAU | Filter by assignment scope |

> [!TIP]
> Combine filters to create powerful queries. For example: "Privileged + Has Permanent" finds high-risk roles with permanent assignments.

#### Scope Filter

The scope filter helps you find roles based on where they are applied:

| Scope Type | Description |
|------------|-------------|
| **Tenant-wide** | Role applies to the entire directory (most common) |
| **App-scoped** | Role is limited to a specific application |
| **Admin Unit** | Role is scoped to an Administrative Unit |
| **RMAU-scoped** | Role is scoped to a Restricted Management Administrative Unit |

---

### 📊 Role Cards

Each role is displayed as an expandable card.

#### Collapsed View

Shows summary information:
- Role name
- Assignment counts (eligible, active, permanent)
- Tags indicating status

#### Expanded View

Shows detailed information:
- **Assignments Section**: Lists all assigned users/groups with scope badges
- **PIM Configuration Section**: Shows policy settings including Authentication Context
- **Approvers**: If approval is required, shows who can approve

---

### 🏷️ Tags

Visual indicators on each role card:

| Tag | Color | Meaning |
|-----|-------|---------|
| `Privileged` | Red | Microsoft classifies this role as privileged |
| `Built-in` | Blue | Microsoft-provided role |
| `Custom` | Purple | Your organization created this role |
| `PIM Configured` | Green | Role has PIM policy configured |
| `No PIM` | Gray | No PIM policy found |

---

### 📥 Export Options

You can export data in multiple formats using the dropdown menu.

#### 📄 Export to PDF

Generate a professional, executive-ready security report.

**Features:**
- **Customizable:** Choose which sections to include (Overview, Charts, Alerts, Data Tables).
- **Multi-Workload:** Supports both Directory Roles and PIM Groups.
- **Visuals:** High-quality charts with organization-aligned colors.
- **Metadata:** Automatically includes Tenant ID and User UPN for tracking.

**Report Sections:**
1.  **Executive Summary:** High-level statistics (Total roles, Active sessions, PIM coverage).
2.  **Security Alerts:** Critical findings with specific affected roles/groups and actionable mitigation advice.
3.  **Charts & Analysis:** Visual breakdown of assignment types, member types, and duration policies.
4.  **Data Tables:** Detailed non-visual data supporting the charts.

#### 📊 Export to CSV

Export raw data for analysis in Excel or other tools.

**Two Options:**

| Option | Description | Use Case |
|--------|-------------|----------|
| **Role Summary** | One row per role with policy configuration | Overview of role settings |
| **Assignment Details** | One row per assignment | Detailed audit of who has access |

> [!NOTE]
> Exports respect your current active filters. If you filter for "Global Administrator", the report will only contain data for that role.

---

### 🔄 Refresh

Click "Refresh" to:
1. Clear cached data
2. Fetch fresh data from Microsoft Graph
3. Restart background policy loading

---

## Assignment Types Explained

### Eligible Assignments

Users/groups who **can activate** the role via PIM.

```
Alice ──[Eligible]──> Global Admin
         │
         └── Must activate via PIM to use
```

### Active Assignments

Currently **activated** PIM assignments.

```
Bob ──[Active]──> Global Admin (Expires in 4 hours)
       │
       └── Activated and currently in use
```

### Permanent Assignments

Direct role assignments that **bypass PIM**.

```
Carol ──[Permanent]──> Global Admin
         │
         └── Always has this role (no activation needed)
```

> [!WARNING]
> Permanent assignments should be minimized. They bypass PIM protections like MFA, approval, and time limits.

---

## PIM Configuration Details

When a role is expanded, you can see its PIM settings:

### Activation Tab

| Setting | Description |
|---------|-------------|
| Max Duration | Maximum time a user can activate (e.g., 8 hours) |
| Require MFA | Must complete MFA to activate |
| Require Justification | Must provide reason for activation |
| Require Approval | Must be approved by designated approvers |
| Approvers | Who can approve activation requests |

### Assignment Tab

| Setting | Description |
|---------|-------------|
| Permanent Eligible Allowed | Can eligible assignments have no expiry? |
| Max Eligible Duration | Maximum duration for eligible assignments |
| Permanent Active Allowed | Can active assignments have no expiry? |
| Max Active Duration | Maximum duration for active assignments |

---

## Loading States

### Initial Load

```
[==================== ] 80%
Fetching assignments...
```

Shows progress through Phase 1 (definitions + assignments).

### Background Policy Load

```
Fetching role configuration in background... (45/130)
```

Shows progress through Phase 2 (policy loading).

### Role-Specific Loading

When clicking a role before its policy is loaded:

```
Loading Configuration...
```

Indicates priority fetch is in progress.

### No Configuration Found

```
No Configuration Found
```

Role exists but has no PIM policy configured.

> [!TIP]
> Roles without PIM policies should be reviewed. Consider configuring PIM for sensitive roles.

---

## Troubleshooting

### Roles not appearing

**Cause**: Filters are too restrictive

**Solution**: Clear filters or check filter combinations

### "Loading Configuration..." stays forever

**Cause**: API error or throttling

**Solution**:
1. Check browser console for errors
2. Wait a few minutes and refresh

### Export is empty

**Cause**: All roles are filtered out

**Solution**: Clear filters or adjust search

---

## Next Steps

- [Configure Page (Planned)](./07-configure-page.md) - View planned functionality
- [Data Flow](./03-data-flow.md) - Understand how data loads
