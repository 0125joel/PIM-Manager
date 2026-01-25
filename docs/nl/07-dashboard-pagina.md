# Dashboard Pagina

Het Dashboard is de centrale hub voor het monitoren van je Privileged Identity Management (PIM) configuratie. Het biedt inzichten in roltoewijzingen, policies, beveiligingsinstellingen en gebruikersactiviteit.

---

## Overzicht

**Doel:** Real-time zichtbaarheid in PIM-dekking en toewijzingsdistributie voor Directory Roles en PIM Groups.

**Belangrijkste Mogelijkheden:**
- Beveiligingsanalyse via analytische grafieken
- Identificatie van configuratieproblemen en verlopende toewijzingen
- Workload-gebaseerde data filtering
- Interactieve filtering die doorloopt naar Report pagina
- PDF export voor compliance rapportage

---

## Weergavemodi

Het Dashboard ondersteunt twee weergavemodi:

### Basismodus
**Voor:** Snel overzicht en high-level inzichten

**Toont:**
- 4 Overzichtskaarten (Totaal Rollen, Actieve Sessies, Permanente Toewijzingen, PIM-dekking)
- 2 Beveiligingsgrafieken (Toewijzingsdistributie, MFA & CA Handhaving)
- Security Alerts panel
- Pro Tips carrousel
- Roloverzicht (5 rollen)
- Groepsoverzicht (5 groepen)

### Geavanceerde Modus
**Voor:** Diepgaande analyse en gedetailleerde metrics

**Toont:**
- 7 Overzichtskaarten (voegt toe: Eligible Toewijzingen, Custom Rollen, Goedkeuring Vereist)
- 7 Beveiligingsgrafieken (alle beschikbare grafieken)
- Recente Activaties tijdlijn
- Binnenkort Verlopend alerts
- Top Gebruikers ranglijst
- Goedkeurders Overzicht
- Configuratiefouten widget
- Rol & Groepen Overzicht

**Toggle:** Klik op "Basis" of "Geavanceerd" knop in header. Modus blijft bewaard in localStorage.

---

## Dashboard Componenten

### Overzichtskaarten

High-level PIM metrics weergegeven als interactieve kaarten.

**Basismodus (4 kaarten):**
1. **Totaal Rollen** - Alle opgehaalde rollen (of "Totaal Items" als groepen ingeschakeld)
2. **Actieve Sessies** - Momenteel actieve toewijzingen
3. **Permanente Toewijzingen** - Always-on toegang
4. **PIM-dekking** - % van bevoorrechte rollen met policies

**Geavanceerde Modus (3 extra kaarten):**
5. **Eligible Toewijzingen** - Gebruikers klaar om te activeren
6. **Custom Rollen** - Aantal niet-ingebouwde rollen
7. **Goedkeuring Vereist** - Rollen met goedkeuringsworkflows

**Interactie:** Klik op kaart om filter toe te passen op dashboard data.

---

### Beveiligingsgrafieken

Multi-dimensionale analyse van PIM configuratie en toewijzingsdistributie.

| Grafiek | Modus | Doel | Interactief |
|---------|-------|------|-------------|
| Toewijzingsdistributie | Beide | Permanent vs Eligible (rollen + groepen) | Ja |
| MFA & CA Handhaving | Beide | Azure MFA / Conditional Access / Geen | Ja |
| Toewijzingsmethode | Geavanceerd | Directe gebruiker vs Groepstoewijzingen (alleen rollen) | Ja |
| Goedkeuringsvereisten | Geavanceerd | Rollen/Groepen die goedkeuring vereisen | Ja |
| Max Duur Distributie | Geavanceerd | Histogram van activatieduurlimieten | Ja |
| Authenticatie Contexten | Geavanceerd | CA contexten in gebruik (alleen rollen) | Ja |
| PIM Groups Dekking | Geavanceerd | Managed vs Unmanaged groepen | Nee |

**Speciale Features:**
- **"Alleen" vs "Heeft Enige" modus** voor Toewijzingsdistributie en Toewijzingsmethode
- **"Bevoorrecht" vs "Alle Rollen" toggle** voor MFA grafiek
- **Kleurgecodeerde duur buckets** (Groen <1u tot Rood >12u)
- **Respecteert workload toggles** - grafieken passen aan op basis van ingeschakelde workloads

**Interactie:** Klik op grafieksegment om filter toe te passen.

---

### Security Alerts

**Bestand:** `SecurityAlerts.tsx`
**Zichtbaarheid:** Alleen basismodus

Toont Microsoft's ingebouwde PIM beveiligingsaanbevelingen.

**Statussen:**
- **Toestemming niet verleend:** Slot icoon + "Security Alerts Inschakelen" knop
- **Laden:** Spinner
- **Fout:** Alert driehoek + retry knop
- **Succes:** Uitklapbare alert kaarten

