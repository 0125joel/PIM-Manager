# Azure Dashboard Pagina

Het Azure Dashboard (`/azure`) is het Azure-equivalent van de [Dashboard Pagina](./07-dashboard-pagina.md). Het laat zien wie bevoorrechte toegang heeft tot je Azure-resources en onder welke voorwaarden, voor de scopes die je account kan lezen. Het volgt het Entra-dashboard in werkwijze en uiterlijk; alleen de inhoud verschilt.

---

## Overzicht

**Doel:** Inzicht in bevoorrechte toegang op Azure-resources: toewijzingen, rolinstellingen en de eigen PIM-alerts, voor management groups, subscriptions, resource groups en resources.

**Paginakop:** de titel, een Basic- of Advanced-schakelaar, in Advanced een schakelaar Privileged roles of All roles, "synced N min ago", Refresh en Export.

**Scope-balk:** onder het kop, in plaats van de workload-chips (zie hieronder).

**Filter:** een klik op een kaart, legenda-rij of Easy to miss-rij zet precies een filter, bewaard in de URL als `f`. Een balk onder de scope-balk toont het filter als verwijderbare chip, een zin met het aantal en "Open in report with this filter". Escape wist het filter.

**Wat je ziet:** Azure RBAC bepaalt dat, per scope. Het dashboard toont wat je Azure-rollen je laten lezen en noemt nooit een totaal voor de hele tenant. Azure zet je per account aan met een eenmalige toestemming voor `https://management.azure.com/user_impersonation`, gevraagd als je Turn on Azure kiest, niet bij het inloggen.

---

## Scope-balk

De scope-balk bepaalt wat meetelt.

| Onderdeel | Gedrag |
|-----------|--------|
| Pad | "All you can read" als er niets gekozen is, met het aantal management groups en subscriptions; anders het pad naar de gekozen scope. Een klik opent het scope-venster van het Azure Report: je tenant, en de gedelegeerde subscriptions in een eigen boom |
| Include inherited | Schakel-chip, standaard uit. Op een gekozen scope telt het ook wat daarboven is toegewezen. Uitgeschakeld op de bovenste scope: "Nothing above this scope" |
| Delegated subscriptions | Schakel-chip met het aantal en het Lighthouse-label, standaard aan. Uit laat gedelegeerde subscriptions buiten elk getal |
| Zichtbaarheidsregel | "You can read N of M subscriptions in the tenant, and K delegated." "Why not all?" verschijnt alleen als een subscription van je eigen tenant niet leesbaar is |

De scope-boom toont de hiërarchie van management groups als Azure de hiërarchie-aanvraag (`getEntities`) beantwoordt, en blijft anders plat. Onder 640 px is het pad een knop die het scope-venster opent; de twee chips en de zichtbaarheidsregel blijven eronder zichtbaar.

### Show more details

Zonder **Show more details** (naast Basic en Advanced) houdt de scope-balk het pad en Delegated subscriptions; de aantallen, het Lighthouse-label, Include inherited op de bovenste scope en de zichtbaarheidsregel wachten achter het vinkje. Eén zin onder de balk zegt wat je kunt lezen: "You can read 4 of 5 subscriptions completely, and 1 in part." en, als iets buiten bereik is, welk soort (resource groups, de instellingen van een privileged role × scope). **What you can read** opent een lijst per subscription (all, partly, could not be read) en van de rolinstellingen die je niet kunt lezen. Azure geeft de resource groups die je niet kunt lezen niet terug, dus bij een deels leesbare subscription staat alleen dat meetelt wat je wel kunt lezen.

Verderop toont Easy to miss alleen de rijen die niet nul zijn, zonder hun uitleg; From Microsoft, de voetnoten "not counted" en Right now vallen weg, en Most privileged toont de eerste 5 accounts met alleen het label delegated. Elke weergave onthoudt zijn eigen keuze in deze browser; **Details** op More in Settings toont alles.

---

## Weergavemodi

### Basic

Kaarten, daarna in twee kolommen: **Has access** (permanent, eligible, active time-bound) en **On activation** (Entra MFA, authenticatiecontext, neither, met approval, justification en over 8 h), **Easy to miss** (rijen in drie categorieen; apps en managed identities apart, agents, guests en verwijderde accounts) en **From Microsoft** (de eigen PIM-alerts per subscription, alleen lezen), en een **tipbalk** met tips die uit wat je kunt lezen worden berekend.

