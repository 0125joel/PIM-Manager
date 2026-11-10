# Microsoft Graph API Calls

Dit document beschrijft alle Microsoft Graph API endpoints die PIM Manager gebruikt. Dit helpt bij troubleshooting, permission scoping en security reviews.

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

### Custom Extensions (Optioneel, Preview)

| Endpoint | Doel | Vereiste Machtigingen |
|----------|------|----------------------|
| privilegedAccess/customExtensions | De PIM custom extensions van de tenant ophalen (keuzelijst, controle op verweesde koppelingen) | PrivilegedAccess-CustomExt.Read.All |
| roleManagementPolicyAssignments (rules) | Welke extension een beleid koppelt; komt mee met de gewone beleidslezing | RoleManagementPolicy.Read.Directory / .AzureADGroup |

### Configureren (lezen)

| Endpoint | Doel | Vereiste Machtigingen |
|----------|------|----------------------|
| roleAssignmentScheduleInstances / roleEligibilityScheduleInstances `filterByCurrentUser(on='principal')` | De toegangscheck: de actieve en eligible rollen van de beheerder | RoleAssignmentSchedule.Read.Directory, RoleEligibilitySchedule.Read.Directory |
| privilegedAccess/group/{assignment,eligibility}ScheduleInstances `filterByCurrentUser(on='principal')` | De toegangscheck: PIM-lidmaatschappen en -eigenaarschappen van de beheerder | PrivilegedAccess.Read.AzureADGroup |
| me/ownedObjects/microsoft.graph.group | De toegangscheck: groepen waarvan de beheerder eigenaar is | User.Read |
| directory/administrativeUnits/{id}/members/microsoft.graph.group, groups/{id} | De toegangscheck: groepen in een eenheid of in de scope van een rol (`membershipRule`, `onPremisesSyncEnabled`) | AdministrativeUnit.Read.All, Group.Read.All |
| roleEligibilityScheduleRequests / roleAssignmentScheduleRequests (rollen en groepen) met `isValidationOnly` | De proefrun van nieuwe toewijzingen in de review; er wordt niets geschreven | De schrijfscopes van de workload |
| identity/conditionalAccess/policies | De optionele Conditional Access-check van de review | Policy.Read.All (op verzoek) en een rol die Conditional Access mag lezen |
| users, groups (`$search`, `startswith` als terugval) | Personen zoeken in Add people en de goedkeurderskeuze | User.Read.All, Group.Read.All |
| directory/administrativeUnits, applications (`$search`) | De scopes van een nieuwe roltoewijzing | AdministrativeUnit.Read.All, Application.Read.All |
| users, groups, servicePrincipals (`id in (...)`, `userPrincipalName in (...)`) | Import: de personen uit een bestand die de geladen toewijzingen niet noemen | User.Read.All, Group.Read.All, Application.Read.All |
| servicePrincipals (`id in (...)`, `$select=id,servicePrincipalType`) | Azure-dashboard en Azure Report: apps en managed identities onderscheiden onder de service principals met een Azure-rol, 15 id's per request | Application.Read.All |
| users, groups (`id in (...)`, `$select=id`) | Azure-dashboard en Azure Report: principals vinden die een Azure-rol hebben maar niet meer bestaan, 15 id's per request | User.Read.All, Group.Read.All |

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
- `templateId` - Template voor ingebouwde rollen

**Voorbeeld Response**:
```json
{
  "value": [
    {
      "id": "62e90394-69f5-4237-9190-012177145e10",
      "displayName": "Global Administrator",
      "isBuiltIn": true,
      "isPrivileged": true
    }
  ]
}
```

> [!NOTE]
> De `isPrivileged` property is alleen beschikbaar in de **beta** API. Als het faalt, valt de app terug op `v1.0` zonder dit veld.

---

### 2. Roltoewijzingen (Permanent)

```http
GET /roleManagement/directory/roleAssignments?$expand=principal
```

**API Versie**: `v1.0`

**Expand**: `principal` - Bevat gebruiker/groep details inline

