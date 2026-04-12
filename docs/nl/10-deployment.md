# Implementatie

PIM Manager is een client-side SPA (Next.js static export) die op elk statisch hostingplatform kan worden gehost. Dit document beschrijft de twee ondersteunde opties.

---

## Optie A: Gehoste versie (pimmanager.com)

Geen installatie vereist. Ga naar [pimmanager.com](https://pimmanager.com) en log in met je Microsoft Entra ID account.

Je hebt een App-registratie in je tenant nodig — zie [App-registratie](#app-registratie) hieronder.

---

## Optie B: Zelf hosten op Azure Static Web Apps

Zelf hosten draait PIM Manager volledig binnen je eigen Azure-tenant. Niets verlaat je omgeving.

### Voor wie is dit bedoeld?

Deze optie veronderstelt dat je vertrouwd bent met:
- Aanmaken en configureren van resources in Azure Portal
- Microsoft Entra ID App-registraties en API-machtigingen
- Begrip van wat een redirect URI is en waarom het belangrijk is

Ben je niet vertrouwd met deze concepten? Gebruik dan de gehoste versie.

### Wat wordt er geïmplementeerd?

Het ARM-sjabloon maakt de volgende resources aan in je gekozen Resource Group:

| Resource | Doel | Kosten |
|----------|------|--------|
| Azure Static Web App (Free tier) | Host de applicatie | Gratis |
| User-assigned Managed Identity | Vereist door het deployment script | Gratis |
| Storage Account (Standard LRS) | Tijdelijke status voor het deployment script | ~€0,01/maand |
| Deployment Script | Downloadt de nieuwste release en implementeert deze — verwijderd na 24 uur | Gratis |

De Managed Identity en het Storage Account zijn technische hulpbronnen voor het eenmalige implementatieproces. Ze hebben geen relatie met hoe de draaiende applicatie gebruikers authenticeert — dat wordt volledig afgehandeld door je App-registratie.

### Authenticatie: waarom geen secrets nodig zijn

PIM Manager gebruikt **Authorization Code Flow met PKCE** — de juiste flow voor browser-gebaseerde SPA's. Deze flow vereist alleen een Client ID, dat opzettelijk openbaar is. Er is geen client secret, geen certificaat en niets te roteren. Beveiliging wordt afgedwongen door de redirect URI-whitelist in je App-registratie en door PKCE zelf.

De Managed Identity in het ARM-sjabloon is een afzonderlijk onderdeel: het bestaat alleen om de deployment container te authenticeren bij Azure tijdens de initiële setup. Zodra de app draait, is de Managed Identity niet meer in gebruik.

### Vereisten

Voordat je op Implementeren klikt, heb je nodig:

1. Een **Azure-abonnement** met toestemming om resources in een Resource Group aan te maken
2. Een **App-registratie** in je Entra ID-tenant — zie [App-registratie](#app-registratie) hieronder

> Maak eerst de App-registratie aan, maar laat de Redirect URI voorlopig leeg. Je voegt deze toe na de implementatie zodra je de URL van de Static Web App weet.

### Implementeren

[![Implementeren op Azure](https://aka.ms/deploytoazurebutton)](https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2F0125joel%2FPIM-manager%2Fmain%2Fazuredeploy.json)

Het implementatieformulier vraagt om:

| Parameter | Beschrijving |
|-----------|--------------|
| **Subscription** | Je Azure-abonnement |
| **Resource Group** | Selecteer bestaande of maak nieuwe aan |
| **Static Web App Name** | Resourcenaam in Azure (bijv. `pim-manager`) |
| **Location** | Azure-regio — West Europe aanbevolen |
| **Entra Client ID** | Client ID van je App-registratie |

De implementatie duurt ongeveer 3–5 minuten. Na voltooiing toont de output je Static Web App URL.

### Na implementatie: redirect URI toevoegen

Voeg na de implementatie je Static Web App URL toe als Redirect URI in je App-registratie:

1. Ga naar **Entra ID > App registrations > [Jouw App] > Authentication**
2. Voeg onder **Single-page application** je SWA URL toe (bijv. `https://jouw-app.azurestaticapps.net`)
3. Sla op

> [!IMPORTANT]
> De redirect URI moet worden geregistreerd onder **Single-page application**, niet onder "Web". Het gebruik van het type "Web" zorgt ervoor dat MSAL-verificatie mislukt met een CORS-gerelateerde fout.

De app werkt pas nadat deze stap is voltooid.

---

## App-registratie

Alle implementatieopties vereisen een App-registratie in je Microsoft Entra ID-tenant.

### App-registratie aanmaken

1. Ga naar **Entra ID > App registrations > New registration**
2. Naam: iets herkenbaars (bijv. `PIM Manager`)
3. Ondersteunde accounttypen: **Accounts in this organizational directory only**
4. Redirect URI: laat voorlopig leeg — voeg toe na implementatie
5. Registreren

### Vereiste API-machtigingen

Verleen de volgende **Gedelegeerde** machtigingen (geen Toepassingsmachtigingen, geen secrets):

| Machtiging | Gebruikt voor |
|------------|--------------|
| `User.Read` | Gebruikersprofiel |
| `RoleManagement.Read.Directory` | Roldefinities |
| `RoleAssignmentSchedule.Read.Directory` | Actieve toewijzingen |
| `RoleEligibilitySchedule.Read.Directory` | Eligible toewijzingen |
| `RoleManagementPolicy.Read.Directory` | PIM-beleid |
| `Policy.Read.ConditionalAccess` | CA-authenticatiecontexten |
| `User.Read.All` | Gebruikersweergavenamen oplossen |
| `Group.Read.All` | Groepsomschrijvingen oplossen |
| `AdministrativeUnit.Read.All` | AU-scoped toewijzingen |
| `Application.Read.All` | App-scoped toewijzingen |

Verleen beheerderstoestemming voor je organisatie na het toevoegen van de machtigingen.

> Aanvullende machtigingen voor PIM-groepen, beveiligingswaarschuwingen en configuratiefuncties worden incrementeel aangevraagd via toestemmingspop-ups wanneer de gebruiker die functies inschakelt. Ze hoeven hier niet vooraf te worden geconfigureerd.