### Advanced

Dezelfde kop en kaarten, daarna secties over de volle breedte: **Has access, and how** (per niveau van de scope-boom, direct of via een groep), **On activation** (grafieken voor MFA, approval, justification en maximale duur voor privileged of alle rollen), **Most privileged, and who approves** (de accounts met de meeste bevoorrechte toegang, en approvers) en **Right now** (lopende activeringen, eligibility die binnen 7 dagen eindigt). PIM for Groups hoort niet bij het Azure-dashboard.

**Privileged roles of All roles:** Advanced telt standaard privileged rollen. Privileged zijn de vijf rollen die Microsoft als bevoorrechte beheerdersrollen noemt, plus elke rol waarvan de acties toegang kunnen wijzigen (de definitie op Microsoft Learn). De roldefinities worden eenmaal per sessie gelezen. De schakelaar telt in plaats daarvan alle rollen; de kaarten blijven gelijk.

---

## Kaarten

Elk getal noemt zijn eenheid: role × scope, of toewijzingen.

| Kaart | Getal |
|-------|-------|
| Role × scope | Aparte rollen met een toewijzing, eenmaal per scope geteld |
| Active now | Actieve toewijzingen |
| Permanent | Actieve toewijzingen zonder einddatum |
| Eligible | Eligible toewijzingen |
| Privileged roles | Role × scope van privileged rollen |
| Require approval | Privileged role × scope die bij activering goedkeuring vragen |
| Custom roles | Role × scope van custom rollen |
| Inherited | Op de bovenste scope: toewijzingen op een management group. Op een gekozen scope: toewijzingen van hogerop |

Getallen die afhangen van rolinstellingen of roldefinities tonen een skeleton tot die gelezen zijn. Een onbekende waarde wordt nooit als 0 getoond.

---

## Toestanden

- **Laden:** skeletons en een voortgangsregel die subscriptions en rolinstellingen noemt.
- **Filter actief:** de blokken waar het filter niet voor geldt, worden gedimd.
- **Een subscription mislukt:** een banner "1 of N subscriptions could not be loaded." met Refresh. Mislukt het hele laden, dan een vak met de oorzaak en Try again; de getoonde getallen komen van de laatste keer laden.
- **Gethrottled (429):** een melding dat Azure verzoeken beperkt.
- **Niets leesbaar:** de pagina zegt dat en toont de Azure-rollen waarvoor je eligible bent, of dat ze niet gelezen konden worden, in plaats van nullen.
- **Apps en managed identities onbekend:** als Microsoft Graph ze niet kon onderscheiden, tonen beide rijen "-" en staat erbij hoeveel het er samen zijn.
- **Rolinstellingen niet leesbaar:** getallen over instellingen laten die role × scope weg en zeggen dat.

---

## Filtersysteem

Het dashboard gebruikt het filtermodel van het Azure Report. Een klik zet precies een filter, in de URL als `f`; de gekozen scope staat in de parameter `scope`. Elk doel dat het dashboard kan zetten heeft een tegenhanger in het Azure Report, dus "Open in report with this filter" toont dezelfde toewijzingen.

**Wat filtert:** de kaarten (behalve Role × scope), de legenda-rijen van Has access en On activation en de drie cijfers onder On activation, elke Easy to miss-rij, en in Advanced de legenda van Has access, and how, de rijen Direct of via een groep en elke balk van On activation. Een filter op rolinstellingen (approval, MFA, justification, maximale duur, notificatie) vindt alleen toewijzingen waarvan de rolinstellingen gelezen zijn; de filterzin zegt hoeveel dat er niet zijn.

---

## Navigatie naar Rapport

| Component | Link | Gedrag |
|-----------|------|--------|
| Filterbalk | "Open in report with this filter" | Opent `/azure/report` met dezelfde scope en hetzelfde filter |

---

## Databronnen

Alle aanvragen lopen in de browser met je eigen token. Azure Resource Manager (ARM) gebruikt de permissie `user_impersonation`; Azure RBAC op elke scope bepaalt wat antwoord geeft.

