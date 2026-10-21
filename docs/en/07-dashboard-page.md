# Dashboard Page

The Dashboard is the central hub for monitoring your Privileged Identity Management (PIM) posture. It provides at-a-glance insights into role assignments, policies, security configurations, and user activity.

---

## Overview

**Purpose:** Real-time visibility into PIM coverage and assignment distribution across Directory Roles and PIM for Groups.

**Page head:** the title, a Basic or Advanced switch, in Advanced a Privileged roles or All roles switch, "synced N min ago", Refresh (smart refresh) and Export. Under it the "counting" chips (Directory roles, PIM for Groups, Unmanaged groups, Security alerts) decide which workloads count on this page; a workload without consent shows a dashed chip with a lock that starts consent.

**Filter:** a click on a card, a legend row or an Easy to miss row sets one filter, kept in the URL as `f` (for example `/dashboard?f=mfa:neither`). A bar under the chips shows the filter as a removable chip, a sentence with the count and "Open in report with this filter". Escape clears it.

---

## View Modes

### Basic Mode

Eight cards (4 by 2), then in two columns: **Has access** (permanent, eligible, active time-bound donut) and **On activation** (Entra MFA, auth context, neither, with approval, justification and over 8 h figures), **Role-assignable groups outside PIM** and **From Microsoft** (PIM's own alerts, rows expand inline), **Easy to miss** (six rows in three categories) and a **tip bar** with tips computed from the tenant. Every number is defined in `utils/dashboardStats.ts` and tested against a fixture.

### Advanced Mode

The same head and cards, then five full width sections: **Has access, and how** (per workload bars, direct or through a group), **On activation** (MFA, approval, justification and maximum duration charts for privileged roles or all roles, plus the custom extensions list), **PIM for Groups** (groups outside PIM, top 5 managed groups), **Most privileged, and who approves** (top 6 accounts, approvers, a warning for roles with one approver) and **Right now** (running activations, eligibility ending within 7 days). The sections use the whole tenant and are dimmed while a filter is active.

---

## Cards

| Card | Number |
|------|--------|
| Roles and groups | Role definitions plus onboarded groups that count |
| Active now | Active assignments created by activation |
| Permanent | Active assignments without an end that an administrator created |
| Eligible | Eligibility schedules and instances |
| Privileged roles | Roles with `isPrivileged` (All roles in Advanced: every role) |
| Require approval | Privileged roles whose policy requires approval |
| Custom roles | Roles that are not built in |
| Groups under PIM | Onboarded share of the role-assignable groups |

Policy dependent numbers show a placeholder until the policies are loaded; a failed load shows a dash and the reason.

---

## States

- **Loading:** skeletons, a progress line and one status sentence; never a 0 for an unknown value.
- **No consent:** a bordered box with a lock and "Grant read access".
- **All clear:** a success line ("No alerts. 7 checks passed.").
- **Failed:** a box with the cause (status code after retries), Try again and Dismiss; never a toast.

---

## Workload Management

### Workload Chips

Row of colored chips showing active workloads with gear button to open Settings.

**Chips:**
1. **Directory Roles** (Shield icon) - Blue when visible
2. **Security Alerts** (Alert icon) - Toggle under Directory Roles
3. **PIM for Groups** (Users icon) - Blue when visible
4. **Unmanaged Groups** (ShieldOff icon) - Toggle under PIM for Groups

**Behavior:**
- Hidden chips show with strikethrough + EyeOff icon
- Can't hide all workloads (must have at least 1 active)
- URL override: `?workload=pimGroups` shows only that workload

### Settings page

Workload permissions, display, emergency access accounts and advanced options live on the `/settings` page (gear icon next to the chips, or the account menu). Consent is requested per workload from the permissions table. Preferences are stored in localStorage (`pim_feature_enabled_`, `pim_write_consent_`).

---

## Filtering System

One filter model for the dashboard and the report (`utils/dashboardFilter.ts`): `assignment`, `privileged`, `approval`, `mfa`, `justification`, `maxDuration`, `principalType`, `noEndDate`, `activationNotification`, `hasEligible`, `roleTemplateId`, `customRole`, `excludeEmergency`. A click sets exactly one filter, joined keys are written as `f=key:value,key:value`. A filter on an activation term without `privileged` is applied as privileged roles. "Open in report with this filter" carries the filter to `/report?f=...`, where the report applies the same functions, so both show the same roles.

---

## Navigation to Report

| Component | Link | Behavior |
|-----------|------|----------|
| Filter bar | "Open in report with this filter" | `/report?f={filter}` |
| Advanced PIM for Groups | "All in report" | `/report` |

---

## Data Sources

**Contexts & Hooks:**

| Data Source | Purpose |
|-------------|---------|
| `usePimData()` | Directory roles + assignments + policies |
| `useUnifiedPimData()` | PIM for Groups + workload management |
| `useDashboardFilter()` | The filter `f` in the URL |
| `useSecurityAlerts()` | Microsoft security alerts API |
| `useDashboardScope()` | Privileged or All roles (Advanced) |
| `useViewMode()` | Basic/Advanced toggle state |

---

## PDF Export

**Triggered by:** "Export" button in the page head

**Export Includes:**
- All visible charts (based on workload selection)
- Filtered roles/groups data
- Tenant ID and user info
- Security alerts (if permission granted)
- Filter summary (if active)

**Components:** `ExportDialog` (PDF or CSV; the CSV has the columns of the Report's Overview assignments file, `utils/exportSchema.ts`; detail, audience, names, chart style, workloads, filter, content blocks); the report content is built by `utils/exportReport.ts` and drawn by `components/pdf/ReportDocument.tsx`

---

## Data Refresh

**Refresh Mechanism:**
- **Button:** "Refresh" (page head), the smart refresh; "Clear cached data" in Settings plus a reload does a full reload
- **Handler:** Calls `refreshAllWorkloads()` from UnifiedPimContext
- **Disabled when:** Data loading or policies loading

**Loading Indicators:**
- `LoadingStatus` component shows current load state
- `SyncStatus` component shows last sync time

**Auto-refresh:** On component mount if no data and no error

---

## User Interactions Summary

| Interaction | Result |
|-------------|--------|
| Toggle view mode | Switch dashboard complexity |
| View Workload settings | Open the Settings page |
| Hide/show workload | Hide/show data + charts |
| Apply filter | URL updated, data filtered |
| View Report | Navigate to `/report` with filters |
| Refresh data | Re-fetch all workloads |
| Export to PDF | Open export modal |
| Search roles/groups | Filter displayed items |
| Expand alert | Show full description |
| Dismiss alert | Hide alert (session-stored) |
| Pause Pro Tips | Stop auto-rotation |

---

## Next Steps

- [Report Page](./07-report-page.md) - Detailed configuration view
- [Key Concepts](./05-key-concepts.md) - Understanding PIM terminology
- [Data Flow](./03-data-flow.md) - How data is fetched and processed
