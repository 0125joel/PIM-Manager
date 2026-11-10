# Settings & Consent Framework

This document describes the Settings page (`/settings`) and consent framework for managing workloads and features.

## Workloads

Workloads are data sources that PIM Manager can read from your tenant.

| Workload | Permissions Required | Status |
|----------|---------------------|--------|
| **Directory Roles** | `RoleManagement.Read.Directory`, `RoleAssignmentSchedule.Read.Directory`, `RoleEligibilitySchedule.Read.Directory`, `RoleManagementPolicy.Read.Directory` | Core (always enabled) |
| **PIM for Groups** | `PrivilegedAccess.Read.AzureADGroup`, `RoleManagementPolicy.Read.AzureADGroup`, `Group.Read.All` | Optional (implemented) |
| **Intune** | TBD | Planned (not implemented) |
| **Exchange** | TBD | Planned (not implemented) |
| **SharePoint** | TBD | Planned (not implemented) |
| **Defender** | TBD | Planned (not implemented) |

> [!NOTE]
> Only Directory Roles and PIM for Groups are currently implemented. Future workloads are scaffolded in code but not yet functional.

### Consent Flow

1. User clicks "Enable" on a workload card in Settings
2. MSAL popup requests additional permissions
3. On success, workload is stored in `localStorage` as enabled
4. Data fetching begins for that workload

## Optional Features

Features are sub-capabilities that require additional permissions beyond the base workload.

| Feature | Parent Workload | Permission Required |
|---------|-----------------|---------------------|
| **Security Alerts** | Directory Roles | `RoleManagementAlert.Read.Directory` |

**Feature Characteristics:**
- Expandable sub-items under workload cards on the Settings page
- Independent Enable/Hide/Show controls
- Separate localStorage persistence (`pim_feature_enabled_[featureId]`)
- Graceful degradation if permission denied (403)

## Hide vs. Disable

| Action | Effect | How to Revert |
|--------|--------|---------------|
| **Hide** | UI only - data still fetched | Click "Show" or toggle chip |
| **Disable** | Stops data fetching | Click "Enable" again |
| **Revoke** | Remove permission from Entra ID | Microsoft Entra admin center → Enterprise Apps |

## View Chips

The chip bar on Dashboard provides quick toggles:

```
[Directory Roles 👁️] [PIM for Groups 👁️]
```

- Click chip = toggle visibility
- Grayed chip = hidden
- Single active workload cannot be hidden
- **Transient Filtering:** Chips can be overridden by URL parameters temporarily (e.g., when navigating from the Dashboard). This does NOT overwrite your saved preferences.

## Settings Modal Tabs

The Settings page has these sections: Workloads and permissions, Display, Emergency access accounts and Advanced. Display holds the theme, the view the dashboard and the Azure Report open in, and **Details**: with Fewer, each page and view remembers its own Show more details; with More, every page shows everything. Changing Details clears the remembered choices. **Tours**: with On, a short tour starts the first time you open a part of the app; with Off, none start by themselves, while Start the tour in Help keeps working. (The former modal tabs were:)

### Workloads Tab

**Features:**
- List of all workloads (Directory Roles, PIM for Groups, etc.)
- Enable/Disable buttons for optional workloads
- Show/Hide toggles for visibility
- Expandable sub-features (e.g., Security Alerts)
- "Always on" badge for core workloads (Directory Roles)

**States:**
- **Not enabled**: Blue "Enable" button (triggers MSAL consent popup)
- **Enabled + Visible**: "Hide" button available
- **Enabled + Hidden**: "Show" button available
- **Locked**: "Always on" badge (cannot disable)

### Developer Tab

**Features:**
- **Log Level Selector**: Toggle between INFO and DEBUG
- **Console Usage Instructions**: How to view logs in browser console
- **Persistence**: Selected log level saved to `localStorage` with key `LOG_LEVEL`

**Log Levels:**
- **INFO**: Standard logging (default)
- **DEBUG**: Verbose logging with additional context

> [!TIP]
> Use DEBUG mode when troubleshooting data fetching issues or consent problems. The logger outputs to browser console only (not sent to any server).

---

## localStorage Keys

The application uses specific localStorage keys for persistence:

| Key | Purpose | Example Value |
|-----|---------|---------------|
| `pim_workload_enabled_[workloadId]` | Workload consent status | `"true"` or `"false"` |
| `pim_visibility_[workloadId]` | Workload visibility toggle | `"true"` or `"false"` |
| `pim_feature_enabled_[featureId]` | Feature consent status | `"true"` or `"false"` |
| `LOG_LEVEL` | Developer log level | `"INFO"` or `"DEBUG"` |
| `details-preference` | Details in Settings > Display | `"fewer"` or `"more"` |
| `details-[page]` | Show more details of one page or view: `entra-dashboard-basic`, `entra-dashboard-advanced`, `entra-report`, `azure-dashboard-basic`, `azure-dashboard-advanced`, `azure-report` | `"1"` or `"0"` |
| `tours-seen` | The tours you have seen | `["app","entra-report"]` |
| `tours-setting` | Tours in Settings > Display | `"on"` or `"off"` |
| `tours-demo-[product]` | The answer to the demo question per product (`entra`, `azure`); the demo keeps it in its own storage, which ends with the tab | `"yes"` or `"no"` |

**SessionStorage Keys** (separate from settings):
- `pim_groups_data_cache`: Cached PIM for Groups data
- `pim_groups_timestamp`: Last fetch timestamp for groups
- `pim_data_cache`: Cached Directory Roles data
- `pim_data_timestamp`: Last fetch timestamp for roles

---

## Key Files

| File | Purpose |
|------|---------|
| `src/app/settings/page.tsx` | Settings page (permissions table, display, emergency access accounts, advanced) |
| `src/components/WorkloadChips.tsx` | Page-level chip bar |
| `src/hooks/useIncrementalConsent.ts` | MSAL consent + localStorage persistence |
| `src/hooks/useConsentedWorkloads.ts` | Consent checking logic |
| `src/contexts/UnifiedPimContext.tsx` | Multi-workload state management |
| `src/utils/logger.ts` | Centralized logging with LOG_LEVEL support |

---

## Next Steps

- [Dashboard Page](./07-dashboard-page.md) - Using workload toggles in Dashboard
- [Report Page](./08-report-page.md) - Multi-workload filtering
- [Key Concepts](./06-key-concepts.md) - Understanding workloads