**Doel**: Toont wie een **permanente** (niet-PIM) roltoewijzing heeft.

> [!WARNING]
> Permanente toewijzingen omzeilen PIM volledig. Deze gebruikers hoeven hun rol niet te activeren.

---

### 3. Role Eligibility Schedules

```http
GET /roleManagement/directory/roleEligibilitySchedules?$expand=principal
```

**API Versie**: `v1.0`

**Doel**: Toont wie **eligible** is voor een rol via PIM.

**Belangrijke Velden**:
- `principalId` - Gebruiker- of groeps-ID
- `roleDefinitionId` - Welke rol
- `directoryScopeId` - Waar de rol geldt
- `scheduleInfo` - Begin- en einddatum
- `status` - Status van de schedule

---

### 4. Role Assignment Schedules

```http
GET /roleManagement/directory/roleAssignmentSchedules?$expand=principal
```

**API Versie**: `v1.0`

**Doel**: Toont **actieve** PIM-toewijzingen, zowel toegewezen als geactiveerd (`assignmentType`). De principal wordt meegeladen, zodat een app of groep die alleen een actieve toewijzing heeft herkend wordt aan type en naam.

---

### 5. Role Assignment Schedule Instances

```http
GET /roleManagement/directory/roleAssignmentScheduleInstances
```

**API Versie**: `v1.0`

**Doel**: `memberType` `Group` markeert een activatie die via een groep kwam. Deze read markeert alleen activaties: faalt hij, dan gaat het laden door en wordt geen activatie gemarkeerd.

> [!NOTE]
> Calls 2 tot en met 5 lopen tegelijk zodra de roldefinities binnen zijn (`directoryRoleService.ts`).

---

## Fase 2: Policy Laden

### Role Management Policy Assignments

```http
GET /policies/roleManagementPolicyAssignments?$filter=scopeId eq '/' and scopeType eq 'DirectoryRole' and roleDefinitionId eq '{roleId}'&$expand=policy($expand=rules)
```

**API Versie**: `v1.0`

**Doel**: Verkrijg PIM-configuratie voor een specifieke rol.

**Response Structuur**:
```json
{
  "value": [
    {
      "id": "DirectoryRole_{roleId}_...",
      "policyId": "DirectoryRole_{roleId}",
      "policy": {
        "rules": [
          {
            "@odata.type": "#microsoft.graph.unifiedRoleManagementPolicyExpirationRule",
            "id": "Expiration_EndUser_Assignment",
            "maximumDuration": "PT8H"
          },
          {
            "@odata.type": "#microsoft.graph.unifiedRoleManagementPolicyAuthenticationContextRule",
            "isEnabled": true,
            "claimValue": "c1"
          }
        ]
      }
    }
  ]
}
```

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

## Rate Limiting & Throttling

Microsoft Graph handhaaft rate limits om servicestabiliteit te beschermen.

### Smart Refresh Strategie
Om prestaties te verbeteren, implementeert de app een **Smart Refresh** logica:
1.  **Directory Roles**: Graph heeft geen delta voor PIM-toewijzingen of policies (`/directoryRoles/delta` meldt alleen geactiveerde rolobjecten), dus Refresh leest de definities en assignment schedules opnieuw zonder de pagina te blokkeren en daarna elke policy op de achtergrond (één gepagineerde call voor de tenant). Namen van approvers blijven staan bij policies waarvan de approvers niet veranderd zijn.
2.  **PIM for Groups**: Geen delta. Graph's `/groups/delta` filtert alleen op `id` en rapporteert nooit PIM-eligibility- of policywijzigingen, dus de app leest de PIM-inventaris (`/identityGovernance/privilegedAccess/group/resources` plus de role-assignable groepen) en daarna per onboarded groep de eligibility- en assignment-schedule-instances en de policies (3 workers, 500 ms). Groepsdetails blijven zoals geladen.
3.  **Parallelle Uitvoering**: Beide workloads verversen tegelijkertijd.

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
| **Rate limiting** | 8 gelijktijdige workers, 300ms vertraging (standaard); policy-ophaling gebruikt 12 workers, 200ms vertraging |
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

