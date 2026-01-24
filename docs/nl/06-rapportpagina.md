# Rapportpagina

Dit document legt de functies en functionaliteit van de Rapportpagina uit, de hoofdweergave voor het analyseren van je PIM-configuratie.

---

## Overzicht

De Rapportpagina biedt een uitgebreide weergave van alle Microsoft Entra ID rollen en hun PIM-configuraties.

```
┌─────────────────────────────────────────────────────────┐
│                    Rapportpagina                        │
├─────────────────────────────────────────────────────────┤
│ [Filters]  [Zoeken]  [Export (PDF/CSV) ▼]  [Vernieuwen] │
├─────────────────────────────────────────────────────────┤
│ Toont 45 van 130 rollen                                 │
│            Rolconfiguratie ophalen op achtergrond (15/130)│
├─────────────────────────────────────────────────────────┤
│ ┌───────────────────────────────────────────────────┐   │
│ │ Global Administrator                   [Uitklappen]│   │
│ │ 👤 2 eligible │ ⚡ 1 actief │ 🔒 1 permanent       │   │
│ │ Tags: [Geprivilegieerd] [Ingebouwd] [PIM Config]  │   │
│ └───────────────────────────────────────────────────┘
│ ┌───────────────────────────────────────────────────┐
│ │ User Administrator                     [Uitklappen]│
│ │ 👤 5 eligible │ ⚡ 0 actief │ 🔒 3 permanent       │
│ └───────────────────────────────────────────────────┘
│ ...                                                     │
└─────────────────────────────────────────────────────────┘
```

---

## FunctIES

### 🔍 Zoeken

Typ in het zoekveld om rollen te filteren op naam.

- Zoekt in rol weergavenamen
- Niet hoofdlettergevoelig
- Realtime filteren
- **Drill-down Ondersteuning:** Ondersteunt directe navigatie vanuit Dashboard met voor-geselecteerde filters

---

### 👁️ Workload Toggles

Boven aan de pagina kun je de zichtbaarheid van verschillende PIM-workloads in- en uitschakelen:

- **Directory Rollen:** Toon/Verberg Entra ID rollen.
- **PIM Groepen:** Toon/Verberg PIM-enabled groepen.

> [!NOTE]
> Deze toggles zijn slim:
> 1. Ze onthouden je voorkeur (als je groepen verbergt, blijven ze verborgen).
> 2. Ze ondersteunen **Tijdelijke Filtering**: Als je navigeert vanaf het Dashboard via "Bekijk Volledig Rapport", wordt de weergave automatisch gefilterd om alleen die workload te tonen *zonder* je permanente instellingen te wijzigen.

---

### 🏷️ Filters

Filter rollen op verschillende criteria:

| Filter | Opties | Doel |
|--------|--------|------|
| **Roltype** | Ingebouwd, Custom | Scheid Microsoft rollen van je custom rollen |
| **Toewijzingstype** | Heeft Eligible, Heeft Actief, Heeft Permanent | Vind rollen met specifieke toewijzingstypes |
| **Lidtype** | Heeft Gebruikers, Heeft Groepen | Vind rollen toegewezen aan gebruikers vs groepen |
| **Max Duur** | <1u, 1-8u, 8-24u, >24u | Filter op maximale activatieduur |
| **Geprivilegieerd** | Alleen Geprivilegieerd, Niet-Geprivilegieerd | Focus op hoog-risico rollen |
| **PIM Status** | Geconfigureerd, Niet Geconfigureerd | Vind rollen zonder PIM-beleid |
| **Gebruiker** | Zoek op naam | Vind rollen toegewezen aan een specifieke gebruiker of groep |
| **Scope** | Tenant-breed, App-scoped, RMAU-scoped | Filter op toewijzingsscope |

> [!TIP]
> Combineer filters om krachtige queries te maken. Bijvoorbeeld: "Geprivilegieerd + Heeft Permanent" vindt hoog-risico rollen met permanente toewijzingen.

#### Scope Filter

De scope filter helpt je rollen te vinden op basis van waar ze worden toegepast:

| Scope Type | Beschrijving |
|------------|--------------|
| **Tenant-breed** | Rol is van toepassing op de hele directory (meest voorkomend) |
| **App-scoped** | Rol is beperkt tot een specifieke applicatie |
| **Admin Unit** | Rol is beperkt tot een Administrative Unit |
| **RMAU-scoped** | Rol is beperkt tot een Restricted Management Administrative Unit |

---

### 📊 Rolkaarten

Elke rol wordt weergegeven als een uitklapbare kaart.

#### Ingeklapte Weergave

Toont samenvattende informatie:
- Rolnaam
- Toewijzingsaantallen (eligible, actief, permanent)
- Tags die status aangeven

#### Uitgeklapte Weergave

Toont gedetailleerde informatie:
- **Toewijzingen Sectie**: Lijst van alle toegewezen gebruikers/groepen met scope badges
- **PIM Configuratie Sectie**: Toont beleidsinstellingen inclusief Authentication Context
- **Goedkeurders**: Als goedkeuring vereist is, toont wie kan goedkeuren

---

### 🏷️ Tags

Visuele indicatoren op elke rolkaart:

| Tag | Kleur | Betekenis |
|-----|-------|-----------|
| `Geprivilegieerd` | Rood | Microsoft classificeert deze rol als geprivilegieerd |
| `Ingebouwd` | Blauw | Door Microsoft geleverde rol |
| `Custom` | Paars | Je organisatie heeft deze rol gemaakt |
| `PIM Geconfigureerd` | Groen | Rol heeft PIM-beleid geconfigureerd |
| `Geen PIM` | Grijs | Geen PIM-beleid gevonden |

