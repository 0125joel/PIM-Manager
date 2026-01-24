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

Filter rollen en groepen op verschillende criteria:

**Directory Roles Filters:**

| Filter | Opties | Doel |
|--------|--------|------|
| **Roltype** | Ingebouwd, Custom | Scheid Microsoft rollen van je custom rollen |
| **Toewijzingstype** | Heeft Eligible, Heeft Actief, Heeft Permanent, Heeft Toewijzingen (Any) | Vind rollen met specifieke toewijzingstypes |
| **Lidtype** | Heeft Gebruikers, Heeft Groepen | Vind rollen toegewezen aan gebruikers vs groepen |
| **Max Duur** | <1u, 2-4u, 5-8u, 9-12u, >12u | Filter op maximale activatieduur (granulaire buckets) |
| **Geprivilegieerd** | Alleen Geprivilegieerd, Niet-Geprivilegieerd | Focus op hoog-risico rollen |
| **PIM Status** | Geconfigureerd, Niet Geconfigureerd | Vind rollen zonder PIM-beleid |
| **MFA Vereist** | Ja, Nee | Vind rollen die Azure MFA of Conditional Access vereisen |
| **Goedkeuring Vereist** | Ja, Nee | Vind rollen met goedkeuringsworkflows |
| **Rechtvaardiging Vereist** | Ja, Nee | Vind rollen die activatierechtvaardiging vereisen |
| **Gebruiker** | Zoek op naam/email | Vind rollen toegewezen aan een specifieke gebruiker of groep |
| **Scope** | Tenant-breed, App, Admin Unit, RMAU | Filter op toewijzingsscope |

**PIM Groups Filters:**

| Filter | Opties | Doel |
|--------|--------|------|
| **Groepstype** | Security, M365, Mail-enabled Security | Filter op Azure AD groepstype |
| **Toegangstype** | Member, Owner | Filter op rol in groep (Member vs Owner toewijzingen) |
| **PIM Status** | Managed, Unmanaged | Vind groepen met/zonder PIM-beleid |
| **Toewijzingstype** | Heeft Eligible, Heeft Actief, Heeft Permanent | Zelfde als rollen maar voor groepstoewijzingen |

> [!TIP]
> Combineer filters om krachtige queries te maken. Bijvoorbeeld: "Geprivilegieerd + Heeft Permanent" vindt hoog-risico rollen met permanente toewijzingen. Of "Unmanaged + Groepstype: Security" vindt beveiligingslacunes.

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

> [!NOTE]
> **PDF Export** is beschikbaar vanaf de Dashboard pagina. De Rapport pagina biedt CSV en JSON exports voor gedetailleerde data-analyse.

#### 📊 Exporteren naar CSV

Exporteer ruwe data voor analyse in Excel of andere tools.

**Vier Export Types:**

| Optie | Beschrijving | Gebruiksscenario |
|-------|--------------|------------------|
| **Role Summary** | Één rij per rol met beleidsconfiguratie | Overzicht van Directory Roles instellingen |
| **Assignment Details** | Één rij per toewijzing | Gedetailleerde audit van wie toegang heeft tot rollen |
| **Group Summary** | Één rij per groep met Member/Owner beleidsregels | Overzicht van PIM Groups configuratie |
| **Group Assignments** | Één rij per groepstoewijzing | Audit van groepslidmaatschappen |

**CSV Velden Bevatten:**
- Rol/Groep naam, type en scope
- Toewijzingstypes (Eligible, Active, Permanent) met aantallen
- Beleidsinstellingen (MFA, Approval, Max Duration)
- Principal details (User/Group, UPN, Email)
- Schema informatie (Start, End, Expiration)

#### 📄 Exporteren naar JSON

Exporteer gecombineerde data in JSON formaat voor programmatische verwerking.

**Kenmerken:**
- **Gecombineerde data:** Rollen + Groepen in één bestand
- **Volledige details:** Alle eigenschappen en geneste objecten behouden
- **Machine-leesbaar:** Eenvoudig te parsen voor scripts en automatisering

**JSON Structuur:**
```json
{
  "roles": [...],
  "groups": [...],
  "metadata": {
    "exportDate": "2026-01-24T12:00:00Z",
    "tenantId": "...",
    "userPrincipalName": "..."
  }
}
```

> [!NOTE]
> Exports respecteren je huidige actieve filters. Als je filtert op "Global Administrator", bevat de export alleen data voor die rol.

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

### Notificatie Tab

**Voor Directory Roles:**

| Instelling | Beschrijving |
|------------|--------------|
| Admin Notificaties | Admins worden geïnformeerd over eligible toewijzingen, actieve toewijzingen |
| Eindgebruiker Notificaties | Gebruikers worden geïnformeerd wanneer rollen worden geactiveerd |
| Goedkeurder Notificaties | Goedkeurders worden geïnformeerd over activatieverzoeken |

Elk notificatietype kan hebben:
- Standaard ontvangers (admins, aanvragers, goedkeurders)
- Aanvullende ontvangers (specifieke gebruikers/groepen)
- Alleen kritieke notificaties vlag

---

## PIM Groups Configuratie

PIM Groups hebben unieke kenmerken vergeleken met Directory Roles:

### Member vs Owner Policies

Elke PIM Group heeft **twee afzonderlijke beleidsregels**:
- **Member Policy**: Regelt groepslidmaatschap toewijzingen
- **Owner Policy**: Regelt groepseigenaar toewijzingen

Beide beleidsregels hebben dezelfde drie tabs (Activatie, Toewijzing, Notificatie) maar met onafhankelijke instellingen.

### Managed vs Unmanaged Groups

| Status | Beschrijving |
|--------|--------------|
| **Managed** | Groep heeft PIM-beleid geconfigureerd (Member/Owner) |
| **Unmanaged** | Groep is `isAssignableToRole: true` maar heeft geen PIM-beleid |

**Waarom onbeheerde groepen belangrijk zijn:**
- Groepen met `isAssignableToRole: true` kunnen geprivilegieerde rollen krijgen
- Zonder PIM-beleid ontbreken just-in-time toegangscontroles
- Potentieel veiligheidsrisico voor privilege escalatie

> [!WARNING]
> Onbeheerde role-assignable groepen moeten worden beoordeeld. Overweeg PIM in te schakelen of de `isAssignableToRole` vlag te verwijderen als niet nodig.

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

- [Configuratie Pagina (Gepland)](./08-configuratie-pagina.md) - Bekijk geplande functionaliteit
- [Dataflow](./03-dataflow.md) - Begrijp hoe data laadt
