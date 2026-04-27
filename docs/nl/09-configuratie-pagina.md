# Configuratiepagina

Dit document legt de functies en functionaliteit van de Configuratiepagina uit, waar je PIM-instellingen voor rollen en groepen kunt configureren.

---

## Overzicht

De Configuratiepagina biedt drie modi voor het beheren van PIM-configuraties:

1. **Wizard Modus** — Een begeleide stapsgewijze procedure voor bulk-configuratie
2. **Handmatige Modus** — Directe toegang tot rol/groep-selectie en instellingenformulieren, met gestaagde wijzigingen
3. **Bulk Modus** — CSV-gebaseerde batchconfiguratie voor beleid en toewijzingen voor alle vier CSV-types (Rol Policies, Groep Policies, Rol Toewijzingen, Groep Toewijzingen)

```
┌─────────────────────────────────────────────────────────────────┐
│                    Configure PIM                                 │
│   Beheer PIM rollen en groepen efficiënt.                        │
├─────────────────────────────────────────────────────────────────┤
│ ▌ [🪄] Wizard        Begeleide stapsgewijze configuratie   [→]  │
│   Aanbevolen wanneer: Nieuw met PIM of bulk-wijzigingen          │
├─────────────────────────────────────────────────────────────────┤
│   [⚙] Handmatig     Volledige controle over instellingen   [→]  │
│   Aanbevolen wanneer: Direct toegang zonder begeleide flow       │
├─────────────────────────────────────────────────────────────────┤
│   [📊] Bulk         Upload CSV voor configuratie op schaal  [→]  │
│   Aanbevolen wanneer: Je hebt een bestaande export om toepassen  │
└─────────────────────────────────────────────────────────────────┘
```

> [!NOTE]
> Elke modus wordt weergegeven als een horizontale rij met een kleurverloop-icoon. De geselecteerde rij toont een gekleurde linkerstreep. Klik een rij om te selecteren en klik vervolgens op **Doorgaan**.

---

## Wizard Modus

De wizard begeleidt je door PIM-configuratie in een reeks stappen. Het exacte aantal stappen hangt af van de geselecteerde workload en het configuratietype (minimaal 8, maximaal 10 bij dual-workload flows).

### Stap 1: Veiligheidscontrole (Backup)

Zorgt ervoor dat je data actueel is voordat je wijzigingen maakt.

| Controle | Beschrijving |
|----------|--------------|
| **Laatst Gesynchroniseerd** | Toont wanneer data voor het laatst is ververst |
| **Vernieuw Knop** | Haalt laatste data op van Graph API |

> [!TIP]
> Vernieuw altijd de data voordat je configureert om te werken met de meest actuele instellingen.

---

### Stap 2: Workload Selectie

Selecteer welke PIM workloads je wilt configureren.

| Workload | Beschrijving |
|----------|--------------|
| **Directory Rollen** | Entra ID administratieve rollen |
| **PIM voor Groepen** | Groepen beheerd door PIM |

Je kunt één of beide workloads selecteren. De wizard toont relevante opties op basis van je selectie.

> [!NOTE]
> Je moet consent hebben gegeven voor de benodigde machtigingen per workload. Zonder consent is de workload niet beschikbaar.

---

### Stap 3: Configuratie Type

Kies welk type configuratie je wilt uitvoeren.

| Type | Beschrijving |
|------|--------------|
| **Alleen Policies** | Configureer activatieregels, vervaldatum, goedkeuringseisen en notificatie-instellingen |
| **Alleen Toewijzingen** | Beheer eligible en actieve toewijzingen voor rollen of groepen |
| **Beide** | Configureer beleidsinstellingen en toewijzingen in één flow |

---

### Stap 4: Scope Selectie

Selecteer de specifieke rollen en/of groepen die je wilt configureren.

**Configuratie Modi:**

| Modus | Beschrijving |
|-------|--------------|
| **Nieuw Beginnen** | Begin met Microsoft standaardinstellingen |
| **Huidige Laden** | Laad instellingen van de geselecteerde rol/groep (alleen bij enkele selectie) |
| **Klonen Van** | Kopieer instellingen van een andere rol/groep |