| Aanvraag | api-version | Doel |
|----------|-------------|------|
| `GET /subscriptions` | `2022-12-01` | Subscriptions, hun status en tenant (om gedelegeerde te herkennen) |
| `GET /subscriptions/{id}/resourcegroups` en `/resources` | `2021-04-01` | Voor een subscription die je alleen onder het eigen niveau kunt lezen: de resource groups en resources die je wel kunt lezen |
| `POST /providers/Microsoft.Management/getEntities` | `2020-05-01` | De hiërarchie van management groups voor de scope-boom |
| `roleAssignmentScheduleInstances` | `2020-10-01` | Actieve toewijzingen (ook die van jezelf, met `asTarget()`) |
| `roleEligibilitySchedules` | `2020-10-01` | Eligible toewijzingen (de instantielijst laat een custom rol weg die alleen onder de subscription toewijsbaar is) |
| `roleEligibilityScheduleInstances` met `asTarget()` | `2020-10-01` | Je eigen eligible rollen, getoond als je geen enkele scope kunt lezen |
| `roleDefinitions` (built-in en custom, op tenantniveau; per subscription als terugval) | `2022-04-01` | Rolacties, om privileged rollen van andere te onderscheiden. Eenmaal per sessie gelezen, in het geheugen bewaard |
| `roleManagementPolicies` (een rol op een scope) | `2020-10-01` | Rolinstellingen: MFA, approval, justification, duur |
| `roleManagementAlerts` (per subscription) | `2022-08-01-preview` | De eigen PIM-alerts. Preview: er is geen algemeen beschikbare versie |

### Minimale Azure-rol per aanvraag

Toestemming laat de app vragen. Azure RBAC bepaalt per scope of er antwoord komt. Reader is genoeg voor elke aanvraag waarvoor Microsoft een rol noemt; niets hier vraagt Owner. De hiërarchie van management groups is de enige aanvraag waarvoor Microsoft geen rol noemt, en dan zegt de tabel dat ook, in plaats van te gokken.

