# Rapportpagina

De Rapportpagina laat elke rol en groep zien zoals ze nu zijn: wie wat heeft, hoe het beveiligd is en wat ontbreekt. De pagina is alleen-lezen. Wijzigen doe je in [Configureren](./09-configuratie-pagina.md).

---

## Indeling

Eén pagina met links een lijst en rechts het detail van het gekozen item. Onder 1024 px breed is het detail een eigen weergave met een Terug-knop, en de lijst komt terug waar je gebleven was.

```
Report                                  [Refresh] [Export]
[Roles 146 | Groups 12] [Search a role, a group or a person] [Filters]
chips: Privileged only x   Has assignments x   Clear all      7 of 146 roles
+----------------------+--------------------------------------------+
| Role        Sort v   | Global Administrator [Privileged] [Copy link]
| Global Administrator | Assignments   Eligible (3)  Active (2)
| Security Administr.  | Role configuration  Activation | Assignment | Notification
| ...                  | tegels
+----------------------+--------------------------------------------+
```

Het adres van de pagina bevat de staat, dus een link opent dezelfde weergave: `view` (roles of groups), `q` (zoekopdracht), `f` (het filter, hetzelfde als op het Dashboard), `role` en `group` (het gekozen item). "Copy link" kopieert het adres. Links uit eerdere versies van het Rapport werken nog en worden omgezet.

---

## Rollen

De lijst toont de naam, een tag Privileged of Custom, "{n} eligible, {n} active" en alleen twee waarschuwingen: "No MFA on activation" en "Permanent active". Sorteer op meeste toewijzingen, naam of meest permanent.

Het detail heeft twee delen.

**Assignments.** Eligible en Active, één rij per principal met tags:

| Tag | Betekenis |
|-----|-----------|
| User, Guest, App, Group | Wat de principal is |
| Direct, Via group | Of de toewijzing aan de principal zelf is gedaan of via een groep komt |
| Tenant-wide, een administratieve eenheid, een app | Het bereik van de toewijzing |
| Expires {datum}, No end date | Het einde van het schema |
| Permanent, Always on | Vaste toegang die nooit afloopt |
| Activated, Assigned | Hoe een actieve toewijzing is ontstaan |
| Emergency access | Een account dat je in Settings hebt gemarkeerd |

Beweeg over een tag of geef hem focus (op een telefoon: tik erop) voor de uitleg. Een groep die de rol heeft is één rij met de leden achter "Show {n} members"; leden worden gelezen zodra je ze opent.

**Role configuration.** Drie tabs met één tegel per instelling:

- Activation: maximale duur, wat vereist is (Entra MFA of een authenticatiecontext), motivatie en ticket, goedkeuring en goedkeurders, en de twee tegels Custom extension (Preview).
- Assignment: hoe lang eligible en actieve toewijzingen mogen duren en wat vereist is bij een actieve toewijzing.
- Notification: wie bericht krijgt bij eligible toewijzingen, actieve toewijzingen en activaties.

Een tab met een probleem heeft een oranje stip: een bevoorrechte rol zonder MFA of authenticatiecontext, een beleid dat permanente actieve toewijzingen toestaat, of een activatie die niemand meldt.

---

## Groepen

De lijst heeft twee delen: **Outside PIM** (rol-toewijsbare groepen die rollen hebben maar niet onder PIM vallen, eerst getoond) en **Under PIM**.

Een groep buiten PIM toont de rollen die ze heeft en haar leden; zij hebben die rollen altijd en er wordt niets geactiveerd. "Bring under PIM" opent het Entra-beheercentrum.

Een groep onder PIM toont haar leden en eigenaren (eligible en actief), de rollen die ze heeft en de configuratie met een keuze **Member** of **Owner**: elk heeft een eigen beleid. Een activatie via een groep staat onder die groep.

---

## Zoeken en filters

Zoeken vindt een rol, een groep of een persoon (op naam, UPN of mail). De knop Filters opent een paneel met dezelfde filters die de kaarten van het Dashboard instellen:

- Rollen: bevoorrecht, roltype, toewijzingen, wie ze heeft (gebruiker, gast, app, groep), bereik, direct of via een groep, MFA, goedkeuring, maximale duur, custom extension.
- Groepen: rol-toewijsbaar, onder of buiten PIM, toegangstype (member of owner) en de toewijzingsfilters.

Het paneel is standaard dicht en onthoudt of je het opende. Actieve filters staan als chips; een filter van de andere weergave blijft bewaard en krijgt "(groups only)" of "(roles only)". Escape sluit het paneel. Staat een toewijzingsfilter aan, dan zijn de rijen die passen gemarkeerd in het detail.

