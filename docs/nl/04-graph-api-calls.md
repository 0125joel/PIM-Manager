# Microsoft Graph API Calls

Dit document beschrijft alle Microsoft Graph API endpoints die PIM Configurator gebruikt. Dit helpt bij troubleshooting, permission scoping en security reviews.

---

## API Overzicht

| Fase | Endpoint | Doel | Vereiste Machtigingen |
|------|----------|------|----------------------|
| 1 | roleDefinitions | Alle rollen ophalen | RoleManagement.Read.Directory |
| 1 | roleAssignments | Permanente toewijzingen ophalen | RoleManagement.Read.Directory |
| 1 | roleEligibilitySchedules | Eligible toewijzingen ophalen | RoleEligibilitySchedule.Read.Directory |
| 1 | roleAssignmentSchedules | Actieve toewijzingen ophalen | RoleAssignmentSchedule.Read.Directory |
| 2 | roleManagementPolicyAssignments | PIM-beleid ophalen | RoleManagementPolicy.Read.Directory |

---

## Fase 1: Initiële Lading

### 1. Roldefinities

```http
GET /roleManagement/directory/roleDefinitions
```

**API Versie**: `beta` (voor `isPrivileged` property)

**Select Velden**:
- `id` - Unieke identifier
- `displayName` - Leesbare naam
- `description` - Rolbeschrijving
- `isBuiltIn` - Ingebouwde of custom rol
- `isPrivileged` - Microsoft's geprivilegieerde classificatie

> [!NOTE]
> De `isPrivileged` property is alleen beschikbaar in de **beta** API. Als het faalt, valt de app terug op `v1.0` zonder dit veld.

---

### 2. Roltoewijzingen (Permanent)

```http
GET /roleManagement/directory/roleAssignments?$expand=principal
```

**API Versie**: `v1.0`

**Expand**: `principal` - Bevat gebruiker/groep details inline

> [!WARNING]
> Permanente toewijzingen omzeilen PIM volledig. Deze gebruikers hoeven hun rol niet te activeren.

### 1. Unified PIM Context (`UnifiedPimContext.tsx`)
- `GET /directoryRoles/delta` (Delta Query voor Rolwijzigingen)
- `GET /groups/delta` (Delta Query voor Groep Metadata)
- `GET /roleManagement/directory/roleDefinitions` (Fallback Full Sync)
- `GET /roleManagement/directory/roleAssignmentScheduleInstances`
- `GET /roleManagement/directory/roleEligibilityScheduleInstances`

---

### 3. Role Eligibility Schedules

```http
GET /roleManagement/directory/roleEligibilitySchedules?$expand=principal
```

**API Versie**: `beta`

**Doel**: Toont wie **eligible** is voor een rol via PIM.

---

### 4. Role Assignment Schedules

```http
GET /roleManagement/directory/roleAssignmentSchedules?$expand=principal
```

**API Versie**: `beta`

**Doel**: Toont momenteel **actieve** PIM-toewijzingen (geactiveerde rollen).

---

## Fase 2: Policy Laden

### Role Management Policy Assignments

```http
GET /policies/roleManagementPolicyAssignments?$filter=scopeId eq '/' and scopeType eq 'DirectoryRole' and roleDefinitionId eq '{roleId}'&$expand=policy($expand=rules)
```

**API Versie**: `beta`

**Doel**: Verkrijg PIM-configuratie voor een specifieke rol.

> [!IMPORTANT]
> Elke rol vereist een **aparte API call** voor zijn policy. Dit is waarom Fase 2 langer duurt dan Fase 1.

---

### Authentication Context Class References

```http
GET /identity/conditionalAccess/authenticationContextClassReferences
```

**API Versie**: `v1.0`

**Doel**: Verkrijg alle Authentication Context definities van de tenant. Deze worden gebruikt in PIM-beleid om specifieke Conditional Access condities te vereisen voor rolactivatie.

**Response Voorbeeld**:
```json
{
  "value": [
    {
      "id": "c1",
      "displayName": "MFA voor PIM vereisen",
      "description": "Dwingt MFA af bij het activeren van geprivilegieerde rollen",
      "isAvailable": true
    }
  ]
}
```

> [!NOTE]
> Authentication Context wordt gerefereerd in PIM-beleid via `claimValue` (bijv. "c1") en weergegeven met zijn vriendelijke naam.

---

## Directory Objecten & Zoeken

Deze endpoints worden gebruikt voor het zoeken naar gebruikers/groepen (filters) en het ophalen van goedkeurderdetails.

### Zoek Gebruikers & Groepen

```http
GET /users?$search="displayName:{term}"
GET /groups?$search="displayName:{term}"
```