| Aanvraag | Azure RBAC-actie | Minimale ingebouwde rol | Bron |
|----------|------------------|-------------------------|------|
| `GET /subscriptions` | `Microsoft.Resources/subscriptions/read` | Reader op de subscription of op iets daaronder. Een rol op één resource is genoeg om de subscription te zien; een rol die alleen data geeft (zoals Storage Blob Data Reader) niet | [Resource provider operations](https://learn.microsoft.com/en-us/azure/role-based-access-control/permissions/management-and-governance); gemeten |
| `GET /subscriptions/{id}/resourcegroups` | `Microsoft.Resources/subscriptions/resourceGroups/read` | Reader op de subscription. Met alleen Reader op één resource kwam de lijst leeg terug | Resource provider operations; gemeten |
| `GET /subscriptions/{id}/resources` | `Microsoft.Resources/subscriptions/resources/read` | Reader op de resource: je krijgt de resources die je kunt lezen | Resource provider operations; gemeten |
| `POST /providers/Microsoft.Management/getEntities` | `Microsoft.Management/getEntities/action` | Niet gedocumenteerd. Owner op een subscription met User Access Administrator op de root kreeg de boom; Reader op één subscription kreeg in één test een lege lijst. Zonder deze aanvraag blijft de scope-boom plat | [Entities - List](https://learn.microsoft.com/en-us/rest/api/managementgroups/entities/list) noemt geen rol; gemeten, niet sluitend |
| `roleAssignmentScheduleInstances` op een scope | `Microsoft.Authorization/roleAssignments/read` op die scope | Reader op die scope. Met alleen een rol onder een subscription weigert de lijst op de subscription en antwoordt de lijst op je resource group of resource | [PIM REST: actieve toegang](https://learn.microsoft.com/en-us/rest/api/authorization/privileged-role-assignment-rest-sample); gemeten |
| `roleAssignmentScheduleInstances` met `asTarget()` op de root | Niet gedocumenteerd | Geen: je eigen actieve rollen komen terug, ook als je enige rol een datarol is | Gemeten |
| `roleEligibilitySchedules` | `Microsoft.Authorization/roleAssignments/read` op die scope | Reader op die scope | [PIM REST: eligible toegang](https://learn.microsoft.com/en-us/rest/api/authorization/privileged-role-eligibility-rest-sample) |
| `roleEligibilityScheduleInstances` met `asTarget()` op de root | Niet gedocumenteerd | Geen: je eigen eligible rollen komen terug zonder enige Azure-rol | Gemeten |
| `roleDefinitions`-lijst (op tenantniveau, per subscription als terugval) | `Microsoft.Authorization/roleDefinitions/read` | Reader (`*/read`) op de scope. Of Reader op één subscription ook de lijst op tenantniveau krijgt, is niet gemeten; de lijst per subscription is de terugval | Resource provider operations; [Reader](https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles/general#reader) |
| `getRoleDefinition` (één rol, voor de omschrijving in de rolweergave van het Azure-rapport) | `Microsoft.Authorization/roleDefinitions/read` | Reader op de scope van de toewijzing. Lukt het lezen niet, dan toont de rolweergave geen omschrijving | Resource provider operations; Reader |
| `roleManagementPolicies` (een rol op een scope) | `Microsoft.Authorization/roleAssignments/read` op die scope | Reader op die scope. Niet op de root: daar antwoordt hij 400 `InvalidResource`, ook met User Access Administrator op de root | [PIM REST: rolinstellingen](https://learn.microsoft.com/en-us/rest/api/authorization/privileged-role-policy-rest-sample); gemeten |
| `roleManagementAlerts` (per subscription) | `Microsoft.Authorization/roleAssignments/read` op de subscription | Reader op de subscription. Een alert verversen of sluiten vraagt Owner of User Access Administrator; de app doet geen van beide | [PIM REST: alerts](https://learn.microsoft.com/en-us/rest/api/authorization/role-management-alert-rest-sample) |

Volgens de voorbeelden van Microsoft heeft elke ingebouwde rol `Microsoft.Authorization/roleAssignments/read`. Een rol die alleen data geeft, heeft helemaal geen `Microsoft.Authorization`-actie. Reken dus op Reader, niet op zomaar een rol.

Twee Microsoft Graph-aanvragen. `servicePrincipals` met `$select=id,servicePrincipalType`, 15 id's per request, om apps van managed identities te onderscheiden onder de service principals met een Azure-rol; die gebruikt `Application.Read.All`. En `users` en `groups` met `$select=id`, 15 id's per request, om principals te vinden die een Azure-rol hebben maar niet meer bestaan; die gebruiken `User.Read.All` en `Group.Read.All`. De app vraagt alle drie al bij het inloggen; geen nieuwe permissie.

Er wordt niets geschreven. Tenantdata blijft in je sessie.

---

## Export

**Gestart via:** de Export-knop in het paginakop. Een venster voor een PDF-rapport of een CSV.

- **PDF:** het detailniveau (Summary, Full of Full with appendix, die alleen voor het beheerderspubliek is), het publiek, namen vervangen, grafiekvorm, wat meetelt (de gekozen scope, Include inherited en Delegated subscriptions), het huidige filter toepassen, en de blokken die erin komen.
- **CSV:** een rij per toewijzing in de gekozen scope, met de Azure-velden (scope, niveau, subscription, delegated, rol, principal, soort, status, herkomst en einde).

---

## Data Verversen

- **Knop:** Refresh in het paginakop leest de toewijzingen en de rolinstellingen opnieuw. Roldefinities worden eenmaal per sessie gelezen.
- **Alerts:** gelezen na de rolinstellingen, eenmaal per leesbare subscription; alerts hebben geen eigen refresh.
- **Vertraging:** Azure kan tot 10 minuten nodig hebben om een rolwijziging toe te passen; Refresh leest die dan opnieuw.

---

## Azure en Entra: wat anders is

| Onderwerp | Op Azure |
|-----------|----------|
| Eenheid | Role × scope: dezelfde rol op twee scopes telt twee keer |
| Rolinstellingen | Per rol per scope ingesteld; ze erven niet van een hogere scope |
| Groepen | Geen PIM for Groups en geen groepen buiten PIM op dit dashboard |
| Alerts | PIM-alerts per subscription, preview, alleen lezen. Een subscription die Microsoft nog niet gescand heeft, toont er geen, ook als er iets te vinden is |
| Gedelegeerde toegang | Azure Lighthouse-subscriptions van een andere tenant tellen mee en zijn gemarkeerd als Delegated |
| Apps, managed identities en agents | Alleen actief: ze kunnen niet eligible zijn |

---

## Volgende Stappen

- [Dashboard Pagina](./07-dashboard-pagina.md) - Het Entra-dashboard
- [Rapport Pagina](./08-rapport-pagina.md) - Gedetailleerde configuratieweergave
- [Belangrijke Concepten](./06-belangrijke-concepten.md) - PIM-terminologie begrijpen