**Voor Directory Rollen:**
- Zoeken en filteren van beschikbare rollen
- Selecteer meerdere rollen tegelijk
- Zie huidige toewijzingsaantallen
- Kloon instellingen van bestaande rollen

**Rol filter pills:**

| Filter | Opties |
|--------|--------|
| **Type** | All · Built-in · Custom |
| **Privilege** | All · Privileged |
| **Toewijzingen** | All · With · Without |

**Voor PIM Groepen:**
- Bekijk PIM-beheerde groepen
- Toggle om onbeheerde (rol-toewijsbare) groepen te tonen
- Selecteer meerdere groepen

**Groep type filter pill:** All · Security · M365 · Mail-enabled

> [!TIP]
> Gebruik "Klonen Van" om goed geconfigureerde rolinstellingen te kopiëren naar andere rollen.

> [!NOTE]
> **Huidige Laden** werkt voor zowel Directory Rollen als PIM Groepen. Selecteer exact één item om dit in te schakelen.

---

### Stap 5: Policies *(indien Policies of Beide geselecteerd)*

Definieer de beleidsinstellingen om toe te passen.

**Activatie Instellingen:**
- Maximale activatieduur (30 minuten tot 24 uur)
- Authenticatie-eis (Geen, MFA, of Conditional Access)
- Rechtvaardiging vereist bij activatie
- Ticketinformatie vereist
- Goedkeuring vereist (met goedkeurdersselectie)

**Toewijzingsvervaldatum:**
- Permanent eligible toestaan
- Maximale duur eligible toewijzing
- Permanent actief toestaan
- Maximale duur actieve toewijzing
- MFA vereist bij actieve toewijzing
- Rechtvaardiging vereist bij actieve toewijzing

**Notificatie-instellingen:**
Configureer e-mailnotificaties voor drie eventtypen:
- **Eligible Toewijzing**: Wanneer leden worden toegewezen als eligible
- **Actieve Toewijzing**: Wanneer leden worden toegewezen als actief
- **Activatie**: Wanneer eligible leden de rol activeren

Voor elk event, configureer notificaties naar:
- Rol administratoren
- Toegewezenen/Aanvragers
- Goedkeurders

> [!NOTE]
> Voor PIM Groepen kun je schakelen tussen **Member** en **Owner** policies.

---

### Stap 6: Toewijzingen *(indien Toewijzingen of Beide geselecteerd)*

Beheer rol/groep toewijzingen voor gebruikers of groepen.

**Nieuwe Toewijzingen Maken:**

| Instelling | Beschrijving |
|------------|--------------|
| **Toewijzingstype** | Eligible (aanbevolen) of Actief |
| **Leden** | Zoek en selecteer gebruikers of groepen |
| **Duur** | Permanent of tijdgebonden (met start/einddatum) |
| **Scope** | Directory-breed (`/`) of specifieke Administratieve Eenheid |
| **Rechtvaardiging** | Reden voor de toewijzing |

**Beleidscontrole Permanente Toewijzing:**

Bij het aanmaken van toewijzingen controleert de **Permanent** toggle automatisch het werkelijke PIM-beleid voor elke geselecteerde rol of groep:
- **Beleid controleren...** — kort weergegeven terwijl het beleid wordt geladen
- **Geblokkeerd door Beleid** — weergegeven wanneer het beleid van de rol/groep geen permanente toewijzingen toestaat

Als meerdere rollen/groepen zijn geselecteerd, is permanent alleen toegestaan als **alle** geselecteerde items dit toestaan.

**Bestaande Toewijzingen Beheren:**
- Bekijk alle huidige toewijzingen voor geselecteerde rollen
- Filter op Eligible, Actief, of Verlopen
- Markeer toewijzingen voor verwijdering
- Bekijk vooraf welke gebruikers worden beïnvloed

> [!TIP]
> Gebruik eligible toewijzingen voor de meeste scenario's. Actieve toewijzingen alleen gebruiken wanneer directe toegang vereist is zonder activatie.

---

### Stap 7: Review

Bekijk alle wijzigingen voordat je ze toepast.

De review stap toont:
- Samenvatting van geselecteerde items
- Beleidsinstellingen die worden toegepast
- Toewijzingen die worden gemaakt
- Toewijzingen die worden verwijderd
- Waarschuwingen voor hoog-risico rollen

