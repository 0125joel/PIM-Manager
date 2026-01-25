# Dashboard Page

The Dashboard is the central hub for monitoring your Privileged Identity Management (PIM) posture. It provides at-a-glance insights into role assignments, policies, security configurations, and user activity.

---

## Overview

**Purpose:** Real-time visibility into PIM coverage and assignment distribution across Directory Roles and PIM Groups.

**Key Capabilities:**
- Security posture assessment via analytical charts
- Identification of configuration issues and expiring assignments
- Workload-based data filtering
- Interactive filtering that carries to Report page
- PDF export for compliance reporting

---

## View Modes

The Dashboard supports two view modes:

### Basic Mode
**For:** Quick overview and high-level insights

**Shows:**
- 4 Overview Cards (Total Roles, Active Sessions, Permanent Assignments, PIM Coverage)
- 2 Security Charts (Assignment Distribution, MFA & CA Enforcement)
- Security Alerts panel
- Pro Tips carousel
- Role Overview (5 roles)
- Groups Overview (5 groups)

### Advanced Mode
**For:** Deep analysis and detailed metrics

**Shows:**
- 7 Overview Cards (adds: Eligible Assignments, Custom Roles, Approval Required)
- 7 Security Charts (all available charts)
- Recent Activations timeline
- Expiring Soon alerts
- Top Users ranking
- Approvers Overview
- Configuration Errors widget
- Role & Groups Overview

**Toggle:** Click "Basic" or "Advanced" button in header. Mode persists in localStorage.

---

## Dashboard Components

### Overview Cards

High-level PIM metrics displayed as interactive cards.

**Basic Mode (4 cards):**
1. **Total Roles** - All roles fetched (or "Total Items" if groups enabled)
2. **Active Sessions** - Currently active assignments
3. **Permanent Assignments** - Always-on access
4. **PIM Coverage** - % of privileged roles with policies

**Advanced Mode (3 additional cards):**
5. **Eligible Assignments** - Users ready to activate
6. **Custom Roles** - Count of non-built-in roles
7. **Approval Required** - Roles with approval workflows

**Interaction:** Click card to apply filter to dashboard data.

---

### Security Charts

Multi-dimensional analysis of PIM configuration and assignment distribution.

| Chart | Mode | Purpose | Interactive |
|-------|------|---------|-------------|
| Assignment Distribution | Both | Permanent vs Eligible (roles + groups) | Yes |
| MFA & CA Enforcement | Both | Azure MFA / Conditional Access / None | Yes |
| Assignment Method | Advanced | Direct user vs Group assignments (roles only) | Yes |
| Approval Requirements | Advanced | Roles/Groups requiring approval | Yes |
| Max Duration Distribution | Advanced | Histogram of activation duration limits | Yes |
| Authentication Contexts | Advanced | CA contexts in use (roles only) | Yes |
| PIM Groups Coverage | Advanced | Managed vs Unmanaged groups | No |

**Special Features:**
- **"Only" vs "Has Any" mode** for Assignment Distribution and Assignment Method
- **"Privileged" vs "All Roles" toggle** for MFA chart
- **Color-coded duration buckets** (Green <1h to Red >12h)
- **Respects workload toggles** - charts adapt based on enabled workloads

**Interaction:** Click chart segment to apply filter.

---

### Security Alerts

**File:** `SecurityAlerts.tsx`
**Visibility:** Basic mode only

Displays Microsoft's built-in PIM security recommendations.

**States:**
- **Permission not granted:** Lock icon + "Enable Security Alerts" button
- **Loading:** Spinner
- **Error:** Alert triangle + retry button
- **Success:** Expandable alert cards

**Features:**
- **Expandable alerts** - Click to see full description
- **Dismiss alerts** - Hide individual alerts (session-stored)
- **Passed checks** - Collapsible list of passing checks
- **Restore all** - Clear dismissed list

**Permission:** Requires `RoleManagementAlert.Read.Directory` scope

---

### Role & Groups Overview

**Role Overview (`DashboardRoleOverview.tsx`):**
- Search box + filter dropdown
- 5 most relevant roles
- Each role row links to detailed report

**Groups Overview (`GroupsOverview.tsx`):**
- Stat cards: Eligible/Active members and owners
- **Unmanaged Groups Alert** - Red banner if groups bypass PIM
- 5 most relevant groups
- Group type badges (Security, M365, Mail-enabled)

**Search Filters:**
- All roles
- Privileged only
- PIM configured

**Navigation:** Click role/group → navigates to `/report?search={name}`

---

### Recent Activations (Advanced Only)

**File:** `RecentActivations.tsx`

Timeline view of last 10 role activations.

**Features:**
- Timeline layout with dots and connecting lines
- Expiration badges (if time-bound)
- Principal type indicator (User/Group)
- Privilege level indicator (amber for privileged)
- "Expired" status for past activations

---

### Expiring Soon (Advanced Only)

**File:** `ExpiringSoon.tsx`

Alert on assignments expiring within 7 days.

**Features:**
- Next 10 soonest-expiring assignments
- Color-coded urgency:
  - Red: ≤1 day
  - Orange: ≤3 days
  - Yellow: >3 days
- Countdown display: "Today", "Tomorrow", "Xd"

---

### Top Users (Advanced Only)

**File:** `TopUsers.tsx`

Identify users with most privileged access.

**Metrics per user:**
- Total assignment count
- Breakdown: X Permanent, Y Eligible, Z Active
- Unique role count
- Ranking badge (1st gold, 2nd silver, 3rd bronze)