**API Versie**: `v1.0` (vereist `ConsistencyLevel: eventual` header)

**Machtigingen**: `User.Read.All`, `Group.Read.All`

**Doel**: Real-time zoeken voor het toewijzen van rollen of goedkeurders.

---

### Groepsleden Ophalen

```http
GET /groups/{id}/members
```

**API Versie**: `v1.0`

**Doel**: Vouw geneste groepstoewijzingen uit in het Toewijzingsoverzicht.

---

## Smart Refresh Strategie
Om prestaties te verbeteren, implementeert de app een **Smart Refresh** logica:
1.  **Directory Roles**: Gebruikt `/directoryRoles/delta` om *alleen* gewijzigde rollen op te halen.
    *   Als er een delta token is, vragen we wijzigingen op.
    *   Bij expired token (410) vallen we terug op Full Sync.
2.  **PIM Groups**: Gebruikt een Hybride aanpak.
    *   `/groups/delta`: Controleert direct op hernoemde/verwijderde groepen.
    *   **Full Content Fetch**: Haalt Assignments én Policies parallel op voor alle groepen voor maximale betrouwbaarheid.
3.  **Parallelle Uitvoering**: Beide workloads verversen tegelijkertijd.

### Batching & Throttling

Microsoft Graph handhaaft rate limits om servicestabiliteit te beschermen.

### Limieten

| Resource | Limiet | Periode |
|----------|--------|---------|
| Algemeen | 10.000 requests | 10 minuten |
| Role Management | ~60 requests | 1 minuut |

### Throttling Response

Bij throttling retourneert Graph:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 30
```

### Hoe PIM Manager Throttling Afhandelt

| Mechanisme | Implementatie |
|------------|---------------|
| **Rate limiting** | 8 gelijktijdige workers, 300ms vertraging elk (geoptimaliseerd) |
| **Deduplicatie** | Slaat al-opgehaalde policies over |
| **Conservatief quota gebruik** | Gebruikt slechts 10-22% van beschikbaar quota |

**Performance Impact:**
- Policy fetch tijd verminderd van ~15-20s naar ~3-5s (voor 50 rollen)
- 70-80% sneller dan originele implementatie
- Ruim binnen Microsoft Graph API throttling limieten voor alle tenant groottes

**Microsoft Graph API Limieten (Identity & Access):**

| Tenant Grootte | ResourceUnits per 10 sec | Huidig Gebruik | Percentage |
|----------------|-------------------------|----------------|------------|
| Large (>500 gebruikers) | 8.000 RU | ~26 req/sec | 10% |
| Medium (50-500) | 5.000 RU | ~26 req/sec | 16% |
| Small (<50) | 3.500 RU | ~26 req/sec | 22% |

> [!CAUTION]
> Als je regelmatig `429` fouten ziet, kan je tenant limieten raken van andere applicaties. Wacht en probeer opnieuw.

---



## Machtigingen Samenvatting

| Machtiging | Scope | Gebruikt Voor |
|------------|-------|---------------|
| `User.Read` | Gedelegeerd | Ingelogde gebruikersinfo ophalen |
| `RoleManagement.Read.Directory` | Gedelegeerd | Roldefinities lezen |
| `RoleAssignmentSchedule.Read.Directory` | Gedelegeerd | Actieve PIM-toewijzingen lezen |
| `RoleEligibilitySchedule.Read.Directory` | Gedelegeerd | Eligible PIM-toewijzingen lezen |
| `RoleManagementPolicy.Read.Directory` | Gedelegeerd | PIM-beleid lezen |
| `Policy.Read.ConditionalAccess` | Gedelegeerd | Authenticatiecontexten lezen |
| `User.Read.All` | Gedelegeerd | Gebruikersweergavenamen ophalen |
| `Group.Read.All` | Gedelegeerd | Groepsweergavenamen ophalen |
| `AdministrativeUnit.Read.All` | Gedelegeerd | Administrative unit namen ophalen |
| `Application.Read.All` | Gedelegeerd | Applicatienamen ophalen |

> [!TIP]
> De applicatie volgt het **least privilege principe** door granulaire machtigingen te gebruiken in plaats van brede machtigingen zoals `Directory.Read.All` of `Policy.Read.All`.

> [!IMPORTANT]
> Alle machtigingen zijn **gedelegeerd**. De app handelt namens de ingelogde gebruiker, met hun machtigingen in Azure AD.

---

## Volgende Stappen

- [Belangrijke Concepten](./05-belangrijke-concepten.md) - Technische concepten uitgelegd
- [Rapportpagina](./06-rapportpagina.md) - Hoe de Rapportpagina werkt