> [!IMPORTANT]
> Controleer zorgvuldig — wijzigingen worden toegepast op alle geselecteerde rollen/groepen.

---

### Stap 8: Toepassen

Voer de configuratiewijzigingen uit.

**Procesfasen:**
1. **Policies** — Update PIM-instellingen voor elke geselecteerde rol/groep
2. **Toewijzingen** — Maakt nieuwe rol/groep toewijzingen
3. **Verwijderingen** — Verwijdert gemarkeerde toewijzingen

**Functies:**
- Realtime voortgangsindicator
- Succes/faal status per operatie
- Gedetailleerde foutmeldingen
- Herprobeer gefaalde operaties knop
- Uitvouwbare operatiedetails

> [!NOTE]
> Je kunt gedetailleerde logs zien in de browser console voor debugging.

---

### Stap 9: Controlepunt *(alleen bij dual-workload flows)*

Bij het configureren van zowel Directory Rollen als PIM Groepen toont een controlepuntstap de resultaten van de eerste workload en laat je doorgaan naar de tweede workload of vroegtijdig afsluiten.

---

### Stap 10: Afsluiting

Voltooiingssamenvatting met navigatielinks naar de Rapportpagina en Dashboard.

---

## Handmatige Modus

Voor gebruikers die directe toegang tot configuratietools prefereren, met een workflow voor gestaagde wijzigingen.

```
┌──────────────────────────────────────────────────────────────────┐
│  [Directory Rollen]  [PIM Groepen]                                │
├───────────────────────┬──────────────────────────────────────────┤
│    Rol Selectie       │    Instellingen Formulier                │
├───────────────────────┼──────────────────────────────────────────┤
│ ☐ Global Admin        │  Activatie Instellingen                  │
│ ☑ User Admin          │  ─────────────────────────────────────   │
│ ☑ Groups Admin        │  Max Duur: [4 uur]                       │
│ ☐ Exchange Admin      │  ☑ MFA Vereist                           │
│ ☑ SharePoint Admin    │  ☑ Rechtvaardiging Vereist               │
│ ...                   │  ☐ Goedkeuring Vereist                   │
│                       │                                          │
│ 3 rollen geselecteerd │  [Wijzigingen Stagen]                    │
└───────────────────────┴──────────────────────────────────────────┘
│  Gestaagde Wijzigingen (2)  [Alles Toepassen]  [Alles Wissen]    │
│  ✓ User Admin — Beleidsinstellingen gestaged                      │
│  ✓ Groups Admin — Beleidsinstellingen gestaged                    │
└──────────────────────────────────────────────────────────────────┘
```

### Workload Tabbladen

Schakel tussen **Directory Rollen** en **PIM Groepen** via de tabbladen bovenaan de pagina.

### Rol / Groep Selectie

Het linker paneel toont alle beschikbare items voor de geselecteerde workload.

**Functies:**
- Zoeken om rollen/groepen te filteren
- Quick-filter pills om de lijst te verfijnen zonder te typen
- Klik om te selecteren/deselecteren
- Toont toewijzingsaantallen
- Tags geven roltype aan

**Rol filter pills:**

| Filter | Opties |
|--------|--------|
| **Type** | All · Built-in · Custom |
| **Privilege** | All · Privileged |
| **Toewijzingen** | All · With · Without |

**Groep filter pill:** All · Security · M365 · Mail-enabled

### Instellingenformulier

Het rechter paneel toont configuratie-opties wanneer rollen of groepen zijn geselecteerd.

**Laden Vanaf Geselecteerd Item:**
Als precies één item is geselecteerd, kun je de huidige instellingen van dat item laden als sjabloon.

### Gestaagde Wijzigingen

Wijzigingen worden lokaal gestaged voordat ze naar de API worden verzonden. Bekijk alle wachtrij-wijzigingen in het paneel onderaan de pagina.

- Klik **Wijzigingen Stagen** om een wijziging in de wachtrij te plaatsen voor de geselecteerde rollen/groepen
- Klik **Alles Toepassen** om alle gestaagde wijzigingen via een voortgangsmodal naar de Graph API te versturen
- Klik **Alles Wissen** om alle gestaagde wijzigingen te verwijderen zonder toe te passen

