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

### ⚙️ Configuratiepagina (Binnenkort)
- Selecteer meerdere rollen om tegelijk te configureren
- Pas consistente activatie-instellingen toe (MFA, goedkeuring, max. duur)
- Maak nieuwe roltoewijzingen aan (eligible of actief)

> [!NOTE]
> De Configuratiepagina is momenteel in actieve ontwikkeling en is nog niet beschikbaar voor algemeen gebruik. De focus ligt nu op **inzicht en rapportage**.

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
| `PrivilegedAccess.Read.AzureADGroup` | Lees PIM voor Groepen toewijzingen |
| `Policy.Read.ConditionalAccess` | Lees authenticatiecontexten |
| `User.Read.All` | Lees gebruikersweergavenamen |
| `Group.Read.All` | Lees groepsweergavenamen |
| `AdministrativeUnit.Read.All` | Lees administrative unit namen |
| `Application.Read.All` | Lees applicatienamen |

> [!TIP]
> De applicatie volgt het **least privilege principe** door uitsluitend **Read** machtigingen te gebruiken. Er zijn **geen schrijfrechten** nodig voor de rapportagefuncties.

### Ondersteunde Browsers

Elke moderne browser (Chrome, Edge, Firefox, Safari) met JavaScript ingeschakeld.

---

## Architectuuroverzicht

```
┌─────────────────────────────────────────────────────────┐
│                    Browser van Gebruiker                │
├─────────────────────────────────────────────────────────┤
│  Next.js React Applicatie                               │
│  ├── Dashboard Pagina                                   │
│  ├── Rapport Pagina                                     │
│  └── Configuratie Pagina                                │
├─────────────────────────────────────────────────────────┤
│  PimDataContext (Gedeelde State)                        │
│  └── roleDataService (Data Ophalen)                     │
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

---

## Volgende Stappen

- [Mappenstructuur](./02-mappenstructuur.md) - Begrijp hoe de code is georganiseerd
- [Dataflow](./03-dataflow.md) - Leer hoe data wordt opgehaald en verwerkt