**Features:**
- **Uitklapbare alerts** - Klik voor volledige beschrijving
- **Alerts verbergen** - Verberg individuele alerts (session-stored)
- **Geslaagde checks** - Inklapbare lijst van geslaagde checks
- **Alles herstellen** - Verborgen lijst wissen

**Toestemming:** Vereist `RoleManagementAlert.Read.Directory` scope

---

### Rol & Groepen Overzicht

**Roloverzicht (`DashboardRoleOverview.tsx`):**
- Zoekvak + filter dropdown
- 5 meest relevante rollen
- Elke rolrij linkt naar gedetailleerd rapport

**Groepsoverzicht (`GroupsOverview.tsx`):**
- Stat kaarten: Eligible/Active members en owners
- **Unmanaged Groups Alert** - Rode banner als groepen PIM omzeilen
- 5 meest relevante groepen
- Groepstype badges (Security, M365, Mail-enabled)

**Zoekfilters:**
- Alle rollen
- Alleen bevoorrecht
- PIM geconfigureerd

**Navigatie:** Klik op rol/groep → navigeert naar `/report?search={naam}`

---

### Recente Activaties (Alleen Geavanceerd)

**Bestand:** `RecentActivations.tsx`

Tijdlijnweergave van laatste 10 rolactivaties.

**Features:**
- Tijdlijnlay-out met stippen en verbindingslijnen
- Verloop badges (indien tijdgebonden)
- Principal type indicator (Gebruiker/Groep)
- Privilege level indicator (amber voor bevoorrechte rollen)
- "Verlopen" status voor eerdere activaties

---

### Binnenkort Verlopend (Alleen Geavanceerd)

**Bestand:** `ExpiringSoon.tsx`

Alert voor toewijzingen die binnen 7 dagen verlopen.

**Features:**
- Volgende 10 eerst-verlopende toewijzingen
- Kleurgecodeerde urgentie:
  - Rood: ≤1 dag
  - Oranje: ≤3 dagen
  - Geel: >3 dagen
- Aftelling weergave: "Vandaag", "Morgen", "Xd"

---

### Top Gebruikers (Alleen Geavanceerd)

**Bestand:** `TopUsers.tsx`

Identificeer gebruikers met meeste bevoorrechte toegang.

**Metrics per gebruiker:**
- Totaal aantal toewijzingen
- Uitsplitsing: X Permanent, Y Eligible, Z Actief
- Uniek rollenantal
- Ranglijst badge (1e goud, 2e zilver, 3e brons)

Toont top 10 gebruikers gesorteerd op totaal aantal toewijzingen.

---

### Goedkeurders Overzicht (Alleen Geavanceerd)

**Bestand:** `ApproversOverview.tsx`

Toont wie rolactivaties kan goedkeuren.

**Data per goedkeurder:**
- Naam en email
- Aantal rollen dat ze goedkeuren
- Top 10 goedkeurders (op rollenantal)

---

### Configuratiefouten (Alleen Geavanceerd)

**Bestand:** `ConfigurationErrors.tsx`

Benadrukt rollen met fetch/configuratiefouten.

**Fouttypes:**
- 404: Niet Gevonden
- 403: Toegang Geweigerd
- 429: Rate Limited
- Overige: Generieke fouten

**Features:**
- Gegroepeerd op fouttype
- Toont tot 3 rollen per type, "+X meer" indicator
- Refresh knop om mislukte fetches opnieuw te proberen
- Succestatus: Groen vinkje

---

### Pro Tip (Alleen Basismodus)

**Bestand:** `ProTip.tsx`

Educatieve carrousel met PIM best practices.

**Features:**
- 10 roterende tips over PIM configuratie
- Auto-roteert elke 8 seconden
- Pauzeer/hervat knop
- Vorige/volgende navigatie
- Stipindicatoren (klikbaar)
- "Meer informatie" link naar Microsoft docs

**Tips behandeld:** Eligible toewijzingen, goedkeuringsworkflows, activatieduur, access reviews, MFA handhaving, global admin limieten, security alerts, rechtvaardiging, authenticatie contexten, break-glass accounts

---

## Workload Management

### Workload Chips

Rij van gekleurde chips die actieve workloads tonen met tandwiel knop om Instellingen te openen.

**Chips:**
1. **Directory Roles** (Shield icoon) - Blauw wanneer zichtbaar
2. **Security Alerts** (Alert icoon) - Toggle onder Directory Roles
3. **PIM Groups** (Users icoon) - Blauw wanneer zichtbaar
4. **Unmanaged Groups** (ShieldOff icoon) - Toggle onder PIM Groups

**Gedrag:**
- Verborgen chips tonen met doorstreepte tekst + EyeOff icoon
- Kan niet alle workloads verbergen (minimaal 1 actief)
- URL override: `?workload=pimGroups` toont alleen die workload

### Instellingen Modal

**Tabbladen:**

**Workloads Tab:**
- In-/uitschakelen workloads (vereist toestemming)
- Toon/verberg workloads (zichtbaarheidstoggle)
- Sub-features management (bijv. Security Alerts)