## Custom Extensions API Calls (Preview)

Met PIM Custom Extensions roept een rol- of groepsactivatie een externe REST API aan (meestal een Logic App achter API Management) die antwoordt met `Approved`, `AutoApproved` of `Denied`. PIM Manager leest welke extension een policy koppelt, koppelt er een vanuit Configureren en haalt de extensions van de tenant op voor de keuzelijst. Het endpoint bouwen gebeurt buiten de app.

### Gekoppelde extension op een policy (geen extra machtiging)

Beide slots komen mee met de bestaande policy-read (`roleManagementPolicyAssignments?$expand=policy($expand=rules)`, Directory Roles op v1.0, PIM for Groups op beta). Het zijn twee regels in dezelfde `rules`-array, aanwezig op elke policy zodra de preview in de tenant is uitgerold:

```json
{
  "@odata.type": "#microsoft.graph.unifiedRoleManagementPolicyCustomExtensionRule",
  "id": "CustomExtension_PreApproval_EndUser_Assignment",
  "isEnabled": true,
  "customExtensionId": "a05c9349-5950-4884-bab4-7fb6aa3e4ff5",
  "displayName": "Outside office hours",
  "customAttributes": ["ticketNumber"],
  "target": { "caller": "EndUser", "operations": ["All"], "level": "Assignment", "inheritableSettings": [], "enforcedSettings": [] }
}
```

`CustomExtension_PostApproval_EndUser_Assignment` heeft dezelfde vorm. Graph zet `displayName` er zelf bij, dus Rapport en Dashboard hebben geen extra call nodig. Tenants zonder de preview hebben deze regels niet en dan tonen de custom extension-onderdelen niets.

### Custom extensions ophalen

```http
GET /identityGovernance/privilegedAccess/customExtensions
```

**API Versie**: `beta`

**Machtiging**: `PrivilegedAccess-CustomExt.Read.All` (gedelegeerd, incrementele consent; eerst stil geprobeerd, de popup opent pas als de gebruiker om de lijst vraagt)

**Doel**: de keuzelijst in Configureren, naam naar id vertalen voor Import-bestanden, en verweesde koppelingen vinden (een gekoppelde `customExtensionId` die niet meer bestaat).

**Graceful Degradation**: een 403 (geen consent, of geen licentie voor Microsoft Entra ID Governance of Entra Suite) wordt `PERMISSION_DENIED`; de onderdelen die de lijst nodig hebben verdwijnen en de rest van de app blijft gelijk.

### Een extension koppelen of ontkoppelen

```http
PATCH /policies/roleManagementPolicies/{policyId}/rules/CustomExtension_PreApproval_EndUser_Assignment
```

Body: `@odata.type`, `id`, `isEnabled`, `customExtensionId`, `customAttributes` en een `target` met een eigen `"@odata.type": "microsoft.graph.unifiedRoleManagementPolicyRuleTarget"` en `operations: ["All"]` (de vorm van `createRuleTarget()`). Stuur nooit `displayName` mee. Ontkoppelen stuurt `customExtensionId: ""` met `isEnabled: false`. Live bevestigd op v1.0 en beta voor Directory Roles; PIM for Groups gebruikt dezelfde rule-ids. Een `target` overgenomen uit een GET-response (zonder discriminator, `all` in kleine letters) faalt met `MissingProvider`.

**Machtiging**: `RoleManagementPolicy.ReadWrite.Directory` of `RoleManagementPolicy.ReadWrite.AzureADGroup`, de bestaande schrijfmachtigingen van Configureren; koppelen vraagt geen custom extension-scope.

---

## Machtigingen Samenvatting

### Configure Schrijfmachtigingen

