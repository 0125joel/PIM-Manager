# Dashboard Pagina

Het Dashboard is de centrale hub voor het monitoren van je Privileged Identity Management (PIM) configuratie. Het biedt inzichten in roltoewijzingen, policies, beveiligingsinstellingen en gebruikersactiviteit.

---

## Overzicht

**Doel:** Realtime inzicht in PIM-dekking en de verdeling van toewijzingen over Directory Roles en PIM for Groups.

**Paginakop:** de titel, een Basic- of Advanced-schakelaar, in Advanced een schakelaar Privileged roles of All roles, "synced N min ago", Refresh (slim verversen) en Export. Eronder de "counting"-chips (Directory roles, PIM for Groups, Unmanaged groups, Security alerts) die bepalen welke workloads op deze pagina meetellen; een workload zonder toestemming toont een gestippelde chip met slot die de toestemming start.

**Filter:** een klik op een kaart, legenda-rij of Easy to miss-rij zet precies een filter, bewaard in de URL als `f` (bijvoorbeeld `/dashboard?f=mfa:neither`). Een balk onder de chips toont het filter als verwijderbare chip, een zin met het aantal en "Open in report with this filter". Escape wist het filter.

---

## Weergavemodi

### Basic

Acht kaarten (4 bij 2), daarna in twee kolommen: **Has access** (donut permanent, eligible, active time-bound) en **On activation** (Entra MFA, auth context, neither, met approval, justification en over 8 h), **Role-assignable groups outside PIM** en **From Microsoft** (de eigen PIM-alerts, rijen klappen inline open), **Easy to miss** (zes rijen in drie categorieen) en een **tipbalk** met tips die uit de tenant worden berekend. Elk getal staat gedefinieerd in `utils/dashboardStats.ts` en is getest met een fixture.

### Advanced

Dezelfde kop en kaarten, daarna vijf secties over de volle breedte: **Has access, and how**, **On activation** (grafieken voor MFA, approval, justification en maximale duur voor privileged of alle rollen, plus de lijst custom extensions), **PIM for Groups**, **Most privileged, and who approves** (top 6 accounts, approvers, een waarschuwing bij rollen met een approver) en **Right now** (lopende activeringen, eligibility die binnen 7 dagen eindigt). De secties gebruiken de hele tenant en worden gedimd zolang een filter actief is.

---

## Kaarten

| Kaart | Getal |
|-------|-------|
| Roles and groups | Roldefinities plus onboarded groepen die meetellen |
| Active now | Actieve toewijzingen die door activering zijn ontstaan |
| Permanent | Actieve toewijzingen zonder einde door een beheerder |
| Eligible | Eligibility-schema's en -instanties |
| Privileged roles | Rollen met `isPrivileged` (All roles in Advanced: alle rollen) |
| Require approval | Privileged rollen waarvan het beleid goedkeuring vereist |
| Custom roles | Rollen die niet ingebouwd zijn |
| Groups under PIM | Aandeel onboarded groepen van de role-assignable groepen |

Getallen die van beleid afhangen tonen een plaatshouder tot het beleid geladen is; een mislukte lading toont een streepje en de reden.

---

## Toestanden

- **Laden:** skeletons, een voortgangslijn en een statuszin; nooit een 0 voor een onbekende waarde.
- **Geen toestemming:** een kader met slot en "Grant read access".
- **Alles in orde:** een succesregel ("No alerts. 7 checks passed.").
- **Mislukt:** een kader met de oorzaak (statuscode na pogingen), Try again en Dismiss; nooit een toast.

---

## Workload Management

### Workload Chips

Rij van gekleurde chips die actieve workloads tonen met tandwiel knop om Instellingen te openen.

**Chips:**
1. **Directory Roles** (Shield icoon) - Blauw wanneer zichtbaar
2. **Security Alerts** (Alert icoon) - Toggle onder Directory Roles
3. **PIM for Groups** (Users icoon) - Blauw wanneer zichtbaar
4. **Unmanaged Groups** (ShieldOff icoon) - Toggle onder PIM for Groups

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

Een filtermodel voor dashboard en rapport (`utils/dashboardFilter.ts`): `assignment`, `privileged`, `approval`, `mfa`, `justification`, `maxDuration`, `principalType`, `noEndDate`, `activationNotification`, `hasEligible`, `roleTemplateId`, `customRole`, `excludeEmergency`. Een klik zet precies een filter, meerdere sleutels worden `f=sleutel:waarde,sleutel:waarde`. Een filter op een activatieterm zonder `privileged` wordt als privileged rollen toegepast. "Open in report with this filter" neemt het filter mee naar `/report?f=...`, waar het rapport dezelfde functies toepast, zodat beide dezelfde rollen tonen.

---

## Navigatie naar Rapport

| Component | Link | Gedrag |
|-----------|------|--------|
| Filterbalk | "Open in report with this filter" | `/report?f={filter}` |
| Advanced PIM for Groups | "All in report" | `/report` |

---

## Databronnen

**Contexten & Hooks:**

| Databron | Doel |
|----------|------|
| `usePimData()` | Directory roles + toewijzingen + policies |
| `useUnifiedPimData()` | PIM for Groups + workload management |
| `useDashboardFilter()` | Het filter `f` in de URL |
| `useSecurityAlerts()` | Microsoft security alerts API |
| `useDashboardScope()` | Privileged of All roles (Advanced) |
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

**Componenten:** `ExportDialog` (PDF of CSV; de CSV heeft de kolommen van het Overview-toewijzingenbestand van de Report, `utils/exportSchema.ts`; detail, doelgroep, namen, grafiekstijl, workloads, filter, inhoudsblokken); de inhoud komt uit `utils/exportReport.ts` en `components/pdf/ReportDocument.tsx` tekent hem

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
