# Microsoft Graph API Calls

Dit document beschrijft alle Microsoft Graph API endpoints die PIM Configurator gebruikt. Dit helpt bij troubleshooting, permission scoping en security reviews.

---

## API Overzicht

### Directory Roles

| Fase | Endpoint | Doel | Vereiste Machtigingen |
|------|----------|------|----------------------|
| 1 | roleDefinitions | Alle rollen ophalen | RoleManagement.Read.Directory |
| 1 | roleAssignments | Permanente toewijzingen ophalen | RoleManagement.Read.Directory |
| 1 | roleEligibilitySchedules | Eligible toewijzingen ophalen | RoleEligibilitySchedule.Read.Directory |
| 1 | roleAssignmentSchedules | Actieve toewijzingen ophalen | RoleAssignmentSchedule.Read.Directory |
| 2 | roleManagementPolicyAssignments | PIM-beleid ophalen | RoleManagementPolicy.Read.Directory |

### PIM for Groups (Optioneel)

| Endpoint | Doel | Vereiste Machtigingen |
|----------|------|----------------------|
| privilegedAccess/group/resources | PIM-onboarded groepen ophalen | PrivilegedAccess.Read.AzureADGroup |
| groups (role-assignable filter) | Unmanaged groepen detecteren | Group.Read.All |
| group/eligibilityScheduleInstances | Groeps eligible toewijzingen ophalen | PrivilegedAccess.Read.AzureADGroup |
| group/assignmentScheduleInstances | Groeps actieve toewijzingen ophalen | PrivilegedAccess.Read.AzureADGroup |
| roleManagementPolicyAssignments (Groups) | Groeps PIM-beleid ophalen | RoleManagementPolicy.Read.AzureADGroup |

### Security Alerts (Optioneel)

| Endpoint | Doel | Vereiste Machtigingen |
|----------|------|----------------------|
| roleManagementAlerts/alerts | Beveiligingswaarschuwingen ophalen | RoleManagementAlert.Read.Directory |

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

## PIM for Groups API Calls

PIM Manager ondersteunt Microsoft Entra PIM for Groups, waarmee je privileged access kunt beheren via groepslidmaatschap met aparte beleidsregels voor Members en Owners.

### 1. PIM-Onboarded Groepen Ophalen

```http
GET /identityGovernance/privilegedAccess/group/resources
```

**API Versie**: `beta`

**Machtiging**: `PrivilegedAccess.Read.AzureADGroup`

**Doel**: Ontdek welke groepen zijn ingeschreven in PIM (PIM-beleid hebben geconfigureerd).

**Response**: Retourneert groepen met `id`, `displayName`, en resource metadata.

---

### 2. Role-Assignable Groepen Ophalen

```http
GET /groups?$filter=isAssignableToRole eq true
```

**API Versie**: `v1.0`

**Machtiging**: `Group.Read.All`

**Doel**: Haal alle role-assignable groepen op om unmanaged groepen te identificeren (groepen met `isAssignableToRole: true` maar zonder PIM-beleid).

**Use Case**: Security gap detectie - groepen die rollen kunnen toewijzen maar niet beheerd worden door PIM.

---

### 3. Groepsdetails Ophalen

```http
GET /groups/{id}
```

**API Versie**: `v1.0`

**Machtiging**: `Group.Read.All`

**Doel**: Haal groepsmetadata op (weergavenaam, beschrijving) voor groepen gevonden via PIM resources endpoint.

---

### 4. Groeps Eligibility Schedules Ophalen

```http
GET /identityGovernance/privilegedAccess/group/eligibilityScheduleInstances
  ?$filter=groupId eq '{groupId}'
  &$expand=principal,group
```

**API Versie**: `v1.0`

**Machtiging**: `PrivilegedAccess.Read.AzureADGroup`

**Doel**: Haal eligible toewijzingen op voor een specifieke groep (wie kan membership/ownership activeren).

**Belangrijke Velden**:
- `accessId`: `member` of `owner`
- `principal`: Toegewezen gebruiker of groep
- `startDateTime`, `endDateTime`: Toewijzingsgeldigheidsperiode

---

### 5. Groeps Assignment Schedules Ophalen

```http
GET /identityGovernance/privilegedAccess/group/assignmentScheduleInstances
  ?$filter=groupId eq '{groupId}'
  &$expand=principal,group
```

**API Versie**: `v1.0`

**Machtiging**: `PrivilegedAccess.Read.AzureADGroup`

**Doel**: Haal actieve toewijzingen op (permanent toegewezen of momenteel geactiveerd).

---

### 6. Groeps PIM-Beleid Ophalen