---

## Bulk Modus

Voor CSV-gebaseerde batchconfiguratie. Het meest geschikt wanneer je instellingen hebt geëxporteerd van de Rapportpagina en wijzigingen wilt toepassen op veel rollen of groepen tegelijk.

```
Upload → Vergelijk → Toepassen → Resultaten
```

### Stap 1: Upload

Upload een CSV-bestand geëxporteerd van de **Rapportpagina** of gedownload als sjabloon. Vier CSV-types worden ondersteund:

| CSV Type | Automatisch gedetecteerd op basis van headers | Gebruik |
|----------|-----------------------------------------------|---------|
| **Rol Policies** | Headers bevatten `Role ID`, `Max Activation Duration`, etc. | Beleidsinstellingen toepassen op Directory Rollen |
| **Groep Policies** | Headers bevatten `Group ID`, `Member Max Duration`, etc. | Beleidsinstellingen toepassen op PIM Groepen |
| **Rol Toewijzingen** | Headers bevatten `Role ID`, `Principal ID`, `Assignment Type`, `Action` | Eligible/actieve toewijzingen toevoegen én verwijderen bij Directory Rollen |
| **Groep Toewijzingen** | Headers bevatten `Group ID`, `Principal ID`, `Access Type`, `Action` | Eligible/actieve toewijzingen toevoegen én verwijderen bij PIM Groepen |

> [!TIP]
> Gebruik de **Download Template** knoppen voor de juiste kolomkoppen. De **Toegangsrechten** export van de Rapportpagina genereert bulk-compatibele CSV-bestanden met Role ID / Group ID en Principal ID alvast ingevuld — klaar om te bewerken en opnieuw te importeren.

> [!NOTE]
> Goedkeurder-wijzigingen (toevoegen/verwijderen van goedkeurders) worden niet ondersteund in Bulk Modus, omdat deze opzoeken van gebruikers-ID's vereisen. Gebruik **Wizard Modus** voor het configureren van goedkeurders.

### Action-kolom — toevoegen en verwijderen in één CSV

Toewijzings-CSV's bevatten een **Action**-kolom die bepaalt wat er met elke rij gebeurt:

| Waarde | Gedrag |
|--------|--------|
| `add` (standaard) | Maakt de toewijzing aan; slaat rijen over die al bestaan |
| `remove` | Verwijdert de toewijzing; slaat rijen over die al zijn verwijderd |

Een enkele CSV kan zowel `add`- als `remove`-rijen bevatten. De preview-stap toont de status per rij: **New**, **Already exists**, **Will remove**, **Already removed** of **Permanent not allowed**.

**Export → Bewerk → Import roundtrip:**
1. Ga naar **Rapport** → exporteer **Toegangsrechten**
2. Er worden twee CSV-bestanden gegenereerd: één voor roltoewijzingen, één voor groeptoewijzingen — beide bevatten Role/Group ID, Principal ID en `Action = add`
3. Verander `Action` naar `remove` voor rijen die je wilt verwijderen
4. Upload naar Bulk Modus en pas toe

### Stap 2: Vergelijk / Preview

**Voor policy CSV's:** Bekijk het verschil tussen je CSV en de huidige live-instellingen:
- Alle wijzigingen zijn standaard vooraf geselecteerd
- Deselecteer individuele velden die je wilt overslaan
- Gebruik **Alles Selecteren / Alles Deselecteren** voor bulk-selectie

**Voor toewijzings-CSV's:** Een rij-voor-rij preview valideert elke toewijzing voor toepassing:
- Fouten (ontbrekende verplichte velden) worden per rij getoond
- Selecteer/deselecteer individuele rijen voor toepassing
- Rijen met status **Already exists** of **Already removed** worden automatisch overgeslagen

### Stap 3: Toepassen

Klik **N Wijzigingen Toepassen** (policies) of de toepassen-knop (toewijzingen) om wijzigingen uit te voeren. Een voortgangsbalk volgt elke update in realtime.

### Stap 4: Resultaten

Een tabel per rij toont succes of mislukking voor elke operatie met gedetailleerde foutmeldingen. Klik **Opnieuw Proberen** om alleen de mislukte rijen opnieuw te selecteren, of **Opnieuw Beginnen** om een nieuwe CSV te uploaden.

