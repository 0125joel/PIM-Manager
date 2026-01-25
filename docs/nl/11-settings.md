# Instellingen & Consent Framework

Dit document beschrijft de Settings modal en consent framework geïntroduceerd in Fase 2.

## Workloads

Workloads zijn databronnen die PIM Manager kan lezen uit je tenant.

| Workload | Vereiste Permissies | Status |
|----------|---------------------|--------|
| **Directory Roles** | `RoleManagement.Read.Directory`, `RoleAssignmentSchedule.Read.Directory`, `RoleEligibilitySchedule.Read.Directory`, `RoleManagementPolicy.Read.Directory` | Core (altijd ingeschakeld) |
| **PIM for Groups** | `PrivilegedAccess.Read.AzureADGroup`, `RoleManagementPolicy.Read.AzureADGroup`, `Group.Read.All` | Optioneel (geïmplementeerd) |
| **Intune** | TBD | Gepland (niet geïmplementeerd) |
| **Exchange** | TBD | Gepland (niet geïmplementeerd) |
| **SharePoint** | TBD | Gepland (niet geïmplementeerd) |
| **Defender** | TBD | Gepland (niet geïmplementeerd) |

> [!NOTE]
> Alleen Directory Roles en PIM for Groups zijn momenteel geïmplementeerd. Toekomstige workloads zijn voorbereid in de code maar nog niet functioneel.

### Consent Flow

1. Gebruiker klikt "Enable" op een workload card in Settings
2. MSAL popup vraagt extra permissies aan
3. Bij succes wordt workload opgeslagen in `localStorage` als enabled
4. Data wordt opgehaald voor die workload

## Optionele Features

Features zijn sub-functionaliteiten die extra permissies vereisen bovenop de basis workload.

| Feature | Parent Workload | Vereiste Permissie |
|---------|-----------------|---------------------|
| **Security Alerts** | Directory Roles | `RoleManagementAlert.Read.Directory` |

**Feature Kenmerken:**
- Uitklapbare sub-items onder workload cards in Settings modal
- Onafhankelijke Enable/Hide/Show controls
- Afzonderlijke localStorage persistentie (`pim_feature_enabled_[featureId]`)
- Graceful degradation bij permission denied (403)

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

---

## Settings Modal Tabs

De Settings modal heeft twee tabs:

### Workloads Tab

**Kenmerken:**
- Lijst van alle workloads (Directory Roles, PIM for Groups, etc.)
- Enable/Disable knoppen voor optionele workloads
- Show/Hide toggles voor zichtbaarheid
- Uitklapbare sub-features (bijv. Security Alerts)
- "Always on" badge voor kern workloads (Directory Roles)

**Staten:**
- **Niet ingeschakeld**: Blauwe "Enable" knop (triggert MSAL consent popup)
- **Ingeschakeld + Zichtbaar**: "Hide" knop beschikbaar
- **Ingeschakeld + Verborgen**: "Show" knop beschikbaar
- **Vergrendeld**: "Always on" badge (kan niet uitgeschakeld worden)

### Developer Tab

**Kenmerken:**
- **Log Level Selector**: Schakel tussen INFO en DEBUG
- **Console Gebruiksinstructies**: Hoe logs te bekijken in browser console
- **Persistentie**: Geselecteerd log level opgeslagen in `localStorage` met key `LOG_LEVEL`

**Log Levels:**
- **INFO**: Standaard logging (default)
- **DEBUG**: Uitgebreide logging met extra context

> [!TIP]
> Gebruik DEBUG modus bij het oplossen van data fetching problemen of consent problemen. De logger output gaat alleen naar browser console (niet naar een server).

---

## localStorage Keys

De applicatie gebruikt specifieke localStorage keys voor persistentie:

| Key | Doel | Voorbeeld Waarde |
|-----|------|------------------|
| `pim_workload_enabled_[workloadId]` | Workload consent status | `"true"` of `"false"` |
| `pim_visibility_[workloadId]` | Workload zichtbaarheid toggle | `"true"` of `"false"` |
| `pim_feature_enabled_[featureId]` | Feature consent status | `"true"` of `"false"` |
| `LOG_LEVEL` | Developer log level | `"INFO"` of `"DEBUG"` |

**SessionStorage Keys** (apart van settings):
- `pim_groups_data_cache`: Gecachte PIM Groups data
- `pim_groups_timestamp`: Laatste fetch timestamp voor groepen
- `pim_data_cache`: Gecachte Directory Roles data
- `pim_data_timestamp`: Laatste fetch timestamp voor rollen

---

## Belangrijke Bestanden

| Bestand | Doel |
|---------|------|
| `src/components/SettingsModal.tsx` | Settings modal UI (Workloads + Developer tabs) |
| `src/components/WorkloadChips.tsx` | Page-level chip bar |
| `src/hooks/useIncrementalConsent.ts` | MSAL consent + localStorage persistentie |
| `src/hooks/useConsentedWorkloads.ts` | Consent checking logica |
| `src/contexts/UnifiedPimContext.tsx` | Multi-workload state management |
| `src/utils/logger.ts` | Gecentraliseerde logging met LOG_LEVEL ondersteuning |

## Architectuur Notities

Zie [architecture_gap_analysis.md](../../.gemini/antigravity/brain/.../architecture_gap_analysis.md) voor Gap 4: WorkloadChips als Data Filters.
