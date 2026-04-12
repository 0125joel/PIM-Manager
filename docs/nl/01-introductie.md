# Introductie

## Wat is PIM Manager?

PIM Manager is een webapplicatie waarmee Microsoft 365 beheerders **Privileged Identity Management (PIM)** instellingen kunnen **bekijken en analyseren** voor Microsoft Entra ID rollen en groepen.

### Het Probleem dat het Oplost

Het beheren van PIM-instellingen in een grote organisatie is uitdagend:

| Uitdaging | Hoe PIM Manager Helpt |
|-----------|---------------------------|
| Geen bulk-overzicht van alle rolconfiguraties | Toont alle rollen, groepen en hun PIM-instellingen in één dashboard |
| Door elke rol klikken kost uren | Genereert een uitgebreid rapport in ~30 seconden |
| Geen makkelijke manier om configuraties te vergelijken | Zij-aan-zij vergelijking van rolinstellingen |
| Lastig om PIM Groep instellingen te zien | Volledige ondersteuning voor PIM voor Groepen |

---

## Doelgebruikers

Deze applicatie is ontworpen voor:

- **Global Administrators** die PIM-beleid beheren
- **Security Teams** die rolconfiguraties auditen
- **M365 Engineers** die governance-standaarden implementeren

---

## Belangrijkste Functies

### 📈 Dashboard Pagina (Nieuw!)
- **Weergavemodi:** Schakel tussen **Basis** (globaal overzicht) en **Geavanceerd** (gedetailleerde statistieken)
- **Roloverzicht:** Doorzoekbare lijst met rollen en directe navigatie naar de rapportpagina
- **Beveiligingswaarschuwingen:** Alleen-lezen overzicht van PIM-aanbevelingen (bijv. mogelijk verouderde accounts)
- **Overview Cards:** Snel inzicht in totaal aantal rollen, actieve sessies en configuratiegezondheid
- **Security Charts:** Visuele weergave van privilégié vs. niet-privilégié rollen en toewijzingstypes
- **Actie-inzichten:** "Approvers Overview" en "Configuration Errors" widgets (Geavanceerde modus)
- **Pro Tips:** Dynamische suggesties om je beveiliging te verbeteren

### 📊 Rapportpagina (Hoofdfunctie)
- **Multi-Workload:** Bekijk zowel Directory Rollen als PIM Groepen in één geünificeerde interface
- Bekijk alle Microsoft Entra ID rollen met hun PIM-configuraties
- Filter op roltype, toewijzingstype, lidtype, scope en gebruiker
- Exporteer naar PDF (Executive Report) of CSV
- Zie wie is toegewezen aan elke rol (eligible, actief, permanent)
- Bekijk scope-informatie (Tenant-breed, App-scoped, RMAU)
- Authentication Context weergave voor rollen die specifieke toegang vereisen

### ⚙️ Configuratiepagina
- **Wizard Modus**: Begeleide stapsgewijze configuratie — workload, scope, beleid, toewijzingen, beoordeling en toepassen
- **Handmatige Modus**: Vrije 3-kolomsindeling met gestaagde wijzigingen — selecteer rollen/groepen, configureer en wacht op toepassing
- **Bulk Modus**: CSV-gebaseerde batchconfiguratie — upload een CSV, vergelijk met live-instellingen en pas toe op schaal
- Pas consistente activatie-instellingen toe (MFA, goedkeuring, max. duur) voor meerdere rollen en groepen
- Maak eligible/actieve toewijzingen aan en beheer ze met AU-scope ondersteuning

> [!NOTE]
> Schrijfmachtigingen voor Configure (`RoleManagementPolicy.ReadWrite.Directory` en gerelateerde scopes) worden aangevraagd via incrementele consent — alleen wanneer je de Configuratiepagina voor het eerst opent. Rapportagefuncties vereisen deze machtigingen niet.

---

## Vereisten

### Microsoft Entra App-registratie

De applicatie vereist een Microsoft Entra app-registratie met de volgende **gedelegeerde machtigingen**:

| Machtiging | Doel |
|------------|------|
| `User.Read` | Lees ingelogde gebruikersinformatie |
| `RoleManagement.Read.Directory` | Lees roldefinities en toewijzingen |
| `RoleAssignmentSchedule.Read.Directory` | Lees PIM actieve toewijzingen |
| `RoleEligibilitySchedule.Read.Directory` | Lees PIM eligible toewijzingen |
| `RoleManagementPolicy.Read.Directory` | Lees PIM-beleid |
| `Policy.Read.ConditionalAccess` | Lees authenticatiecontexten |
| `User.Read.All` | Lees gebruikersweergavenamen |
| `Group.Read.All` | Lees groepsweergavenamen |
| `AdministrativeUnit.Read.All` | Lees administrative unit namen |
| `Application.Read.All` | Lees applicatienamen |

**Optionele leesmachtigingen** (functies worden graceful uitgeschakeld als niet verleend):