**Wat kan worden gewijzigd via Bulk Modus:**

| Veld | Rol Policies | Groep Policies |
|------|:------------:|:--------------:|
| Maximale activatieduur | ✅ | ✅ |
| MFA vereist | ✅ | ✅ |
| Rechtvaardiging vereist | ✅ | ❌ |
| Goedkeuring vereist | ✅ | ✅ |
| Goedkeurders | ❌ (gebruik Wizard) | ❌ (gebruik Wizard) |
| Authentication Context | ❌ (gebruik Wizard) | ❌ |

| Veld | Rol Toewijzingen | Groep Toewijzingen |
|------|:----------------:|:------------------:|
| Eligible toewijzing toevoegen | ✅ | ✅ |
| Actieve toewijzing toevoegen | ✅ | ✅ |
| Toewijzing verwijderen | ✅ | ✅ |
| Tijdgebonden duur | ✅ | ✅ |
| Permanente toewijzing | ✅ (indien beleid het toestaat) | ✅ (indien beleid het toestaat) |
| Administratieve Eenheid scope | ✅ | ❌ |

---

## Activatie Instellingen

Instellingen die gelden wanneer gebruikers hun eligible rol **activeren**.

| Instelling | Beschrijving | Aanbevolen |
|------------|--------------|------------|
| **Max Duur** | Maximale activatietijd | 4-8 uur voor meeste rollen |
| **MFA Vereist** | Gebruikers moeten MFA voltooien | ✅ Altijd inschakelen |
| **Rechtvaardiging Vereist** | Gebruikers moeten uitleggen waarom | ✅ Inschakelen voor audit |
| **Ticketinfo Vereist** | Link naar ticketsysteem | Optioneel |
| **Goedkeuring Vereist** | Moet eerst worden goedgekeurd | Voor gevoelige rollen |
| **Goedkeurders** | Wie kan goedkeuren | Security team of managers |

### Max Duur Opties

| Duur | Gebruiksscenario |
|------|------------------|
| 1 uur | Zeer gevoelig, korte taken |
| 4 uur | Standaard werkdag ondersteuning |
| 8 uur | Volledige werkdag dekking |
| 12+ uur | Wacht of uitgebreide operaties |

> [!WARNING]
> Langere duren verhogen risico. Gebruikers blijven geprivilegieerd voor de gehele duur.

---

## Toewijzingsinstellingen

Instellingen die gelden voor eligible/actieve **toewijzingen**.

| Instelling | Beschrijving |
|------------|--------------|
| **Permanent Eligible Toestaan** | Eligible toewijzingen verlopen nooit |
| **Max Eligible Duur** | Indien niet permanent, hoe lang |
| **Permanent Actief Toestaan** | Actieve toewijzingen verlopen nooit |
| **Max Actieve Duur** | Indien niet permanent, hoe lang |

> [!CAUTION]
> Permanente actieve toewijzingen omzeilen PIM volledig. Vermijd tenzij absoluut noodzakelijk.

---

## Vereiste Machtigingen

> [!IMPORTANT]
> Configuratie-operaties vereisen de `RoleManagementPolicy.ReadWrite.Directory` machtiging.

Zonder deze machtiging:
- Een waarschuwingsbanner wordt getoond
- Instellingenformulier werkt maar toepassen zal falen
- Je wordt gevraagd machtigingen te verlenen in Instellingen

Om machtigingen te verlenen:
1. Klik op de waarschuwingsbanner of ga naar **Instellingen**
2. Klik op **Schrijfmachtigingen Verlenen**
3. Voltooi de consent flow
4. Ververs de pagina

---

## Best Practices

### Kies de Juiste Modus

| Scenario | Aanbevolen Modus |
|----------|-----------------|
| Meerdere rollen/groepen configureren met volledige controle | **Wizard** |
| Snelle eenmalige beleidswijziging | **Handmatig** |
| Geëxporteerde CSV-instellingen op schaal toepassen | **Bulk** |

### Gebruik de Wizard voor Bulk Wijzigingen

De wizard zorgt ervoor dat je:
1. Actuele data hebt voor configureren
2. De juiste workloads selecteert
3. Scope controleert voor toepassing

