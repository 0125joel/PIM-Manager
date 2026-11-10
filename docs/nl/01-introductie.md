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
- **Edit**: master-detail lijst van rollen en groepen met instellingen, Who has it en Select several
- **Guided**: een route in stappen voor een wijziging op veel doelen, eventueel vanuit het access model
- **Import**: CSV- of JSON-bestanden vergeleken met de tenant, daarna één review en apply; de pagina **Access model** toont de PIM Monitor-catalogus
- Pas consistente activatie-instellingen toe (MFA, goedkeuring, max. duur) voor meerdere rollen en groepen
- Maak eligible/actieve toewijzingen aan en beheer ze met AU-scope ondersteuning

> [!NOTE]
> Schrijfmachtigingen voor Configure (`RoleManagementPolicy.ReadWrite.Directory` en gerelateerde scopes) worden aangevraagd via incrementele consent, alleen wanneer je in Configure kiest voor Grant permission. Rapportagefuncties vereisen deze machtigingen niet.

---

## Je weg vinden: de tours

Niemand leest eerst een handleiding voordat hij gaat klikken, dus PIM Manager legt zichzelf uit terwijl je rondkijkt. De eerste keer dat je een onderdeel opent, start een korte tour. Eerst één door de app zelf: de wissel tussen Entra ID en Azure, de drie pagina's, Refresh, Help, Settings en je account. Daarna één voor de pagina waar je bent. Op Azure begint hij bij de scope, want elk getal op Azure gaat over de scope die je kiest.

- Elk onderdeel krijgt de eerste keer zijn eigen tour: het Dashboard in Basic en in Advanced, de Report, Configure en elk van zijn modi, en hetzelfde op Azure.
- Een tour is een handvol stappen: wat je ziet, wat het betekent en wat je ermee kunt. De laatste stap zegt waar je daarna kijkt.
- **Skip tour** sluit die tour. **Turn off tours** zorgt dat geen enkele tour nog vanzelf start; zet ze terug aan onder **Settings > Display > Tours**.
- **Start the tour** in Help, in het paneel en in de volledige gids, laat je kiezen: per product en per pagina, of **All of Entra** en **All of Azure** in één keer.
- In de live demo vraagt PIM Manager eerst **Do you want to start the tour?**. **Start the tour** toont de tour van de app en van die pagina; elke andere pagina toont zijn eigen tour als je hem voor het eerst opent; **No thanks** slaat de tour van die pagina over, en de volgende onderdelen tonen nog steeds hun eigen tour.
- Wat de tours onthouden, welke je zag en of ze aan staan, blijft in deze browser. Geen tenantdata.

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
| `PrivilegedAccess-CustomExt.Read.All` | Lijst van PIM custom extensions (Preview) | Keuzelijst en controle op verweesde koppelingen verborgen; welke extension een beleid koppelt blijft zichtbaar |
| `Policy.Read.All` | Conditional Access-check van Configureren (op verzoek) | De check toont "Not checked"; de rest van de review loopt door |
| `user_impersonation` (Azure Resource Manager) | De Azure-omgeving: Azure-dashboard en Azure-rapport (PIM voor Azure-resources), gevraagd met een consentpopup wanneer je Azure aanzet | Elke Azure-pagina toont het consentscherm |

**Optionele schrijfmachtigingen** (via incrementele consent, alleen wanneer je in Configure kiest voor Grant permission):

| Machtiging | Doel |
|------------|------|
| `RoleManagementPolicy.ReadWrite.Directory` | Update PIM-beleid voor Directory Rollen |
| `RoleEligibilitySchedule.ReadWrite.Directory` | Maak eligible toewijzingen voor Directory Rollen |
| `RoleAssignmentSchedule.ReadWrite.Directory` | Maak actieve toewijzingen voor Directory Rollen |
| `RoleManagementPolicy.ReadWrite.AzureADGroup` | Update PIM-beleid voor PIM Groepen |
| `PrivilegedEligibilitySchedule.ReadWrite.AzureADGroup` | Maak eligible toewijzingen voor PIM Groepen |
| `PrivilegedAssignmentSchedule.ReadWrite.AzureADGroup` | Maak actieve toewijzingen voor PIM Groepen |

> [!TIP]
> De applicatie volgt het **least privilege principe**. Rapportagefuncties gebruiken alleen leesmachtigingen. Schrijfmachtigingen worden alleen aangevraagd wanneer je in Configure kiest voor Grant permission, en alleen voor de workload die je wilt configureren.

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
│  └── Configuratie Pagina (Edit/Guided/Import/Model)    │
├─────────────────────────────────────────────────────────┤
│  State Management Laag                                  │
│  ├── UnifiedPimContext (Workload Orkestratie)           │
│  ├── AzureContext (Azure-resources)                     │
│  └── ViewModeContext (UI Voorkeuren)                    │
├─────────────────────────────────────────────────────────┤
│  Data Services                                          │
│  ├── directoryRoleService (Rollen & Policies)           │
│  ├── pimGroupService (PIM Groepen)                      │
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

**Slimme Verversing:**
- Directory Roles: leest de toewijzingen opnieuw zonder de pagina te blokkeren, daarna elke policy op de achtergrond
- PIM for Groups: leest per onboarded groep de schedule-instances en policies opnieuw en behoudt de groepsdetails
- Graph heeft geen delta voor PIM-toewijzingen of policies, dus een in Entra gewijzigde instelling is na één Refresh zichtbaar omdat beide opnieuw worden gelezen

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
