# PIM Manager - Architecture Design Document

Dit document beschrijft de volledige architectuur en ontwerpbeslissingen van de PIM Manager applicatie.

## Inhoudsopgave
1. [Overzicht](#overzicht)
2. [Ontwerpprincipes & Kwaliteitsrichtlijnen](#ontwerpprincipes--kwaliteitsrichtlijnen)
3. [Technische Stack](#technische-stack)
4. [Microsoft Entra ID Integratie](#microsoft-entra-id-integratie)
5. [Multi-Workload Architectuur](#multi-workload-architectuur)
6. [Data Flow](#data-flow)
7. [State Management](#state-management)
8. [Performance Optimalisaties](#performance-optimalisaties)
9. [UI/UX Ontwerpbeslissingen](#uiux-ontwerpbeslissingen)
10. [Toekomstige Workloads](#toekomstige-workloads)
11. [Context Diagram](#context-diagram)
12. [Kwaliteitsattributen (NFRs)](#kwaliteitsattributen-nfrs)
13. [Architectural Decision Records (ADRs)](#architectural-decision-records-adrs)
14. [Security Architectuur](#security-architectuur)
15. [Foutafhandeling](#foutafhandeling)
16. [Deployment Architectuur](#deployment-architectuur)

---

## Overzicht

PIM Manager is een client-side Next.js applicatie voor het beheren en visualiseren van Microsoft Entra ID Privileged Identity Management (PIM) configuraties. De app ondersteunt meerdere PIM workloads:

- **Directory Roles** (Entra ID Roles) - Volledig geïmplementeerd
- **PIM for Groups** - Volledig geïmplementeerd
- **Intune Roles** - Gepland (Fase 4)
- **Exchange Roles** - Gepland (Fase 4)

### Kernprincipes

1. **Client-side only** - Geen backend server, alle data verwerking in de browser
2. **Static Export** - Deployable op Cloudflare Pages, GitHub Pages, etc.
3. **Incremental Consent** - Gebruikers geven alleen toestemming voor workloads die ze activeren
4. **Performance First** - Parallelle data fetching met worker pools
5. **Progressive Loading** - UI reageert direct, data laadt op de achtergrond

---

## Ontwerpprincipes & Kwaliteitsrichtlijnen

### Modulariteit

De applicatie is opgebouwd uit **losjes gekoppelde modules** die onafhankelijk ontwikkeld en getest kunnen worden:

```
┌─────────────────────────────────────────────────────────────┐
│                        Presentation Layer                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │ Dashboard│  │ Report   │  │ Settings │  │ Help     │    │
│  │ Page     │  │ Page     │  │ Modal    │  │ Modal    │    │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘    │
└───────┼─────────────┼─────────────┼─────────────┼──────────┘
        │             │             │             │
┌───────┼─────────────┼─────────────┼─────────────┼──────────┐
│       ▼             ▼             ▼             ▼          │
│                     Component Layer                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │ Stat     │  │ Charts   │  │ Report   │  │ Loading  │    │
│  │ Cards    │  │          │  │ Filters  │  │ Status   │    │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘    │
└───────┼─────────────┼─────────────┼─────────────┼──────────┘
        │             │             │             │
┌───────┼─────────────┼─────────────┼─────────────┼──────────┐
│       ▼             ▼             ▼             ▼          │
│                      Hooks Layer                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │useAggregated │  │useDashboard  │  │useIncremental│      │
│  │Data          │  │Filter        │  │Consent       │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
└─────────┼─────────────────┼─────────────────┼──────────────┘
          │                 │                 │
┌─────────┼─────────────────┼─────────────────┼──────────────┐
│         ▼                 ▼                 ▼              │
│                     Context Layer                           │
│  ┌────────────────┐  ┌────────────────┐                    │
│  │ UnifiedPim     │  │ Configure      │                    │
│  │ Context        │  │ BasketContext  │                    │
│  └───────┬────────┘  └───────┬────────┘                    │
└──────────┼───────────────────┼─────────────────────────────┘
           │                   │
┌──────────┼───────────────────┼─────────────────────────────┐
│          ▼                   ▼                              │
│                     Service Layer                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │directoryRole │  │pimGroup      │  │pimApi        │      │
│  │Service       │  │Service       │  │              │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

**Richtlijnen:**
- Elke module heeft één verantwoordelijkheid (Single Responsibility)
- Modules communiceren via props, contexts of hooks - nooit direct. Eén uitzondering: `app/configure/**` (de paginacontainer en zijn edit-componenten) mag rechtstreeks uit `services/` importeren (aanroepen gebeuren in event handlers en effects, nooit tijdens render), zie `AGENTS.md` en `docs/architecture/code-map.md`
- Nieuwe workloads voegen toe zonder bestaande code aan te passen

### Clean Code

De codebase volgt strikte clean code principes:

| Principe | Toepassing in PIM Manager |
|----------|---------------------------|
| **Meaningful Names** | `directoryRoleService.ts` niet `roleData.ts`, `useAggregatedData` niet `useData` |
| **Small Functions** | Max ~50 regels per functie, helper functies voor complexe logica |
| **DRY (Don't Repeat)** | `workerPool.ts` utility hergebruikt door alle services |
| **Consistent Formatting** | ESLint (`eslint-config-next`) zonder tolerantie: `npm run lint` moet 0 problemen melden |
| **Type Safety** | Strikte TypeScript types voor alle interfaces |
| **Error Handling** | Try-catch met duidelijke foutmeldingen, never silent fail |

**Naamgeving Conventies:**

```typescript
// Files
directoryRoleService.ts    // {domain}Service.ts
pimGroup.types.ts          // {domain}.types.ts
useAggregatedData.ts       // use{Purpose}.ts

// Functions
fetchAllPimGroupData()     // verb + noun + context
computeGroupStats()        // verb + what it computes
getBreakdownDescription()  // get + what it returns

// Interfaces
interface WorkloadState    // PascalCase, descriptive
type GroupAccessType       // Type aliases for unions
```

### Herbruikbaarheid

Componenten en utilities zijn ontworpen voor **maximale herbruikbaarheid**:

| Component/Utility | Hergebruikt in |
|-------------------|----------------|
| `ui/StatCard` | Dashboardkaarten (knop als de kaart een filter zet) |
| `LoadingStatus` | Dashboard header, Report header |
| `GlobalProgressBar` | Alle pagina's (via layout) |
| `workerPool.ts` | directoryRoleService, pimGroupService, future services |
| `useAggregatedData` | Dashboard- en rapportcomponenten |

**Design Pattern: Composition over Inheritance**

```tsx
// Niet: Props drilling
<Dashboard>
  <Cards rolesData={...} groupsData={...} loading={...} />
</Dashboard>

// Wel: Hook-based data access
function OverviewCards() {
  const aggregated = useAggregatedData();  // Haalt zelf data op
  return <Cards value={aggregated.totalItems} />;
}
```

### Intuïtieve & Slimme UI

De UI is ontworpen rond **gebruikersgerichte principes**:

#### 1. Progressive Disclosure
- Basis view toont essentiële informatie
- Advanced view onthult detail-level controls
- Tooltips voor extra context zonder clutter

#### 2. Visual Hierarchy
```
┌────────────────────────────────────────┐
│ 🔵 Primary: Actie knoppen, totalen      │
│                                        │
│ 🟢 Success: Positieve statussen        │
│                                        │
│ 🟡 Warning: Aandachtspunten            │
│                                        │
│ 🔴 Danger: Problemen, fouten           │
│                                        │
│ ⚪ Neutral: Ondersteunende info        │
└────────────────────────────────────────┘
```

#### 3. Responsive Feedback
- **Loading states** tonen altijd progress `(17/135)`
- **Combined progress bar** voor meerdere workloads
- **Error messages** bevatten actionable guidance
- **Success confirmations** verdwijnen automatisch

#### 4. Smart Defaults
- **Chips** tonen alleen consented workloads
- **Cards** aggregeren automatisch wanneer meerdere workloads actief
- **Filters** onthouden laatste selectie per sessie

#### 5. Consistency
- Dezelfde interactiepatronen door hele app
- Consistente iconen (eigen iconenset) en kleuren (Tailwind palette)
- Uniforme spacing en typography

### Accessibility

De app volgt WCAG 2.1 richtlijnen waar mogelijk:

- **Keyboard navigation** voor alle interacties
- **Dark mode** voor verminderde oogbelasting
- **Color contrast** minimaal 4.5:1 ratio
- **Focus indicators** duidelijk zichtbaar
- **Screen reader** labels voor iconen en grafische elementen

---

## Technische Stack

| Component | Technologie | Rationale |
|-----------|-------------|-----------|
| Framework | Next.js 16 (App Router) | Static export (`output: "export"`), alleen client components, geen SSR |
| Styling | Tailwind CSS | Utility-first, dark mode support |
| Auth | MSAL.js (@azure/msal-react) | Microsoft identity platform |
| API Client | @microsoft/microsoft-graph-client | Type-safe Graph API calls |
| Charts | Eigen SVG-componenten | Geen dependency, getekend uit data |
| Icons | the own icon set (components/icons) | Consistent, tree-shakeable |
| PDF Export | @react-pdf/renderer | Client-side PDF generation |

### Build Configuration

```javascript
// next.config.js
{
  output: "export",  // Static HTML export
  images: { unoptimized: true },  // No Image Optimization API
}
```

---

## Microsoft Entra ID Integratie

### PIM Workloads in Microsoft Ecosystem

Microsoft Entra ID PIM beheert privileged access voor verschillende workloads:

```
┌─────────────────────────────────────────────────────────────┐
│                 Microsoft Entra ID PIM                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ Directory    │  │ PIM for      │  │ Azure Resource   │   │
│  │ Roles        │  │ Groups       │  │ Roles *          │   │
│  │ (Entra ID)   │  │              │  │ (via ARM API)    │   │
│  └──────────────┘  └──────────────┘  └──────────────────┘   │
│                                                              │
│  * Niet via Graph API, vereist Azure Resource Manager API   │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                 Gerelateerde RBAC Workloads                  │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ Intune       │  │ Exchange     │  │ Defender         │   │
│  │ Roles        │  │ Roles        │  │ Roles            │   │
│  │ (via Groups) │  │ (via Groups) │  │ (via Groups)     │   │
│  └──────────────┘  └──────────────┘  └──────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Graph API Endpoints per Workload

| Workload | Base Endpoint | API Version | Permissions |
|----------|---------------|-------------|-------------|
| Directory Roles | `/roleManagement/directory/` | v1.0/beta | RoleManagement.Read.Directory |
| PIM for Groups | `/identityGovernance/privilegedAccess/group/` | beta (policies en hun toewijzingen via v1.0) | PrivilegedAccess.Read.AzureADGroup |
| Intune Roles (gepland) | `/deviceManagement/roleDefinitions` | v1.0 | DeviceManagementRBAC.Read.All |

### Authentication & Consent Flow

```
┌────────────┐     ┌─────────────┐     ┌─────────────────┐
│   User     │────>│  MSAL.js    │────>│ Microsoft       │
│            │     │  Popup/     │     │ Identity        │
│            │<────│  Redirect   │<────│ Platform        │
└────────────┘     └─────────────┘     └─────────────────┘
                         │
                         ▼
              ┌─────────────────────┐
              │  Incremental        │
              │  Consent per        │
              │  Workload           │
              └─────────────────────┘
```

**Incremental Consent Strategie:**
1. Tien leesscopes bij login (`loginRequest` in `config/authConfig.ts`): User.Read, RoleManagement.Read.Directory, RoleAssignmentSchedule.Read.Directory, RoleEligibilitySchedule.Read.Directory, RoleManagementPolicy.Read.Directory, Policy.Read.ConditionalAccess, User.Read.All, Group.Read.All, AdministrativeUnit.Read.All, Application.Read.All
2. Extra scopes aanvragen wanneer de gebruiker een workload activeert (PIM for Groups, Security Alerts) of Configure opent (schrijfscopes: RoleManagementPolicy / RoleEligibilitySchedule / RoleAssignmentSchedule.ReadWrite.Directory en RoleManagementPolicy / PrivilegedEligibilitySchedule / PrivilegedAssignmentSchedule.ReadWrite.AzureADGroup)
3. Consent state opgeslagen in localStorage voor sessie-persistentie

---

## Multi-Workload Architectuur

### Unified Context Pattern

De app gebruikt een **Unified Context** pattern om meerdere workloads te beheren:

```
┌─────────────────────────────────────────────────────────────┐
│                    UnifiedPimProvider                        │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │             workloads: Record<WorkloadId, State>     │    │
│  │                                                      │    │
│  │  { directoryRoles: {...}, pimGroups: {...}, ... }   │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌────────────┐   │
│  │ loadWorkload    │  │ refreshWorkload │  │ patch- /   │   │
│  └─────────────────┘  └─────────────────┘  │ peek-      │   │
│                                            │ Workload   │   │
│  ┌─────────────────────────────────────┐   └────────────┘   │
│  │ one WorkloadEngine per workload     │                    │
│  │ (src/workloads/engine.ts)           │                    │
│  └─────────────────────────────────────┘                    │
└─────────────────────────────────────────────────────────────┘
          │                         │
          ▼                         ▼
┌──────────────────┐      ┌──────────────────┐
│ directoryRoles   │      │ pimGroups        │
│ Adapter          │      │ Adapter          │
│ → directoryRole  │      │ → pimGroup       │
│   Service        │      │   Service        │
└──────────────────┘      └──────────────────┘
```

**Drie contexts per provider (render-performance).** `UnifiedPimProvider` rendert drie geneste contexts uit één state-object: een data-context (`useUnifiedData`: per workload `data`, `consent`, `lastFetched`, per workload gememoïseerd zodat hij alleen verandert als die referenties veranderen), een loading-context (`useUnifiedLoading`: per workload laadfase en voortgang plus `syncHistory`) en een actions-context (`useUnifiedActions`: `loadWorkload`, `refreshWorkload`, `refreshAllWorkloads`, `enableWorkload`, `disableWorkload`, `clearWorkload`, `patchWorkload`, `peekWorkload`, `addSyncHistoryEntry`, `getGraphClient`; elk lid is een stabiele callback, dus het object wordt één keer aangemaakt). De Directory Roles-hooks `useRolesData`, `useRolesLoading` en `useRolesActions` (`hooks/usePimData.ts`) zijn selectors over de `directoryRoles`-slices van dezelfde drie contexts. Tijdens het laden van policies renderen alleen de loading-consumers (`GlobalProgressBar`, `LoadingStatus`, `SyncStatus`) en de componenten die de rollen tonen opnieuw; de zoekvelden en elke consumer die alleen acties gebruikt blijven ongemoeid. `useUnifiedPimData()` en `usePimData()` blijven bestaan als compatibiliteitshooks die de drie slices samenvoegen en daarom bij elke wijziging opnieuw renderen.

### Workload State Interface

```typescript
interface WorkloadState<T, X = undefined> {
    workload: WorkloadType;
    data: T[];
    extras: X;                 // Directory Roles: authentication contexts, failed role ids
    loading: {
        phase: "idle" | "consent" | "fetching" | "processing" | "policies" | "complete" | "error";
        progress: { current: number; total: number };
        message: string;
        error?: string;
        percent?: number;      // blocking phase, 0 to 100
        background?: { running: boolean; progress: { current: number; total: number } };
    };
    consent: WorkloadConsentState;
    lastFetched?: string;
}
```

### Service Layer Naamgeving

Na refactoring volgen alle services een consistent patroon:

| Service | Doel | Bestandsnaam |
|---------|------|--------------|
| Directory Roles | Entra ID rollen + policies | `directoryRoleService.ts` |
| PIM for Groups | PIM-onboarded groups (beta resources endpoint) | `pimGroupService.ts` |
| PIM Configuration | Het PIM-beleid van een directoryrol lezen en schrijven (`getRolePolicy`, `updatePimPolicy`) | `pimConfigurationService.ts` |
| Configure Apply | De ene apply-engine van Configureren: eerst een snapshot, dan beleid en toewijzingen stap voor stap | `configureApplyService.ts` |
| Custom Extensions | PIM custom extensions (Preview): de extension-objecten van de tenant lijsten en aanmaken (beta) | `customExtensionService.ts` |
| Write Access | De reads van de Configure-toegangscheck: je rollen, eigen groepen en PIM-groepsinstanties | `writeAccessService.ts` |
| Dry Run | De nieuwe toewijzingen van het mandje eenmalig als alleen-validatie verstuurd | `assignmentDryRunService.ts` |
| Conditional Access | De optionele Conditional Access-check van de review | `conditionalAccessService.ts` |
| Principal Lookup | De mensen uit een geïmporteerd bestand die de geladen data niet noemt | `principalLookupService.ts` |
| Tenant | De weergavenaam van de tenant voor de accountknop | `tenantService.ts` |
| Agent Blueprints | De blueprintnamen van Entra Agent ID's | `agentBlueprintService.ts` |
| User Search | Gebruikers en groepen zoeken in Mensen toevoegen | `userSearchService.ts` |
| Scope Options | Administratieve units en applicaties als scope van een nieuwe toewijzing | `scopeOptionsService.ts` |
| Group Membership | Leden en eigenaren van een groep, op aanvraag gelezen in het Rapport | `groupMembershipService.ts` |
| Policy Parser | PIM-beleidsregels parsen naar `PolicySettings` | `utils/policyParser.ts` |
| Intune (gepland) | Intune RBAC roles | `intuneService.ts` |

---

## Data Flow

### Fetch Sequence voor Directory Roles

```
┌─────────────────────────────────────────────────────────────┐
│ Phase 1: Fast Load (~10-15s)                                 │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 1. GET /roleManagement/directory/roleDefinitions        │ │
│ │ 2. GET /roleManagement/directory/roleAssignments        │ │
│ │ 3. GET /roleManagement/directory/roleEligibilitySchedules│ │
│ │ 4. GET /roleManagement/directory/roleAssignmentSchedules │ │
│ └─────────────────────────────────────────────────────────┘ │
│                         │                                    │
│                         ▼                                    │
│              UI shows roles immediately                      │
└─────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase 2: Background Policy Load (~2-3 min)                   │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ For each role (parallel via worker pool):               │ │
│ │   GET /policies/roleManagementPolicyAssignments         │ │
│ │       ?$filter=roleDefinitionId eq '{id}'               │ │
│ │       &$expand=policy($expand=rules)                    │ │
│ └─────────────────────────────────────────────────────────┘ │
│                         │                                    │
│                         ▼                                    │
│              Policy data updates UI progressively            │
└─────────────────────────────────────────────────────────────┘
```

### Fetch Sequence voor PIM for Groups

```
┌─────────────────────────────────────────────────────────────┐
│ Phase 1: Discovery (~2-5s)                                   │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ GET /beta/identityGovernance/privilegedAccess/          │ │
│ │     group/resources                                      │ │
│ │                                                          │ │
│ │ → Returns ONLY PIM-onboarded groups                      │ │
│ │ → Matches Entra admin center exactly                     │ │
│ └─────────────────────────────────────────────────────────┘ │
│                         │                                    │
│                         ▼                                    │
│              Found: 4 PIM-onboarded groups                  │
└─────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase 2: Assignment Fetch (parallel via worker pool)         │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ For each group (3 workers):                              │ │
│ │   GET /identityGovernance/privilegedAccess/group/        │ │
│ │       eligibilityScheduleInstances?$filter=groupId       │ │
│ │   GET /identityGovernance/privilegedAccess/group/        │ │
│ │       assignmentScheduleInstances?$filter=groupId        │ │
│ └─────────────────────────────────────────────────────────┘ │
│                         │                                    │
│                         ▼                                    │
│              UI shows groups with assignments               │
└─────────────────────────────────────────────────────────────┘
```

> **Note**: PIM for Groups policy data (duration, MFA, approval) wordt opgehaald als onderdeel van het groepsdata-laden.

### Data Aggregation

De `useAggregatedData` hook combineert data van meerdere workloads:

```typescript
interface AggregatedData {
    totalItems: number;        // roles + groups
    totalEligible: number;     // combined eligible assignments
    totalActive: number;       // combined active assignments
    totalPermanent: number;    // combined permanent assignments

    breakdown: {
        roles: { count, eligible, active, permanent };
        groups: {
            count, eligible, active, permanent,
            eligibleMembers, eligibleOwners,  // detailed breakdown
            // ...
        };
    };
}
```

---

## State Management

### Context Hierarchy

```
<ThemeProvider>                         ← Theme state (dark/light)
  <AuthProvider>                        ← MSAL authentication wrapper
    <ProtectedRoute>                    ← Route protection
        <UnifiedPimProvider>            ← Multi-workload state, één engine per workload
          <ErrorBoundary>               ← Vangt render-fouten, fallback UI
            <ToastProvider>             ← Toast-notificaties
              <GlobalProgressBar />
              <AppShell>{children}</AppShell>   ← Top bar, compact header, bottom navigation
              <OnboardingWrapper />     ← Eerste-bezoek tour en feature highlights
            </ToastProvider>
          </ErrorBoundary>
        </UnifiedPimProvider>
    </ProtectedRoute>
  </AuthProvider>
</ThemeProvider>
```

De providerboom staat in `components/AppProviders.tsx` (een client component die `app/layout.tsx` rendert). De MSAL redirect-bridgepagina `/redirect` wordt buiten deze boom gerenderd: MSAL v5 levert popup- en silent-tokenantwoorden op die pagina af, die ze naar het openende venster broadcast en niet in `MsalProvider` mag zitten.

> **Let op:** `ViewModeProvider` maakt geen deel uit van de globale layout. Hij wordt alleen lokaal toegepast in `app/dashboard/page.tsx`. `ConfigureBasketProvider` wordt lokaal toegepast in `app/configure/page.tsx`.

> **Let op:** De statische HTML en de hydration-pass renderen alleen de opstartspinner; de boom volgt op de client. In een demotabblad omhult `DemoModeProvider` hem en neemt `DemoAuthProvider` de plaats van `AuthProvider` in. De oude `PimDataProvider` en `DirectoryRoleContext` bestaan niet meer: Directory Roles zitten in `UnifiedPimProvider`.

### Caching Strategy

| Data Type | Cache Location | Expiry | Rationale |
|-----------|---------------|--------|-----------|
| Role Data | SessionStorage | 60 min | Balans tussen performance en actualiteit |
| Consent State | LocalStorage | Permanent | Onthoud user preferences |
| Workload Settings | LocalStorage | Permanent | User config |
| Navigatie Status | URL Search Params | Transient | Tijdelijke overrides (bijv. ?workload=directoryRoles) |

### Navigatie Status Strategie

De applicatie gebruikt een **Hybrid State** aanpak voor navigatie:
1. **Permanente Voorkeuren:** Gebruikerskeuzes voor toggles worden opgeslagen in `localStorage` (standaard weergave).
2. **Tijdelijke Overrides:** URL-parameters (bijv. van Dashboard drill-down links) overschrijven `localStorage` *tijdelijk*.
   - De overschreven status wordt NIET opgeslagen in storage.
   - Wegnavigeren (URL wissen) herstelt de opgeslagen voorkeur van de gebruiker.
   - Dit voorkomt dat tijdelijke gefilterde weergaven "blijven hangen" en de gebruiker hinderen.

---

## Configure

De **Configure-pagina** (`/configure`) heeft vier modi (Edit, Guided, Import, Access model) op één mandje met wijzigingen, één review en één apply-engine. Zie [Configuratiepagina](./09-configuratie-pagina.md) en de sectie Configure Feature in `docs/architecture/features.md` voor de bestanden.

---

## Performance Optimalisaties

### Worker Pool Pattern

Alle parallelle API fetching gebruikt een universele **worker pool utility**:

```typescript
// src/utils/workerPool.ts
async function runWorkerPool<TItem, TResult>({
    items: TItem[],
    workerCount: number,      // default: 8 (geoptimaliseerd)
    delayMs: number,          // default: 300ms (geoptimaliseerd)
    processor: (item, workerId) => Promise<TResult>,
    onProgress?: (current, total) => void
}): Promise<WorkerPoolResult<TItem, TResult>>
```

**Voordelen:**
- **8x sneller** dan sequentieel (geoptimaliseerd van 3x)
- Voorkomt Graph API throttling (429)
- Consistente progress reporting
- Herbruikbaar voor alle workloads

**Performance Impact:**
- Policy fetch tijd: ~15-20s → ~3-5s (voor 50 roles)
- **70-80% sneller** dan originele implementatie
- Blijft ruim binnen Microsoft Graph API throttling limieten:
  - Large tenant (>500 gebruikers): 10% van quota gebruik
  - Medium tenant (50-500): 16% van quota gebruik
  - Small tenant (<50): 22% van quota gebruik

### Rate Limiting Strategy

| Workload / Operatie | Workers | Delay | Waar |
|---------------------|---------|-------|------|
| Directory Roles: policy fetch per rol | 12 | 200ms | `concurrentFetchPolicies` (aangeroepen door `workloads/directoryRolesAdapter.ts`); verhoogd van 8/300ms in v2.1.0 |
| Directory Roles: scope-verrijking | 8 | 300ms | `enrichAssignmentsWithScope` |
| PIM for Groups: beheerde groepen (volledig laden, 4 calls per groep) | 3 | 500ms | `fetchAllPimGroupData` |
| PIM for Groups: beheerde groepen (slim verversen, 2 calls per groep) | 3 | 500ms | `refreshPimGroupAssignments` |
| PIM for Groups: onbeheerde groepen | 5 | 200ms | `fetchAllPimGroupData`, `refreshPimGroupAssignments` (één lichte call per groep) |
| PIM for Groups: ledenaantal van onbeheerde groepen | 6 | 500ms | `addMemberCounts` (`pimGroupService.ts`) |
| Worker pool standaard (indien niet opgegeven) | 8 | 300ms | `runWorkerPool` |

De Configure-apply (`services/configureApplyService.ts`) draait zijn stappen via `runWorkerPool` met 4 workers en 500 ms vertraging. `updatePimPolicy` loopt niet via een pool: de regels worden één voor één gePATCHt met een pauze van 300 ms. Elke Graph-call, gepoold of niet, gaat bovendien door `graphRateLimiter` (`utils/rateLimiter.ts`, sliding window van 500 resource units per 10 seconden).

**Microsoft Graph API Limieten (Identity & Access):**

| Tenant Grootte | ResourceUnits per 10 sec | Eigen cap (500 RU) als deel van het budget |
|----------------|-------------------------|---------------------------------------------|
| Large (>500 users) | 8,000 RU | 6% |
| Medium (50-500) | 5,000 RU | 10% |
| Small (<50) | 3,500 RU | 14% |

**Policy fetch cost:** 2 RU per request, afgeleid uit de Graph-regels (een request kost 1, `$expand` telt 1 erbij). Microsoft publiceert geen kost voor `/policies/roleManagementPolicyAssignments`, dus dit is niet gemeten; de response header `x-ms-resource-unit` toont de echte waarde.

**Eigen cap:** `graphRateLimiter` houdt alle Graph-calls samen onder 500 RU per 10 seconden, ongeveer 25 policy-requests per seconde.

----------------|-------------------------|-------------------|-------------|-----------------|
| Large (>500 users) | 8,000 RU | ~3 RU/req | ~266 req/sec | 26 req/sec (10%) |
| Medium (50-500) | 5,000 RU | ~3 RU/req | ~166 req/sec | 26 req/sec (16%) |
| Small (<50) | 3,500 RU | ~3 RU/req | ~116 req/sec | 26 req/sec (22%) |

**Berekening huidige gebruik:**
- 12 workers × 5 req/sec (1 request per 200ms) = ~60 req/sec totaal (policy fetch)
- Standaard worker pool (8/300ms) gebruikt ~26 req/sec voor overige operaties

---

## UI/UX Ontwerpbeslissingen

### Dashboard Cards Aggregatie

**Besluit:** Gecombineerde totalen met breakdown in beschrijving

```
┌──────────────────────────────┐
│  Total Items                 │
│  142                         │
│  130 roles + 12 groups       │  ← Breakdown tonen
└──────────────────────────────┘
```

**Rationale:**
- Eén kaart per metric, niet per workload
- Breakdown in beschrijving voor detail
- Schaalt naar toekomstige workloads

### Groups Display Strategy

**Besluit:** Toon ALLE role-assignable groups, highlight PIM-enabled:

| Badge | Betekenis |
|-------|-----------|
| 🟢 PIM Active | Groep heeft actieve/eligible assignments |
| ⚪ No PIM | Role-assignable maar geen PIM assignments |

**Rationale:**
- Gebruiker ziet volledige potentieel
- Duidelijk welke groups nog niet beschermd zijn

### Loading Progress

**Besluit:** Consistente progress format en gecombineerde loadbar:

- **LoadingStatus:** `(current/total)` format voor beide workloads
- **GlobalProgressBar:** Gewogen gemiddelde van alle loading workloads
  - Blauw gradient: Alleen roles
  - Emerald gradient: Alleen groups
  - Multi-color gradient: Beide tegelijk

---

## Toekomstige Workloads

### Fase 4: M365 Workloads

#### Intune Roles
```
Endpoint: GET /deviceManagement/roleDefinitions
Permissions: DeviceManagementRBAC.Read.All
Relatie: Sommige Intune roles linken naar Entra groups
```

#### Exchange Roles
```
Endpoint: GET /roleManagement/exchange/roleDefinitions
Permissions: RoleManagement.Read.Exchange
Note: Beperkte Graph API support, mogelijk EXO PowerShell nodig
```

### Workload Link Detection (Fase 4+)

Veel M365 workloads linken naar Entra ID groups:

```
PIM Group "IT Admins"
├── Linked to: Intune "Helpdesk Administrator" role
├── Linked to: Exchange "Organization Management" role
└── Linked to: Defender "Security Operator" role
```

De `workloadLinkDetector` service zal deze relaties detecteren en visualiseren.

---

## Context Diagram

De applicatie binnen het externe ecosysteem:

```
┌─────────────────────────────────────────────────────────────────────┐
│                         External Actors                              │
│                                                                      │
│    ┌──────────────────┐                    ┌──────────────────┐     │
│    │   IT Admin       │                    │  Security        │     │
│    │   (Primary User) │                    │  Auditor         │     │
│    └────────┬─────────┘                    └────────┬─────────┘     │
│             │                                        │               │
│             │      Uses                    Reviews   │               │
│             ▼                                        ▼               │
│    ┌──────────────────────────────────────────────────────────┐     │
│    │                    PIM Manager                            │     │
│    │              (Client-side SPA)                            │     │
│    │                                                           │     │
│    │  • Dashboard      • Report Page      • PDF Export         │     │
│    │  • Configure      • Settings                              │     │
│    └──────────────────────────────────────────────────────────┘     │
│                               │                                      │
│         ┌─────────────────────┼─────────────────────┐               │
│         │                     │                     │               │
│         ▼                     ▼                     ▼               │
│    ┌──────────┐      ┌───────────────┐     ┌────────────────┐      │
│    │ Microsoft│      │  Microsoft    │     │   Cloudflare   │      │
│    │ Identity │◄────►│  Graph API    │     │   Pages        │      │
│    │ Platform │      │               │     │   (Hosting)    │      │
│    │ (MSAL)   │      │ • Directory   │     │                │      │
│    │          │      │ • PIM for Groups  │     │ • Static files │      │
│    │ OAuth2.0 │      │ • Policies    │     │ • Global CDN   │      │
│    └──────────┘      └───────────────┘     └────────────────┘      │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Kwaliteitsattributen (NFRs)

| Attribuut | Requirement | Hoe bereikt |
|-----------|-------------|-------------|
| **Performance** | Initial load < 15s, policies < 5s (50 roles) | Geoptimaliseerde worker pool (policy fetch: 12 workers, 200ms; standaard: 8/300ms), progressive loading |
| **Scalability** | Support 1000+ roles, 100+ groups | Pagination, lazy loading |
| **Availability** | 99.99% uptime | Static hosting (Cloudflare edge) |
| **Security** | Minimale permissions, no data storage | MSAL, incremental consent, client-side only |
| **Maintainability** | Modulaire code, clean architecture | Layered architecture, DRY, TypeScript |
| **Usability** | Intuitive UI, < 3 clicks to action | Progressive disclosure, smart defaults |
| **Compatibility** | Modern browsers (Chrome, Edge, Firefox) | ES2020+, no polyfills needed |

---

## Architectural Decision Records (ADRs)

Belangrijke architectuurbeslissingen gedocumenteerd voor toekomstige referentie:

| # | Beslissing | Status | Rationale |
|---|------------|--------|-----------|
| ADR-001 | **Client-side only** (geen backend) | Accepted | Vermijdt server kosten, simpler deployment, data blijft bij gebruiker |
| ADR-002 | **Static Export** via Next.js | Accepted | Cloudflare Pages hosting, geen server-side rendering nodig |
| ADR-003 | **UnifiedPimContext** voor multi-workload | Accepted | Single source of truth, schaalt naar nieuwe workloads |
| ADR-004 | **Worker Pool pattern** voor API throttling | Accepted | Voorkomt 429 errors, tot 8x sneller dan sequentieel |
| ADR-005 | **Aggregated cards** i.p.v. per-workload | Accepted | Cleaner UI, schaalt beter |
| ADR-006 | **Incremental Consent** per workload | Accepted | Least privilege, user kiest welke data |
| ADR-007 | **Beta API** alleen waar v1.0 de data mist: `isPrivileged`, alerts, custom extensions, PIM for Groups-resources, groepsleden en ledenaantal | ⚠️ Risk Accepted | Nodig voor security insights en PIM for Groups; elke beta-aanroep heeft de reden in een codecommentaar. De `isPrivileged`-aanroep valt terug op v1.0 zonder dat veld |

> Zie `docs/adr/` voor gedetailleerde ADR documenten (indien gecreëerd).

---

## Security Architectuur

### Data Classification

| Data Type | Sensitivity | Storage | Lifetime |
|-----------|-------------|---------|----------|
| Access tokens | High | Memory only | Session |
| Role data | Medium | SessionStorage | 60 minutes |
| Consent state | Low | LocalStorage | Permanent |
| User preferences | Low | LocalStorage | Permanent |

### Data in Transit

- **HTTPS only** - Enforced door Cloudflare
- **TLS 1.2+** - Graph API requirement
- **No data transmission to third parties** - Alleen Microsoft APIs

### Authentication & Authorization

```
┌───────────────────────────────────────────────────────────────┐
│                    Authorization Flow                          │
│                                                                │
│  User ──► MSAL Popup ──► Microsoft Identity ──► Token         │
│                              Platform                          │
│                                                                │
│  Token Scopes (cumulative):                                   │
│  ├── Login: tien leesscopes (zie Incremental Consent Strategie) │
│  ├── Security Alerts: RoleManagementAlert.Read.Directory       │
│  ├── PIM for Groups: PrivilegedAccess.Read.AzureADGroup,      │
│  │     RoleManagementPolicy.Read.AzureADGroup                  │
│  └── Configure: granulaire *.ReadWrite.Directory en           │
│        *.ReadWrite.AzureADGroup scopes                         │
│                                                                │
└───────────────────────────────────────────────────────────────┘
```

### Security Principles

1. **Least Privilege** - Alleen benodigde scopes aanvragen
2. **No Server-side Storage** - Geen data op servers opgeslagen
3. **Consent Transparency** - User ziet welke permissions worden gevraagd
4. **Token Handling** - Geen manual token storage, MSAL managed

---

## Foutafhandeling

### Client-side Error Handling

| Error Type | Handling | User Feedback |
|------------|----------|---------------|
| **Network errors** | Retry met exponential backoff | Toast notification |
| **401 Unauthorized** | MSAL re-auth popup | Automatic re-login prompt |
| **403 Forbidden** | Log + user message | "Missing permissions" alert |
| **429 Throttling** | Worker pool delay + retry | Progress indicator continues |
| **500 Server Error** | Retry up to 3x | "Service unavailable" message |

### Error Boundaries

```tsx
// React Error Boundary in layout.tsx
<ErrorBoundary fallback={<ErrorFallback />}>
  <App />
</ErrorBoundary>
```

### Logging Strategy

- Alle logging loopt via `Logger` (`utils/logger.ts`); `src/` bevat geen directe `console.*` aanroepen
- Het niveau is dynamisch: `localStorage.setItem('LOG_LEVEL', 'DEBUG')` zet debug-uitvoer aan in elke omgeving
- Error boundaries (globaal) vangen onafgehandelde render-fouten; er is geen externe monitoringdienst gekoppeld

---

## Deployment Architectuur

Voor gedetailleerde deployment instructies, zie: **[08-deployment.md](./08-deployment.md)**

### Overzicht

```
┌────────────────────────────────────────────────────────────────┐
│                    Build & Deploy Pipeline                      │
│                                                                │
│  ┌─────────┐    ┌─────────────┐    ┌──────────────────────┐   │
│  │ GitHub  │───►│   Build     │───►│   Cloudflare Pages   │   │
│  │ Push    │    │ npm run     │    │                      │   │
│  │         │    │ build       │    │  ┌────────────────┐  │   │
│  └─────────┘    └─────────────┘    │  │  /out folder   │  │   │
│                                     │  │  Static HTML   │  │   │
│                                     │  │  JS bundles    │  │   │
│                                     │  │  CSS assets    │  │   │
│                                     │  └────────────────┘  │   │
│                                     │                      │   │
│                                     │  • Auto SSL/TLS      │   │
│                                     │  • Global CDN        │   │
│                                     │  • Edge caching      │   │
│                                     └──────────────────────┘   │
└────────────────────────────────────────────────────────────────┘
```

### Environment Variables

| Variable | Doel |
|----------|------|
| `NEXT_PUBLIC_CLIENT_ID` | Microsoft Entra ID App Registration Client ID |
| `NEXT_PUBLIC_REDIRECT_URI` | OAuth redirect (auto-detected if empty) |

---


## Appendix: Bestanden Structuur

```
src/
├── app/                          # Routes: /, dashboard, report, configure, settings, help, redirect, demo
├── components/
│   ├── AppProviders.tsx          # De providerboom (gerenderd door app/layout.tsx)
│   ├── ui/                       # Primitieven: Button, Chip, Dialog, Menu, SegmentedControl, StatCard, Tag, Skeleton, Toast, DurationSlider, DemoLock, ...
│   ├── charts/                   # Donut, StackedBar, BarList (eigen SVG-grafieken)
│   ├── icons/                    # Icon.tsx, iconData.ts (eigen iconenset)
│   ├── shell/                    # AppShell, ShellFrame, TopBar, CompactHeader, BottomNav, AccountMenu, HelpPanel, EnvironmentSwitcher, DemoBanner
│   ├── pdf/                      # ReportDocument.tsx (PDF-export renderer)
│   ├── ErrorBoundary.tsx         # Error catching + fallback UI
│   ├── GlobalProgressBar.tsx     # Gecombineerde laadvoortgang
│   ├── LoadingStatus.tsx         # Inline laadindicatoren
│   ├── WorkloadChips.tsx         # Workload toggle chips
│   └── ThemeProvider.tsx         # Donker/licht modus
│
├── workloads/                    # WorkloadEngine, sessiecache, adapters voor Directory Roles en PIM for Groups
│
├── services/
│   ├── directoryRoleService.ts   # Entra ID Roles + Policies
│   ├── pimGroupService.ts        # PIM for Groups
│   ├── pimConfigurationService.ts # Lezen en schrijven van rolpolicies
│   ├── configureApplyService.ts  # De apply-engine van Configureren
│   ├── assignmentDryRunService.ts # Proefrun van nieuwe toewijzingen (isValidationOnly)
│   ├── writeAccessService.ts     # Leesacties van de toegangscheck van Configureren
│   ├── conditionalAccessService.ts # Optionele Conditional Access-check
│   └── ...                       # customExtension, groupMembership, userSearch, scopeOptions, principalLookup, tenant, agentBlueprint
│
├── contexts/
│   ├── UnifiedPimContext.tsx     # Multi-workload state (data, loading, actions)
│   ├── ConfigureBasketContext.tsx # Het mandje van Configureren
│   ├── DemoModeContext.tsx       # Vlag van de live demo
│   ├── ViewModeContext.tsx       # Weergavemodus state
│   └── ToastContext.tsx          # Toast-notificatiesysteem
│
├── hooks/
│   ├── usePimData.ts             # Directory Roles-selectors over UnifiedPimContext
│   ├── usePimSelectors.ts        # Dunne selectors over UnifiedPimContext
│   ├── useAggregatedData.ts      # Gecombineerde statistieken over workloads
│   ├── useIncrementalConsent.ts  # Consent-flow
│   ├── useConsentedWorkloads.ts  # Consent-detectie
│   ├── useDashboardFilter.ts     # Het gedeelde filter `f` in de URL
│   ├── useReportUrlState.ts      # URL-state van het Rapport
│   ├── useWriteAccess.ts         # Toegangscheck van Configureren
│   ├── useConfigureReview.ts     # Review van Configureren (pre-flight, proefrun)
│   ├── useConfigureApply.ts      # Apply, resultaat en ongedaan maken in Configureren
│   ├── useLeaveGuard.ts          # Waarschuwt bij niet-opgeslagen wijzigingen in Configureren
│   ├── useOnboarding.ts          # Eerste-bezoek tour en feature highlights
│   └── useUpdateCheck.ts         # GitHub release-check (alleen self-hosted)
│
├── types/
│   ├── shared.types.ts           # Principal, AuthenticationContext, CustomExtensionSlots (gedeelde vormen)
│   ├── directoryRole.types.ts    # Roldatatypes (PimPolicyRule, ApprovalStage, PrimaryApprover)
│   ├── pimGroup.types.ts         # Groepsdatatypes
│   ├── workload.types.ts         # Workload state types
│   ├── configure.types.ts        # Het mandje van Configureren
│   ├── dashboardFilter.types.ts  # Filtertypes
│   ├── securityAlerts.types.ts   # Security alert types
│
├── demo/                         # De live demo: runtime-patches, nep-Graph, Contoso-tenant
│
└── utils/
    ├── workerPool.ts             # Parallel ophalen (standaard: 8 workers, 300ms)
    ├── rateLimiter.ts            # graphRateLimiter: sliding window, 500 RU per 10 s
    ├── graphClient.ts            # createGraphClient, ThrottleWatcher (een 429 pauzeert de limiter)
    ├── retryUtils.ts             # withRetry() exponentiële backoff voor 429/5xx
    ├── errorUtils.ts             # getErrorMessage/getErrorCode/isAbortError for catch (error: unknown)
    ├── graphErrorMapping.ts      # Ruwe Graph-fouten naar begrijpelijke meldingen
    ├── odataUtils.ts             # escapeODataString() en OData query helpers
    ├── durationUtils.ts          # ISO 8601 duur parsen + formatteren
    ├── policyRules.ts            # De ene schrijfmapper voor beleidsregels
    ├── configureBasket.ts        # Reducers en opslag van het mandje
    ├── configurePreflight.ts     # De checks van de review als data
    ├── policyConflicts.ts        # Wat verandert voor wie activeert als een beleid wijzigt
    ├── throttle.ts               # createTrailingThrottle voor gebundelde voortgangsupdates
    ├── etagCache.ts              # ETag-gebaseerde HTTP-caching
    ├── scopeUtils.ts             # Detectie van scopetypes (6 scopetypes)
    ├── logger.ts                 # Gestructureerde logging met dynamische niveaus
    ├── authContextApi.ts         # Conditional Access auth contexts ophalen
    ├── alertFormatting.ts        # Iconen + kleuren van security alerts
    └── exportReport.ts           # inhoud van de PDF/CSV-export als data
```

---