### Standaardiseer Instellingen

1. Definieer organisatiebrede standaarden
2. Selecteer alle vergelijkbare rollen
3. Pas consistente instellingen toe

Voorbeeld standaarden:
- Alle geprivilegieerde rollen: 4u max, MFA vereist, goedkeuring vereist
- Alle standaard rollen: 8u max, MFA vereist

### Test Eerst

1. Selecteer één niet-kritieke rol
2. Pas instellingen toe
3. Verifieer in Azure Portal
4. Pas dan toe op andere rollen

### Documenteer Wijzigingen

1. Exporteer huidige instellingen (Rapportpagina)
2. Maak wijzigingen
3. Exporteer nieuwe instellingen
4. Vergelijk voor audit trail

---

## Probleemoplossing

### Schrijfmachtigingen Vereist

**Symptoom**: Waarschuwingsbanner "Schrijfmachtigingen vereist"

**Oplossing**:
1. Klik op **Instellingen Openen** op de banner
2. Verleen schrijfmachtigingen
3. Ververs en probeer opnieuw

### "Instellingen toepassen mislukt"

**Oorzaak**: Machtigingsproblemen of API-fouten

**Oplossing**:
1. Verifieer dat je `RoleManagementPolicy.ReadWrite.Directory` hebt
2. Controleer of rol beschermd is (bijv. Global Admin vereist Global Admin)
3. Controleer browserconsole voor gedetailleerde fout

### Wizard Status Verloren

**Oorzaak**: Sessie gewist of browser gesloten

**Oplossing**:
- Wizard status wordt alleen in geheugen opgeslagen (geen persistentie)
- Pagina verversen wist de status (by design)
- Browser sluiten wist de status
- Gebruik Handmatige modus voor snelle eenmalige wijzigingen

### Toewijzing Maken Mislukt

**Symptoom**: "Invalid role assignment request" fout

**Veelvoorkomende oorzaken**:
- **Machtigingen**: Controleer of je `RoleManagementPolicy.ReadWrite.Directory` hebt
- **Conflicterende toewijzing**: Gebruiker heeft mogelijk al een actieve toewijzing
- **Beleidsrestricties**: Het beleid van de rol blokkeert mogelijk bepaalde toewijzingstypes

**Oplossing**:
1. Bekijk de browserconsole voor gedetailleerde foutmeldingen
2. Controleer of de gebruiker niet al een toewijzing heeft voor deze rol
3. Als je een actieve toewijzing maakt, controleer of de rol permanente actieve toewijzingen toestaat (indien permanent geselecteerd)
4. Probeer met een andere rol om het probleem te isoleren

### Bulk Modus: Goedkeurder-wijzigingen Niet Toegepast

**Oorzaak**: Bulk modus ondersteunt alleen activatie-instellingen (duur, MFA, rechtvaardiging, goedkeuring toggle). Het toevoegen of verwijderen van goedkeurders vereist opzoeken van gebruikers-ID's en wordt niet ondersteund via CSV.

**Oplossing**: Gebruik **Wizard Modus** om goedkeurders te configureren.

### Bulk Modus: Toewijzingsverwijdering Heeft Geen Effect

**Oorzaak**: De rij had status **Already removed** — de toewijzing bestaat niet meer.

**Oplossing**: Controleer de preview-stap voor het toepassen. Rijen met status **Already removed** worden automatisch overgeslagen. Als je verwachtte dat de toewijzing zou bestaan, controleer dit op de Rapportpagina.

### "Permanent" Toggle Toont "Geblokkeerd door Beleid"

**Oorzaak**: De geselecteerde rol of groep heeft een PIM-beleid dat permanente toewijzingen verbiedt.

**Oplossing**: Gebruik een tijdgebonden toewijzing, of pas het rolbeleid eerst aan (via de Wizard Policies stap) om permanente toewijzingen toe te staan voordat je de toewijzing aanmaakt.

---

## Volgende Stappen

- [Rapportpagina](./08-rapport-pagina.md) - Bekijk je configuraties
- [Belangrijke Concepten](./06-belangrijke-concepten.md) - Begrijp terminologie
- [Architectuur](./00-architecture.md) - Technische details van de wizard

---

*Laatst bijgewerkt: 8 maart 2026*