| Machtiging | Functie | Fallback Gedrag |
|------------|---------|-----------------|
| `RoleManagementAlert.Read.Directory` | Beveiligingswaarschuwingen paneel | Paneel verborgen bij 403 |
| `PrivilegedAccess.Read.AzureADGroup` | PIM voor Groepen workload | Workload niet getoond in instellingen |
| `RoleManagementPolicy.Read.AzureADGroup` | PIM Groepen policies | Groepsdata onvolledig zonder dit |

**Optionele schrijfmachtigingen** (via incrementele consent, alleen bij gebruik van Configureren):

| Machtiging | Doel |
|------------|------|
| `RoleManagementPolicy.ReadWrite.Directory` | Update PIM-beleid voor Directory Rollen |
| `RoleEligibilitySchedule.ReadWrite.Directory` | Maak eligible toewijzingen voor Directory Rollen |
| `RoleAssignmentSchedule.ReadWrite.Directory` | Maak actieve toewijzingen voor Directory Rollen |
| `RoleManagementPolicy.ReadWrite.AzureADGroup` | Update PIM-beleid voor PIM Groepen |
| `PrivilegedEligibilitySchedule.ReadWrite.AzureADGroup` | Maak eligible toewijzingen voor PIM Groepen |
| `PrivilegedAssignmentSchedule.ReadWrite.AzureADGroup` | Maak actieve toewijzingen voor PIM Groepen |

> [!TIP]
> De applicatie volgt het **least privilege principe**. Rapportagefuncties gebruiken alleen leesmachtigingen. Schrijfmachtigingen worden alleen aangevraagd wanneer je de Configuratiefunctie gebruikt — en alleen voor de workload die je wilt configureren.

### Ondersteunde Browsers

Elke moderne browser (Chrome, Edge, Firefox, Safari) met JavaScript ingeschakeld.

---

## Architectuuroverzicht

```
┌─────────────────────────────────────────────────────────┐
│                    Browser van Gebruiker                │
├─────────────────────────────────────────────────────────┤
│  Next.js React Applicatie                               │
│  ├── Dashboard Pagina (Analyses & Inzichten)            │
│  ├── Rapport Pagina (Gedetailleerde Configuratieweergave)│
│  └── Configuratie Pagina (Wizard / Handmatig / Bulk)    │
├─────────────────────────────────────────────────────────┤
│  State Management Laag                                  │
│  ├── UnifiedPimContext (Workload Orkestratie)           │
│  ├── DirectoryRoleContext (Directory Rollen)            │
│  ├── ViewModeContext (UI Voorkeuren)                    │
│  └── Delta Sync Service (Slimme Verversing)             │
├─────────────────────────────────────────────────────────┤
│  Data Services                                          │
│  ├── directoryRoleService (Rollen & Policies)           │
│  ├── pimGroupService (PIM Groepen)                      │
│  ├── deltaService (Incrementele Updates)                │
│  └── SessionStorage (60-minuten cache)                  │
├─────────────────────────────────────────────────────────┤
│  Microsoft Authentication Library (MSAL)                │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
            ┌─────────────────────────┐
            │   Microsoft Graph API   │
            │   (Microsoft Entra ID / PIM)      │
            └─────────────────────────┘
```

Alle data wordt **client-side** opgehaald in de browser van de gebruiker. De applicatie:
1. Authenticeert de gebruiker via Microsoft Entra ID
2. Verkrijgt een access token met de vereiste machtigingen
3. Maakt directe calls naar Microsoft Graph API
4. Verwerkt en toont de data

> [!NOTE]
> Er is geen backend server. Alle gevoelige operaties gebruiken de machtigingen van de gebruiker zelf.

### Prestaties & Geavanceerde Functies

**Slimme Verversing (Delta Sync):**
- Haalt alleen wijzigingen op sinds de laatste synchronisatie, waar ondersteund
- Vermindert datatransfer met 70-80% ten opzichte van volledige verversing
- Automatische terugval naar volledige fetch als delta-token vervalt

**SessionStorage Caching:**
- Data blijft behouden bij paginanavigatie
- 60-minuten versheidscontrole voor herverversing
- Vermindert onnodige API-calls

**Workload Beheer:**
- Schakel specifieke workloads in/uit (Directory Rollen, PIM Groepen)
- Op machtigingen gebaseerde functiezichtbaarheid
- Synchronisatiestatus per workload

**Graceful Degradation:**
- Optionele functies (Beveiligingswaarschuwingen, PIM Groepen) verbergen bij ontbrekende machtigingen
- Geen fatale fouten bij ontbrekende optionele machtigingen
- Duidelijke indicatoren wanneer functies niet beschikbaar zijn

---

## Volgende Stappen

- [Mappenstructuur](./02-mappenstructuur.md) - Begrijp hoe de code is georganiseerd
- [Dataflow](./03-dataflow.md) - Leer hoe data wordt opgehaald en verwerkt