Shows top 10 users sorted by total assignments.

---

### Approvers Overview (Advanced Only)

**File:** `ApproversOverview.tsx`

Shows who approves role activations.

**Data per approver:**
- Name and email
- Number of roles they approve
- Top 10 approvers (by role count)

---

### Configuration Errors (Advanced Only)

**File:** `ConfigurationErrors.tsx`

Highlights roles with fetch/configuration errors.

**Error Types:**
- 404: Not Found
- 403: Access Denied
- 429: Rate Limited
- Other: Generic errors

**Features:**
- Grouped by error type
- Shows up to 3 roles per type, "+X more" indicator
- Refresh button to retry failed fetches
- Success state: Green checkmark

---

### Pro Tip (Basic Mode Only)

**File:** `ProTip.tsx`

Educational carousel with PIM best practices.

**Features:**
- 10 rotating tips about PIM configuration
- Auto-rotates every 8 seconds
- Pause/resume button
- Previous/next navigation
- Dot indicators (clickable)
- "Learn more" link to Microsoft docs

**Tips covered:** Eligible assignments, approval workflows, activation duration, access reviews, MFA enforcement, global admin limits, security alerts, justification, authentication contexts, break-glass accounts

---

## Workload Management

### Workload Chips

Row of colored chips showing active workloads with gear button to open Settings.

**Chips:**
1. **Directory Roles** (Shield icon) - Blue when visible
2. **Security Alerts** (Alert icon) - Toggle under Directory Roles
3. **PIM Groups** (Users icon) - Blue when visible
4. **Unmanaged Groups** (ShieldOff icon) - Toggle under PIM Groups

**Behavior:**
- Hidden chips show with strikethrough + EyeOff icon
- Can't hide all workloads (must have at least 1 active)
- URL override: `?workload=pimGroups` shows only that workload

### Settings Modal

**Tabs:**

**Workloads Tab:**
- Enable/disable workloads (requires consent)
- Show/hide workloads (visibility toggle)
- Sub-features management (e.g., Security Alerts)

**Developer Tab:**
- Log Level selector (INFO / DEBUG)
- Console usage instructions

**Workload States:**
- **Not enabled** - Blue "Enable" button (triggers consent)
- **Enabled + Visible** - "Hide" button
- **Enabled + Hidden** - "Show" button
- **Locked** - "Always on" badge (Directory Roles)

**Persistence:** localStorage with prefixes `pim_visibility_` and `pim_feature_enabled_`

---

## Filtering System

### How Filtering Works

1. **URL Parameters** - Read via `useSearchParams()`
   - Example: `/dashboard?assignmentType=permanent&memberType=direct`

2. **Universal Filter Hook** - `useRoleFilters()`
   - Reads URL → parses parameters
   - Filters data in real-time
   - Provides: `filteredRoles`, `hasActiveFilters`, `resetFilters()`

3. **Interactive Triggers:**
   - Click pie chart segment
   - Click overview card
   - Use active filters banner buttons

4. **Supported Filters:**
   - `assignmentType`: permanent, eligible, active
   - `memberType`: direct, group
   - `mfaType`: azure-mfa, ca-any, none
   - `approval`: yes, no
   - `maxDuration`: <1h, 2-4h, 5-8h, 9-12h, >12h
   - `privileged`: true, false
   - `pimConfigured`: configured
   - `roleType`: custom

5. **Active Filters Banner:**
   - Shows filter count
   - "View Report" button links to report with same filters preserved
   - "Clear all filters" button resets

---

## Navigation to Report

**Links to Report Page:**

| Component | Link | Behavior |
|-----------|------|----------|
| Active Filters Banner | "View Report" | `/report?{all current URL params}` |
| Role Overview | Role row click | `/report?search={role.name}` |
| Role Overview footer | "View full report" | `/report?workload=directoryRoles` |
| Groups Overview | Group row click | `/report?search={group.name}` |
| Groups Overview footer | "View full report" | `/report?workload=pimGroups` |

---

## Data Sources

**Contexts & Hooks:**

| Data Source | Purpose |
|-------------|---------|
| `usePimData()` | Directory roles + assignments + policies |
| `useUnifiedPimData()` | PIM Groups + workload management |
| `useRoleFilters()` | Universal filtering system |
| `useSecurityAlerts()` | Microsoft security alerts API |
| `useAggregatedData()` | Combined roles + groups metrics |
| `useViewMode()` | Basic/Advanced toggle state |

---

## PDF Export

**Triggered by:** "Export PDF" button in header

**Export Includes:**
- All visible charts (based on workload selection)
- Filtered roles/groups data
- Tenant ID and user info
- Security alerts (if permission granted)
- Filter summary (if active)

**Components:** `PdfExportModal` for customization

---

## Data Refresh

**Refresh Mechanism:**
- **Button:** "Refresh data" (top-right)
- **Handler:** Calls `refreshAllWorkloads()` from UnifiedPimContext
- **Disabled when:** Data loading or policies loading

**Loading Indicators:**
- `LoadingStatus` component shows current load state
- `SyncStatus` component shows last sync time
- Spinner on Refresh button during load

**Auto-refresh:** On component mount if no data and no error

---

## User Interactions Summary

| Interaction | Result |
|-------------|--------|
| Toggle view mode | Switch dashboard complexity |
| View Workload settings | Open Settings modal |
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
