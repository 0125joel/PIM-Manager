# Instellingen & Consent Framework

Dit document beschrijft de Settings modal en consent framework geïntroduceerd in Fase 2.

## Workloads

Workloads zijn databronnen die PIM Manager kan lezen uit je tenant.

| Workload | Permissie | Status |
|----------|-----------|--------|
| Directory Roles | `RoleManagement.Read.Directory` | Core (altijd aan) |
| PIM for Groups | `RoleManagement.Read.All`, `PrivilegedAccess.Read.AzureADGroup` | Optioneel |

### Consent Flow

1. Gebruiker klikt "Enable" op een workload card in Settings
2. MSAL popup vraagt extra permissies aan
3. Bij succes wordt workload opgeslagen in `localStorage` als enabled
4. Data wordt opgehaald voor die workload

## Optionele Features

Features zijn sub-functionaliteiten die extra permissies vereisen.

| Feature | Parent Workload | Permissie |
|---------|-----------------|-----------|
| Security Alerts | Directory Roles | `PrivilegedAccess.Read.AzureAD` |

## Hide vs. Disable

| Actie | Effect | Hoe ongedaan maken |
|-------|--------|-------------------|
| **Hide** | Alleen UI - data wordt nog opgehaald | Klik "Show" of toggle chip |
| **Disable** | Stopt data ophalen | Klik "Enable" opnieuw |
| **Revoke** | Verwijder permissie uit Entra ID | Entra Admin Center → Enterprise Apps |

## View Chips

De chip bar op Dashboard biedt snelle toggles:

```
[Directory Roles 👁️] [PIM Groups 👁️]
```

- Klik chip = toggle visibility
- Grijze chip = verborgen
- Enkele actieve workload kan niet verborgen worden
- **Tijdelijke Filtering:** Chips kunnen tijdelijk worden overschreven door URL-parameters (bijv. bij navigatie vanaf het Dashboard). Dit overschrijft je opgeslagen voorkeuren NIET.

## Belangrijke Bestanden

| Bestand | Doel |
|---------|------|
| `src/components/SettingsModal.tsx` | Settings modal UI |
| `src/components/WorkloadChips.tsx` | Page-level chip bar |
| `src/hooks/useIncrementalConsent.ts` | MSAL consent + localStorage |
| `src/contexts/UnifiedPimContext.tsx` | Multi-workload state management |

## Architectuur Notities

Zie [architecture_gap_analysis.md](../../.gemini/antigravity/brain/.../architecture_gap_analysis.md) voor Gap 4: WorkloadChips als Data Filters.