**Developer Tab:**
- Log Level selector (INFO / DEBUG)
- Console gebruiksinstructies

**Workload Statussen:**
- **Niet ingeschakeld** - Blauwe "Inschakelen" knop (triggert toestemming)
- **Ingeschakeld + Zichtbaar** - "Verbergen" knop beschikbaar
- **Ingeschakeld + Verborgen** - "Tonen" knop beschikbaar
- **Vergrendeld** - "Altijd aan" badge (Directory Roles)

**Persistentie:** localStorage met prefixes `pim_visibility_` en `pim_feature_enabled_`

---

## Filtersysteem

### Hoe Filtering Werkt

1. **URL Parameters** - Gelezen via `useSearchParams()`
   - Voorbeeld: `/dashboard?assignmentType=permanent&memberType=direct`

2. **Universele Filter Hook** - `useRoleFilters()`
   - Leest URL → parseert parameters
   - Filtert data in real-time
   - Biedt: `filteredRoles`, `hasActiveFilters`, `resetFilters()`

3. **Interactieve Triggers:**
   - Klik op taartdiagramsegment
   - Klik op overzichtskaart
   - Gebruik actieve filters banner knoppen

4. **Ondersteunde Filters:**
   - `assignmentType`: permanent, eligible, active
   - `memberType`: direct, group
   - `mfaType`: azure-mfa, ca-any, none
   - `approval`: yes, no
   - `maxDuration`: <1h, 2-4h, 5-8h, 9-12h, >12h
   - `privileged`: true, false
   - `pimConfigured`: configured
   - `roleType`: custom

5. **Actieve Filters Banner:**
   - Toont filteraantal
   - "Rapport Bekijken" knop linkt naar rapport met zelfde filters behouden
   - "Alle filters wissen" knop reset

---

## Navigatie naar Rapport

**Links naar Rapport Pagina:**

| Component | Link | Gedrag |
|-----------|------|--------|
| Actieve Filters Banner | "Rapport Bekijken" | `/report?{alle huidige URL params}` |
| Roloverzicht | Rolrij klik | `/report?search={rol.naam}` |
| Roloverzicht footer | "Volledig rapport bekijken" | `/report?workload=directoryRoles` |
| Groepsoverzicht | Groepsrij klik | `/report?search={groep.naam}` |
| Groepsoverzicht footer | "Volledig rapport bekijken" | `/report?workload=pimGroups` |

---

## Databronnen

**Contexten & Hooks:**

| Databron | Doel |
|----------|------|
| `usePimData()` | Directory roles + toewijzingen + policies |
| `useUnifiedPimData()` | PIM Groups + workload management |
| `useRoleFilters()` | Universeel filtersysteem |
| `useSecurityAlerts()` | Microsoft security alerts API |
| `useAggregatedData()` | Gecombineerde rollen + groepen metrics |
| `useViewMode()` | Basis/Geavanceerd toggle status |

---

## PDF Export

**Getriggerd door:** "Export PDF" knop in header

**Export Bevat:**
- Alle zichtbare grafieken (gebaseerd op workload selectie)
- Gefilterde rollen/groepen data
- Tenant ID en gebruikersinfo
- Security alerts (indien toestemming verleend)
- Filter samenvatting (indien actief)

**Componenten:** `PdfExportModal` voor aanpassing

---

## Data Verversen

**Ververs Mechanisme:**
- **Knop:** "Data verversen" (rechtsboven)
- **Handler:** Roept `refreshAllWorkloads()` aan van UnifiedPimContext
- **Uitgeschakeld wanneer:** Data laden of policies laden

**Laadindicatoren:**
- `LoadingStatus` component toont huidige laadstatus
- `SyncStatus` component toont laatste sync tijd
- Spinner op Ververs knop tijdens laden

**Auto-refresh:** Bij component mount als geen data en geen fout

---

## Gebruikersinteracties Samenvatting

| Interactie | Resultaat |
|------------|-----------|
| Toggle weergavemodus | Schakel dashboard complexiteit |
| Bekijk Workload instellingen | Open Instellingen modal |
| Verberg/toon workload | Verberg/toon data + grafieken |
| Filter toepassen | URL bijgewerkt, data gefilterd |
| Rapport Bekijken | Navigeer naar `/report` met filters |
| Data verversen | Haal alle workloads opnieuw op |
| Exporteer naar PDF | Open export modal |
| Zoek rollen/groepen | Filter weergegeven items |
| Vouw alert uit | Toon volledige beschrijving |
| Verberg alert | Verberg alert (session-stored) |
| Pauzeer Pro Tips | Stop auto-rotatie |

---

## Volgende Stappen

- [Rapport Pagina](./07-rapport-pagina.md) - Gedetailleerde configuratieweergave
- [Belangrijke Concepten](./05-belangrijke-concepten.md) - PIM-terminologie begrijpen
- [Dataflow](./03-dataflow.md) - Hoe data opgehaald en verwerkt wordt