---

## Laden en mislukken

- Skeletons tijdens de eerste load; beleid komt op de achtergrond binnen, een tegel toont een placeholder tot zijn beleid er is en de beleidsfilters staan intussen uit.
- Een rol waarvan de instellingen niet gelezen konden worden zegt "Not loaded", en één kader somt ze op met Try again voor alleen die rollen.
- Kon niets gelezen worden, dan zegt het kader waarom (de status die Graph gaf) en biedt Try again.
- Past niets, dan zegt de lijst waarop je filterde en biedt Clear filters.
- PIM for Groups heeft een eigen machtiging; zolang die niet is gegeven zegt de weergave Groups dat en biedt ze aan hem te geven.

---

## Export

De knop Export opent één dialoog. Kies waarvoor het bestand dient:

| Doel | Formaat | Wat je krijgt |
|------|---------|---------------|
| **Overview** | CSV | Eén rij per toewijzing (rollen en groepen), één rij per rol met zijn instellingen, één rij per groep en Member of Owner. De eerste rijen noemen de tenant, wanneer de data is gelezen, het filter en wie exporteerde. "Replace names" maakt van mensen Person 1, 2, ... en laat de object-id's van mensen, de exporteur en de zoekwoorden weg. |
| **For Configure Import** | CSV | Het importformaat van Configure Import: roolbeleid, groepsbeleid, roltoewijzingen en groepstoewijzingen, met id's, Scope ID en End Date. Geactiveerde toewijzingen en leden via een groep worden weggelaten (de dialoog telt ze en zegt waarom). |
| **Backup** | JSON | Alles in één bestand: elk beleid met alle regels en de instellingen daaruit, elke toewijzing, de authenticatiecontexten en de custom extensions, met schemaversie, tenant, wanneer de data is gelezen en de appversie. |

Inhoud en bereik zijn selectievakjes: welke bestanden, directory roles, PIM for Groups en "Apply the current filter" (rollen en groepen allebei; een backup is altijd compleet). Onder "You get" staat elke bestandsnaam met zijn aantal rijen en de knop zegt hoeveel bestanden hij downloadt. Ze downloaden na elkaar. Je laatste keuze wordt onthouden.

De bestandsnamen zijn `pim-overview-assignments-{datum}.csv`, `pim-overview-role-settings-{datum}.csv`, `pim-overview-group-settings-{datum}.csv`, `pim-bulk-role-policies-{datum}.csv`, `pim-bulk-group-policies-{datum}.csv`, `pim-bulk-role-assignments-{datum}.csv`, `pim-bulk-group-assignments-{datum}.csv` en `pim-backup-{datum}.json`.

Elke cel is volgens RFC 4180 beschermd en een cel die begint met `=`, `+`, `-` of `@` krijgt een apostrof ervoor, zodat een spreadsheet tekst toont en geen formule. Het PDF-rapport blijft op het Dashboard.

> [!NOTE]
> Export en import delen één kolomdefinitie per bestandstype (`src/utils/exportSchema.ts`). De tests schrijven elk bestand, lezen het terug en vergelijken het met de bron, en controleren dat Configure Import (`detectCsvKind` in `src/utils/importDetect.ts`) elk bulkbestand nog herkent.

---

## Toewijzingstypen

- **Eligible**: kan de rol activeren via PIM.
- **Active**: heeft de rol nu. Activated betekent dat iemand een eligible toewijzing activeerde en dat het vanzelf eindigt; Assigned betekent dat een beheerder het gaf, met of zonder einde.
- **Permanent**: een actieve toewijzing zonder einde. Ze omzeilt activatie, MFA en goedkeuring.

> [!WARNING]
> Permanente toewijzingen horen zeldzaam te zijn. Een bevoorrechte rol met een permanente actieve toewijzing is een van de rijen onder "Easy to miss" op het Dashboard.

---

## Probleemoplossing

- **Een rol zegt "Not loaded".** Graph gaf het beleid niet terug (throttling of een machtiging). Gebruik Try again in het kader boven de lijst.
- **De weergave Groups vraagt om een machtiging.** Geef PIM for Groups in Settings of met de knop in de weergave.
- **De lijst is leeg.** Een filter of zoekopdracht staat aan; gebruik Clear filters.
- **Een groep toont geen leden.** Leden worden gelezen zodra je de groep opent; weigert Graph dat, dan zegt de rij het en biedt Try again.

---

## Volgende stappen

- [Configuratiepagina](./09-configuratie-pagina.md)
- [Dataflow](./03-dataflow.md)
