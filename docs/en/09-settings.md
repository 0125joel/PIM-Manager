# Settings & Consent Framework

This document describes the Settings modal and consent framework introduced in Fase 2.

## Workloads

Workloads are data sources that PIM Manager can read from your tenant.

| Workload | Permission | Status |
|----------|------------|--------|
| Directory Roles | `RoleManagement.Read.Directory` | Core (always enabled) |
| PIM for Groups | `RoleManagement.Read.All`, `PrivilegedAccess.Read.AzureADGroup` | Optional |

### Consent Flow

1. User clicks "Enable" on a workload card in Settings
2. MSAL popup requests additional permissions
3. On success, workload is stored in `localStorage` as enabled
4. Data fetching begins for that workload

## Optional Features

Features are sub-capabilities that require additional permissions.

| Feature | Parent Workload | Permission |
|---------|-----------------|------------|
| Security Alerts | Directory Roles | `PrivilegedAccess.Read.AzureAD` |

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

## Key Files

| File | Purpose |
|------|---------|
| `src/components/SettingsModal.tsx` | Settings modal UI |
| `src/components/WorkloadChips.tsx` | Page-level chip bar |
| `src/hooks/useIncrementalConsent.ts` | MSAL consent + localStorage |
| `src/contexts/UnifiedPimContext.tsx` | Multi-workload state management |

## Architecture Notes

See [architecture_gap_analysis.md](../../.gemini/antigravity/brain/.../architecture_gap_analysis.md) for Gap 4: WorkloadChips as Data Filters.