---

### 📥 Exporteer Opties

Je kunt data exporteren in meerdere formaten via het dropdown menu.

#### 📄 Exporteren naar PDF

Genereer een professioneel, direct bruikbaar beveiligingsrapport.

**Kenmerken:**
- **Aanpasbaar:** Kies welke secties je wilt opnemen (Overzicht, Grafieken, Alerts, Datatabellen).
- **Multi-Workload:** Ondersteunt zowel Directory Rollen als PIM Groepen.
- **Visualisaties:** Hoogwaardige grafieken met kleuren die passen bij de organisatie.
- **Metadata:** Bevat automatisch Tenant ID en Gebruiker UPN voor traceerbaarheid.

**Rapport Secties:**
1.  **Executive Summary:** Hoog-niveau statistieken (Totaal rollen, Actieve sessies, PIM-dekking).
2.  **Security Alerts:** Kritieke bevindingen met specifieke getroffen rollen/groepen en actiepunten.
3.  **Grafieken & Analyse:** Visuele verdeling van toewijzingstypes, lidtypes en duuroverzichten.
4.  **Datatabellen:** Gedetailleerde niet-visuele data ter ondersteuning van de grafieken.

#### 📊 Exporteren naar CSV

Exporteer ruwe data voor analyse in Excel of andere tools.

**Twee Opties:**

| Optie | Beschrijving | Gebruiksscenario |
|-------|--------------|------------------|
| **Role Summary** | Één rij per rol met beleidsconfiguratie | Overzicht van rolinstellingen |
| **Assignment Details** | Één rij per toewijzing | Gedetailleerde audit van wie toegang heeft |

> [!NOTE]
> Beide exports bevatten alleen de momenteel gefilterde rollen, niet alle rollen. Als je filtert op "Global Administrator", bevat het rapport alleen data voor die rol.

---

### 🔄 Vernieuwen

Klik "Vernieuwen" om:
1. Gecachte data te wissen
2. Verse data op te halen van Microsoft Graph
3. Achtergrond policy laden te herstarten

---

## Toewijzingstypes Uitgelegd

### Eligible Toewijzingen

Gebruikers/groepen die de rol **kunnen activeren** via PIM.

```
Alice ──[Eligible]──> Global Admin
         │
         └── Moet activeren via PIM voor gebruik
```

### Actieve Toewijzingen

Momenteel **geactiveerde** PIM-toewijzingen.

```
Bob ──[Actief]──> Global Admin (Verloopt in 4 uur)
       │
       └── Geactiveerd en momenteel in gebruik
```

### Permanente Toewijzingen

Directe roltoewijzingen die **PIM omzeilen**.

```
Carol ──[Permanent]──> Global Admin
         │
         └── Heeft deze rol altijd (geen activatie nodig)
```

> [!WARNING]
> Permanente toewijzingen moeten worden geminimaliseerd. Ze omzeilen PIM-beschermingen zoals MFA, goedkeuring en tijdslimieten.

---

## PIM Configuratie Details

Wanneer een rol is uitgeklapt, zie je de PIM-instellingen:

### Activatie Tab

| Instelling | Beschrijving |
|------------|--------------|
| Max Duur | Maximale tijd dat een gebruiker kan activeren (bijv. 8 uur) |
| Vereis MFA | Moet MFA voltooien om te activeren |
| Vereis Rechtvaardiging | Moet reden opgeven voor activatie |
| Vereis Goedkeuring | Moet worden goedgekeurd door goedkeurders |
| Goedkeurders | Wie activatieverzoeken kan goedkeuren |

### Toewijzing Tab

| Instelling | Beschrijving |
|------------|--------------|
| Permanent Eligible Toegestaan | Mogen eligible toewijzingen onbeperkt geldig zijn? |
| Max Eligible Duur | Maximale duur voor eligible toewijzingen |
| Permanent Actief Toegestaan | Mogen actieve toewijzingen onbeperkt geldig zijn? |
| Max Actieve Duur | Maximale duur voor actieve toewijzingen |

---

## Laadstatussen

### Initiële Lading

```
[==================== ] 80%
Toewijzingen ophalen...
```

Toont voortgang door Fase 1 (definities + toewijzingen).

### Achtergrond Policy Laden

```
Rolconfiguratie ophalen op achtergrond... (45/130)
```

Toont voortgang door Fase 2 (policy laden).

### Rol-Specifiek Laden

Wanneer je op een rol klikt voordat de policy is geladen:

```
Configuratie laden...
```

Geeft aan dat prioriteit ophalen bezig is.

### Geen Configuratie Gevonden

```
Geen Configuratie Gevonden
```

Rol bestaat maar heeft geen PIM-beleid geconfigureerd.

> [!TIP]
> Rollen zonder PIM-beleid moeten worden beoordeeld. Overweeg PIM te configureren voor gevoelige rollen.

---

## Probleemoplossing

### Rollen verschijnen niet

**Oorzaak**: Filters zijn te restrictief

**Oplossing**: Wis filters of controleer filtercombinaties

### "Configuratie laden..." blijft hangen

**Oorzaak**: API-fout of throttling

**Oplossing**:
1. Controleer browserconsole op fouten
2. Wacht een paar minuten en vernieuw

### Export is leeg

**Oorzaak**: Alle rollen zijn uitgefilterd

**Oplossing**: Wis filters of pas zoekopdracht aan

---

## Volgende Stappen

- [Configuratiepagina (Gepland)](./07-configuratiepagina.md) - Bekijk geplande functionaliteit
- [Dataflow](./03-dataflow.md) - Begrijp hoe data laadt