```http
GET /policies/roleManagementPolicyAssignments
  ?$filter=scopeId eq '{groupId}' and scopeType eq 'Group'
  &$expand=policy($expand=rules)
```

**API Versie**: `beta`

**Machtiging**: `RoleManagementPolicy.Read.AzureADGroup`

**Doel**: Haal PIM-beleidsconfiguratie op voor een groep. Retourneert **twee** beleidsregels per groep:
- **Member beleid** (`roleDefinitionId` eindigt op `_member`)
- **Owner beleid** (`roleDefinitionId` eindigt op `_owner`)

**Beleidsregels Omvatten**:
- Maximale activeringsduur
- MFA-vereiste bij activering
- Goedkeuringsworkflow
- Justificatie-vereiste
- Authenticatiecontext (Conditional Access integratie)
- Meldingsinstellingen

**Opmerking**: Member en Owner beleidsregels zijn volledig onafhankelijk en kunnen verschillende configuraties hebben.

---

## Security Alerts API Calls

PIM Manager integreert met Microsoft Entra ID Security Alerts om PIM-gerelateerde beveiligingsrisico's zichtbaar te maken.

### Security Alerts Ophalen

```http
GET /identityGovernance/roleManagementAlerts/alerts
  ?$filter=scopeId eq '/' and scopeType eq 'DirectoryRole'
  &$expand=alertDefinition,alertConfiguration
```

**API Versie**: `beta`

**Machtiging**: `RoleManagementAlert.Read.Directory`

**Doel**: Haal actieve beveiligingswaarschuwingen op voor Directory Roles (bijv. te veel global admins, rollen toegewezen buiten PIM, verouderde eligible toewijzingen).

**Belangrijke Velden**:
- `alertDefinition.severityLevel`: `high`, `medium`, `low`, `informational`
- `alertDefinition.description`: Leesbare uitleg
- `incidentCount`: Aantal getroffen items
- `isActive`: Of waarschuwing momenteel actief is

**Graceful Degradation**: Als de machtiging niet is verleend (403 Forbidden), wordt de functie verborgen zonder de app te breken.

**Weergave**: Security alerts verschijnen in het Security Alerts panel van het Dashboard, gesorteerd op ernst.

---

## Machtigingen Samenvatting

### Kern Machtigingen (Directory Roles)

| Machtiging | Scope | Gebruikt Voor |
|------------|-------|---------------|
| `User.Read` | Gedelegeerd | Ingelogde gebruikersinfo ophalen |
| `RoleManagement.Read.Directory` | Gedelegeerd | Roldefinities lezen |
| `RoleAssignmentSchedule.Read.Directory` | Gedelegeerd | Actieve PIM-toewijzingen lezen |
| `RoleEligibilitySchedule.Read.Directory` | Gedelegeerd | Eligible PIM-toewijzingen lezen |
| `RoleManagementPolicy.Read.Directory` | Gedelegeerd | PIM-beleid voor rollen lezen |
| `Policy.Read.ConditionalAccess` | Gedelegeerd | Authenticatiecontexten lezen |
| `User.Read.All` | Gedelegeerd | Gebruikersweergavenamen ophalen |
| `Group.Read.All` | Gedelegeerd | Groepsweergavenamen & role-assignable groepen ophalen |
| `AdministrativeUnit.Read.All` | Gedelegeerd | Administrative unit namen ophalen |
| `Application.Read.All` | Gedelegeerd | Applicatienamen ophalen |

### Optionele Machtigingen (PIM Groups & Security Alerts)

| Machtiging | Scope | Gebruikt Voor |
|------------|-------|---------------|
| `PrivilegedAccess.Read.AzureADGroup` | Gedelegeerd | PIM Groups toewijzingen en resources lezen |
| `RoleManagementPolicy.Read.AzureADGroup` | Gedelegeerd | PIM-beleid voor groepen lezen (Member/Owner) |
| `RoleManagementAlert.Read.Directory` | Gedelegeerd | Beveiligingswaarschuwingen voor rollen lezen |

> [!TIP]
> De applicatie volgt het **least privilege principe** door granulaire machtigingen te gebruiken in plaats van brede machtigingen zoals `Directory.Read.All` of `Policy.Read.All`.

> [!IMPORTANT]
> Alle machtigingen zijn **gedelegeerd**. De app handelt namens de ingelogde gebruiker, met hun machtigingen in Microsoft Entra ID.

---

## Volgende Stappen

- [Belangrijke Concepten](./05-belangrijke-concepten.md) - Technische concepten uitgelegd
- [Rapportpagina](./06-rapportpagina.md) - Hoe de Rapportpagina werkt