| Machtiging | Scope | Gebruikt Voor |
|------------|-------|---------------|
| `RoleManagementPolicy.ReadWrite.Directory` | Gedelegeerd | PIM-beleidsregels updaten voor Directory Roles |
| `RoleEligibilitySchedule.ReadWrite.Directory` | Gedelegeerd | Eligible toewijzingen aanmaken voor Directory Roles |
| `RoleAssignmentSchedule.ReadWrite.Directory` | Gedelegeerd | Actieve toewijzingen aanmaken voor Directory Roles |
| `RoleManagementPolicy.ReadWrite.AzureADGroup` | Gedelegeerd | PIM-beleidsregels updaten voor PIM for Groups |
| `PrivilegedEligibilitySchedule.ReadWrite.AzureADGroup` | Gedelegeerd | Eligible toewijzingen aanmaken voor PIM for Groups |
| `PrivilegedAssignmentSchedule.ReadWrite.AzureADGroup` | Gedelegeerd | Actieve toewijzingen aanmaken voor PIM for Groups |

> [!NOTE]
> Schrijfmachtigingen worden via incrementele consent aangevraagd, alleen wanneer de gebruiker de Configuratiepagina opent. Ze zijn niet inbegrepen in het initiële inlogverzoek.

### Configure Schrijf-API Endpoints

| Operatie | Endpoint | Methode | Machtiging |
|----------|----------|---------|------------|
| Beleidsregel updaten | `/policies/roleManagementPolicies/{policyId}/rules/{ruleId}` | PATCH | RoleManagementPolicy.ReadWrite.Directory |
| Eligible roltoewijzing aanmaken | `/roleManagement/directory/roleEligibilityScheduleRequests` | POST | RoleEligibilitySchedule.ReadWrite.Directory |
| Actieve roltoewijzing aanmaken | `/roleManagement/directory/roleAssignmentScheduleRequests` | POST | RoleAssignmentSchedule.ReadWrite.Directory |
| Groepstoewijzing aanmaken | `/identityGovernance/privilegedAccess/group/assignmentScheduleRequests` | POST | PrivilegedAssignmentSchedule.ReadWrite.AzureADGroup |
| Groepsbeleidsregel updaten | `/policies/roleManagementPolicies/{policyId}/rules/{ruleId}` | PATCH | RoleManagementPolicy.ReadWrite.AzureADGroup |
| Een custom extension koppelen of ontkoppelen | `/policies/roleManagementPolicies/{policyId}/rules/CustomExtension_{PreApproval,PostApproval}_EndUser_Assignment` | PATCH | RoleManagementPolicy.ReadWrite.Directory of .AzureADGroup |

---

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

### Optionele Machtigingen (PIM for Groups, Security Alerts, Custom Extensions, Conditional Access)

| Machtiging | Scope | Gebruikt Voor |
|------------|-------|---------------|
| `PrivilegedAccess.Read.AzureADGroup` | Gedelegeerd | PIM for Groups toewijzingen en resources lezen |
| `RoleManagementPolicy.Read.AzureADGroup` | Gedelegeerd | PIM-beleid voor groepen lezen (Member/Owner) |
| `RoleManagementAlert.Read.Directory` | Gedelegeerd | Beveiligingswaarschuwingen voor rollen lezen |
| `PrivilegedAccess-CustomExt.Read.All` | Gedelegeerd | De PIM custom extensions van de tenant ophalen (Preview) |
| `Policy.Read.All` | Gedelegeerd | De optionele Conditional Access-check van Configureren, op verzoek gevraagd |

> [!TIP]
> De applicatie volgt het **least privilege principe** door granulaire machtigingen te gebruiken in plaats van brede machtigingen zoals `Directory.Read.All`. `Policy.Read.All` wordt alleen gevraagd wanneer je de optionele Conditional Access-check in Configureren start. Admin consent kun je geven in het Microsoft Entra admin center.

> [!IMPORTANT]
> Alle machtigingen zijn **gedelegeerd**. De app handelt namens de ingelogde gebruiker, met hun machtigingen in Microsoft Entra ID.

---

## Volgende Stappen

- [Belangrijke Concepten](./06-belangrijke-concepten.md) - Technische concepten uitgelegd
- [Rapportpagina](./08-rapport-pagina.md) - Hoe de Rapportpagina werkt
