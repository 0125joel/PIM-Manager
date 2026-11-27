# Audit Pagina

Vraag een beheerder of die een rol nog nodig heeft en het antwoord is ja. Altijd. De Audit-pagina (`/audit`) geeft je iets beters dan dat gesprek: wat er is geactiveerd, wat er is gewijzigd, wie dat deed en wanneer, voor Entra-rollen en PIM for Groups. De pagina leest alleen. Entra en Azure hebben elk hun eigen Audit-pagina, en die werken hetzelfde. Deze gids begint bij Entra; [Audit op Azure](#audit-op-azure) vertelt wat er anders is.

---

## Opbouw

```
Audit                                                     [Refresh] [Export]
Period: last 30 days                       [tijdlijn, een rij per soort]
Source: Entra audit log. Oldest event available: ... Read ... Times in ...
[Events | No activation] [ ] Show more details     soorten, waar, zoeken
+--------------------------------+---------------------------------------+
| Today                          | What, By, Role, When, Result          |
| Megan Bowen activated ...      | Reason, Ticket, Approved by           |
+--------------------------------+---------------------------------------+
```

Vanaf 1024 px breed staan de lijst en het detail naast elkaar, in even brede kolommen. Daaronder is de lijst de pagina, en opent een rij het detail met een terugknop.

Het adres draagt de weergave, dus een link opent hetzelfde: `days`, `from` en `to` (de selectie), `kinds`, `env`, `failed`, `q`, `view` en `event`. **Copy link** in het detail kopieert hem.

---

## Waar de events vandaan komen

| Bron | Gaat terug | Wat er nodig is |
|------|------------|-----------------|
| Entra-auditlog (Microsoft Graph) | Tot 30 dagen | De optionele machtiging `AuditLog.Read.All`, en de rol Reports Reader, Security Reader of Security Administrator |
| Log Analytics-workspaces, naar eigen keuze | Zolang de workspace zijn logs bewaart | De optionele machtiging `https://api.loganalytics.io/Data.Read`, en leestoegang tot de workspace en zijn tabel `AuditLogs` |

De machtiging wordt op deze pagina gevraagd, nooit bij het inloggen, en de rest van de app werkt zonder. Events blijven voor de sessie in het geheugen. PIM Manager bewaart ze niet, en een IP-adres, user agent of token-claim komt nooit op het scherm of in een export, omdat de mapper alleen velden houdt die hij bij naam kent.

**De dekkingsregel** onder de tijdlijn noemt de bron, het oudste beschikbare event, de leestijd en de tijdzone. Zo'n pagina is alleen iets waard als ze eerlijk is over wat ze niet heeft gezien. Daarom heeft ook elke fout een eigen toestand:

| Toestand | Wat het betekent |
|----------|------------------|
| Audit needs one more permission | Er is nog niets gelezen. **Grant permission** vraagt de machtiging |
| Your role cannot read the audit log | De machtiging is er, je rol niet. Activeer een van de leesrollen en kies **Refresh** |
| The audit log could not be loaded | Microsoft gaf geen antwoord. Dit zegt niets over wat er in de periode is gebeurd |
| More than 50,000 events | Te veel voor een browser. Je kiest een kortere periode, omdat een deel er anders als het geheel uitziet |
| Nothing happened in this period | Alleen na een read die gelukt is |

Nieuwe events kunnen er een paar minuten over doen.

---

## Events

Eén actie is één rij. Microsoft logt een aanvraag en de voltooiing apart, en een activatie met goedkeuring zelfs onder twee correlation id's. De pagina voegt ze samen, zodat je leest wat er gebeurde en niet hoe het gelogd is. Een aanvraag die nog op goedkeuring wacht, leest als aangevraagd en niet als geactiveerd. Een afgewezen aanvraag toont Denied.

| Soort | Wat erin staat |
|-------|----------------|
| Activations | Activaties van een rol of groep. Standaard aan |
| Assignments | Eligible en actieve toewijzingen die zijn toegevoegd, verwijderd of verlengd. Standaard aan |
| Settings | Wijzigingen in rolinstellingen. Microsoft logt alleen de nieuwe waarde, dus de oude leest "Not in the log". Standaard aan |
| Outside PIM | Rolwijzigingen die direct zijn gemaakt, zonder PIM. Er is dan geen aanvraag, reden of goedkeuring om te tonen. Standaard aan |
| System | Events die een dienst startte, en alles wat de pagina niet preciezer kan indelen. Standaard uit, omdat verlopen activaties anders de wijzigingen van mensen ondersneeuwen. Het aantal blijft zichtbaar |

Naast de soorten zoek je op persoon, rol en ticket. De rest staat onder **Filters**: **Who** (Users, Guests, Apps, Agents of Groups), **Environment** (Entra roles of PIM for Groups), **Roles** (Privileged only) en **Result** (Failed or denied). Een actief filter staat als chip in beeld en haal je daar ook weer weg. Een event zonder houder, zoals een gewijzigde instelling, zie je alleen als Who op All staat. Het log noemt een app en een agent hetzelfde, dus de pagina kijkt naar wie nu een rol heeft. Heeft hij geen rol meer, dan blijft hij onder Apps en onder Agents staan, en de pagina zegt hoeveel dat er zijn. Privileged only laat een rol staan die het niet kan beoordelen en zegt hoeveel dat er zijn, want niet weten is iets anders dan niet privileged. Een groep telt mee als die eligible of active is voor een privileged rol.

**Show more details** voegt Used for, Requested duration, MFA on activation, Where en Source toe. Het filtert nooit en verandert niets aan een export.

Heb je een rol gekregen via een groep die een Entra-rol heeft? Dan toont de rij die rol, en de groep onder **Through**. Het log noemt zelf alleen de groep, dus de pagina vergelijkt met de toewijzingen van vandaag, en een rol die de groep niet meer heeft levert geen match op. Zoeken vindt de rij ook op de naam van de rol.

**Used for** is hoe lang een activatie echt duurde. Het blijft leeg als het einde niet in het log staat, omdat een lopende activatie en een vertraagd event er van hieruit hetzelfde uitzien.

---

## Tijdlijn en periode

De periode is een heel aantal dagen. Zonder workspace is 30 het maximum; met een workspace opent de pagina op 180 dagen, of minder als je workspaces minder bewaren.

De tijdlijn heeft een rij per soort. Sleep eroverheen om een stuk te selecteren, en de lijst en de tellers lopen mee. De grepen verplaats je met de pijltjestoetsen: een dag tegelijk, zeven met Shift, en Home en End voor de randen. Een klik op een punt selecteert zijn rij in de lijst. Wijs een punt aan en je ziet soort, resultaat, zin en tijd. Een rode stippelring betekent mislukt of geweigerd, een rand markeert de actie in het detail.

---

## No activation

Dit is de weergave voor het gesprek van bovenaan deze pagina. Ze zet elke toewijzing naast de geslaagde activaties in de periode.

| Activation | Betekenis |
|------------|-----------|
| Last activated met een datum | Minstens één geslaagde activatie in de periode |
| None in this period | Eligible, en geen geslaagde activatie in de periode |
| Not applicable | Permanente toegang, een app, of via een groep. Die activeren niet, dus "geen activatie" zou niets bewijzen |
| Not judged | Bijvoorbeeld als de leden van een groep niet gelezen konden worden |

None in this period is geen oordeel. Een rol die eens per kwartaal wordt gebruikt, lijkt in een venster van 30 dagen ongebruikt. Daarom zeggen de pagina en de export hetzelfde: dit laat zien dat een rol in de periode niet is geactiveerd, niet dat hij weg kan. Permanente toegang leest nooit als "niet gebruikt".

Mislukte activaties en aanvragen zonder voltooiing tellen niet mee. Deze weergave heeft ook de toewijzingen nodig en leest die dus ook. De selectie op de tijdlijn, de soorten en Failed or denied gelden hier niet. Filters en zoeken wel, en iemand die een rol via een groep heeft, telt onder Users of Guests, en onder Groups.

---

## Log Analytics-workspaces

Dertig dagen is kort als je wilt laten zien dat een rol al een jaar niet is gebruikt. In [Instellingen](./11-settings.md), onder **Log Analytics workspace**, kies je voor jezelf een of meer workspaces. De lijst komt uit Azure en toont wat je account mag zien, dus een lege lijst bewijst niet dat ze er niet zijn. Je kunt ook altijd zelf een workspace-ID invullen.

Elke workspace krijgt een status per log: de datums en hoe lang hij logs bewaart, nog geen logs, of geen toegang. Een workspace heeft pas logs vanaf het moment dat een diagnostic setting in Entra `AuditLogs` ernaartoe stuurt. De eerste logs kunnen tot 3 dagen duren en oudere logs komen er niet bij.

De pagina vraagt elke workspace apart op, zodat een workspace die faalt bij naam wordt genoemd en niet stilletjes ontbreekt. De laatste 30 dagen van het Entra-auditlog worden ook meegenomen, omdat een workspace events kan missen. Ouder dan dat kan niets het controleren. Elk event staat er één keer.

Alleen de ID's van je keuze blijven in deze browser staan, per tenant, tot je uitlogt.

---

## Audit op Azure

Wissel bovenin naar Azure en je krijgt dezelfde pagina op `/azure/audit`: dezelfde tijdlijn, dezelfde filters, dezelfde export. Een filternaam betekent aan beide kanten hetzelfde. Het verschil zit in waar de events vandaan komen en wat je mag zien.

| Bron | Gaat terug | Wat het vraagt |
|------|------------|----------------|
| Azure activity log en PIM-aanvragen | Tot 90 dagen. De pagina opent op 30 | Een Azure-rol op de scope. Reader is genoeg, en er wordt geen extra permissie gevraagd |
| Entra audit log, ernaast | Tot 30 dagen, of verder met een workspace die `AuditLogs` bevat | `AuditLog.Read.All`, als je die al gaf op de Entra Audit-pagina. Daarmee zie je de goedkeurder en wie een groep met een rol activeerde |
| Log Analytics-workspaces, jouw keuze | Zolang de workspace zijn logs bewaart, tot een jaar | `https://api.loganalytics.io/Data.Read`, en leesrechten op de workspace en zijn tabellen `AzureActivity` en `AuditLogs` |

Azure laat stilletjes weg wat je rollen niet mogen zien. Een lege lijst bewijst dus niet dat er niets gebeurd is, en dat zegt de pagina ook. Wat niet gelezen kon worden, noemt hij, hier en in elke export. Je eigen aanvragen zijn de uitzondering: die staan er wel bij, ook op scopes die je niet kunt lezen. Een smalle lezer ziet daar alleen zijn eigen aanvragen, en de dekkingsregel zegt dat.

**Via een groep.** Activeer je een groep die een Azure-rol heeft, of word je eraan toegewezen, dan krijg je een rij per rol en scope, net als bij een directe, met de groep onder **Through**. Dat komt uit het Entra audit log en de toewijzingen van vandaag. Zonder dat log, of voorbij hoe ver het terugreikt, ontbreken die rijen dus terwijl de directe er wel staan. Een melding boven de lijst vertelt je dat, want een gat dat je niet ziet is erger dan een gat dat je wel ziet. In de exports staat hiervoor een kolom Through group.

**Het detail.** Azure zegt niet wie een aanvraag beoordeelde, dus Approved by of Denied by komt ook uit het Entra audit log. Met **Show more details** zie je bij een aanvraag ook wanneer die Starts, als hij voor later was gepland, en hoe lang de beslissing duurde (Approved after of Denied after). Een geweigerde aanvraag toont Denied en staat onder **Failed or denied**.

**No activation op Azure.** Elke toewijzing is één rij. Een eligible groep krijgt een rij per lid, elk beoordeeld op de eigen activaties. Dat gaat op het Entra audit log en vraagt `AuditLog.Read.All` en leesrechten op PIM for Groups. Ontbreekt een van beide, dan zegt een rij wat er mist en wordt er niets beoordeeld. Het Entra audit log bewaart 30 dagen: in een langere periode leest een lid zonder activatie in die 30 dagen Not judged, nooit None in this period. Een groep die niet in PIM for Groups zit, leest Not applicable.

**Met een workspace.** De pagina opent op 180 dagen en gaat tot een jaar, of zo ver als je workspaces hun logs bewaren. Drie dingen om te weten:

- Ouder dan 90 dagen komt alleen van subscriptions die naar een workspace sturen. De diagnostic setting is per subscription, de eerste Azure-logs kunnen tot 90 minuten duren en oudere logs komen er niet bij. Entra-logs doen er tot 3 dagen over.
- Een workspace toont wat erin staat, ook op scopes waar je rollen niet bij kunnen. Wie de workspace mag lezen, mag dit dus lezen.
- De eigen reads blijven ernaast lopen, omdat een workspace events kan missen. Staat iets in beide, dan zie je het één keer.

Kan een workspace of een van zijn logs niet worden gelezen, dan zie je de rest en noemt de pagina wat er ontbreekt. Dat geldt ook voor een tabel waar je geen rechten op hebt. Log Analytics geeft dan een leeg antwoord in plaats van een fout, dus PIM Manager vraagt bij elke read je rechten mee. Mag je alleen bepaalde rijen zien, dan toont de pagina de rijen die je mag zien en zegt hij dat er events kunnen ontbreken. Kan geen enkele worden gelezen, dan ben je terug op 90 dagen, met een melding die dat zegt. Een workspace met een lege Entra-tabel telt als een zonder die tabel, dus Entra blijft op 30 dagen.

---

## Export

**Export** bewaart de huidige weergave, met filters en selectie, als bestand.

| Formaat | Waarvoor |
|---------|----------|
| CSV | Eén rij per actie, met reden, ticket en goedkeurder, voor een spreadsheet |
| JSON | Dezelfde acties met alle bewaarde velden |
| PDF | Audit report: periode, bronnen, totalen en de acties |

Op Entra kies je onder **Include** Entra roles, PIM for Groups of allebei, elk met het aantal. Het begint elke keer met allebei, dus geen bestand laat er een weg zonder dat je daarvoor kiest. De totalen en de filterregel volgen je keuze.

Een groepsrij heeft de groep in een kolom Through group, en op Entra de rollen die de groep heeft in Roles through the group. Elke export noemt de periode, de bron, het oudste beschikbare event, wanneer er is gelezen en wat er niet gelezen kon worden. Hij bevat altijd alle bewaarde velden, ook als Show more details uit staat. Tijden staan in UTC.

**Replace names with User 1, 2, ...** laat ook de object-ID's van personen, de exporteur, de zoekwoorden en de reden, nieuwe waarde en ticket weg, omdat vrije tekst namen kan bevatten. Rol- en groepsnamen blijven staan.

Een export is een rapport van wat deze pagina heeft gelezen. Het is geen onvervalsbaar bewijs, en doet ook niet alsof.
