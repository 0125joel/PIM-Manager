# Settings & Consent Framework

This document describes the Settings modal and consent framework for managing workloads and features.

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
- Expandable sub-items under workload cards in Settings modal
- Independent Enable/Hide/Show controls
- Separate localStorage persistence (`pim_feature_enabled_[featureId]`)
- Graceful degradation if permission denied (403)

## Hide vs. Disable

| Action | Effect | How to Revert |
|--------|--------|---------------|
| **Hide** | UI only - data still fetched | Click "Show" or toggle chip |
| **Disable** | Stops data fetching | Click "Enable" again |
| **Revoke** | Remove permission from Entra ID | Entra Admin Center → Enterprise Apps |

## View Chips

The chip bar on Dashboard provides quick toggles:

```
[Directory Roles 👁️] [PIM Groups 👁️]
```

- Click chip = toggle visibility
- Grayed chip = hidden
- Single active workload cannot be hidden
- **Transient Filtering:** Chips can be overridden by URL parameters temporarily (e.g., when navigating from the Dashboard). This does NOT overwrite your saved preferences.

## Settings Modal Tabs

The Settings modal has two tabs:

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

**SessionStorage Keys** (separate from settings):
- `pim_groups_data_cache`: Cached PIM Groups data
- `pim_groups_timestamp`: Last fetch timestamp for groups
- `pim_data_cache`: Cached Directory Roles data
- `pim_data_timestamp`: Last fetch timestamp for roles

---

## Key Files

| File | Purpose |
|------|---------|
| `src/components/SettingsModal.tsx` | Settings modal UI (Workloads + Developer tabs) |
| `src/components/WorkloadChips.tsx` | Page-level chip bar |
| `src/hooks/useIncrementalConsent.ts` | MSAL consent + localStorage persistence |
| `src/hooks/useConsentedWorkloads.ts` | Consent checking logic |
| `src/contexts/UnifiedPimContext.tsx` | Multi-workload state management |
| `src/utils/logger.ts` | Centralized logging with LOG_LEVEL support |

---

## Next Steps

- [Dashboard Page](./06-dashboard-page.md) - Using workload toggles in Dashboard
- [Report Page](./07-report-page.md) - Multi-workload filtering
- [Key Concepts](./05-key-concepts.md) - Understanding workloads
