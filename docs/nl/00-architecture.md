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
│  │ Overview │  │ Security │  │ Role     │  │ Loading  │    │
│  │ Cards    │  │ Charts   │  │ Filters  │  │ Status   │    │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘    │
└───────┼─────────────┼─────────────┼─────────────┼──────────┘
        │             │             │             │
┌───────┼─────────────┼─────────────┼─────────────┼──────────┐
│       ▼             ▼             ▼             ▼          │
│                      Hooks Layer                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │useAggregated │  │useRoleFilters│  │useIncremental│      │
│  │Data          │  │              │  │Consent       │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
└─────────┼─────────────────┼─────────────────┼──────────────┘
          │                 │                 │
┌─────────┼─────────────────┼─────────────────┼──────────────┐
│         ▼                 ▼                 ▼              │
│                     Context Layer                           │
│  ┌────────────────┐  ┌────────────────┐                    │
│  │ UnifiedPim     │  │ DirectoryRole  │                    │
│  │ Context        │  │ Context        │                    │
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
- Modules communiceren via props, contexts of hooks - nooit direct
- Nieuwe workloads voegen toe zonder bestaande code aan te passen

### Clean Code

De codebase volgt strikte clean code principes:

| Principe | Toepassing in PIM Manager |
|----------|---------------------------|
| **Meaningful Names** | `directoryRoleService.ts` niet `roleData.ts`, `useAggregatedData` niet `useData` |
| **Small Functions** | Max ~50 regels per functie, helper functies voor complexe logica |
| **DRY (Don't Repeat)** | `workerPool.ts` utility hergebruikt door alle services |
| **Consistent Formatting** | Prettier + ESLint configuratie enforced |
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
| `InteractiveStatCard` | Dashboard, Report, future pages |
| `LoadingStatus` | Dashboard header, Report header |
| `GlobalProgressBar` | Alle pagina's (via layout) |
| `workerPool.ts` | directoryRoleService, pimGroupService, future services |
| `useAggregatedData` | OverviewCards, SecurityCharts, future components |
| `ScopeBadge` | Role details, Group details, Reports |

**Design Pattern: Composition over Inheritance**

```tsx
// ❌ Niet: Props drilling
<Dashboard>
  <Cards rolesData={...} groupsData={...} loading={...} />
</Dashboard>

// ✅ Wel: Hook-based data access
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
- Consistente iconen (Lucide) en kleuren (Tailwind palette)
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
| Framework | Next.js 16 (App Router) | Static export, React Server Components |
| Styling | Tailwind CSS | Utility-first, dark mode support |
| Auth | MSAL.js (@azure/msal-react) | Microsoft identity platform |
| API Client | @microsoft/microsoft-graph-client | Type-safe Graph API calls |
| Charts | Recharts | React-native, responsive |
| Icons | Lucide React | Consistent, tree-shakeable |
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
| PIM for Groups | `/identityGovernance/privilegedAccess/group/` | beta | PrivilegedAccess.Read.AzureADGroup |
| Intune Roles | `/deviceManagement/roleDefinitions` | v1.0 | DeviceManagementRBAC.Read.All |

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
1. Basis-permissies bij login (User.Read, RoleManagement.Read.Directory)
2. Extra scopes aanvragen wanneer gebruiker een workload activeert
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
│  │ enableWorkload  │  │ refreshWorkload │  │register-   │   │
│  └─────────────────┘  └─────────────────┘  │Workload-   │   │
│                                            │Refresh     │   │
│  ┌─────────────────────────────────────┐   └────────────┘   │
│  │ refreshAllWorkloads() - UNIVERSEEL   │                    │
│  │ (delegeert naar registered handlers) │                    │
│  └─────────────────────────────────────┘                    │
└─────────────────────────────────────────────────────────────┘
          │                         │
          ▼                         ▼
┌──────────────────┐      ┌──────────────────┐
│ DirectoryRole    │      │ PimGroup         │
│ Context          │      │ Service          │
│ (registreert     │      │                  │
│  refreshData)    │      │                  │
└──────────────────┘      └──────────────────┘
```

### Workload State Interface

```typescript
interface WorkloadState<T> {
    isConsented: boolean;
    loading: {
        phase: "idle" | "fetching" | "processing" | "complete" | "error";
        progress: { current: number; total: number };
        message?: string;
        error?: string;
    };
    data: T[];
    lastFetched?: string;
}
```

### Service Layer Naamgeving

Na refactoring volgen alle services een consistent patroon:

| Service | Doel | Bestandsnaam |
|---------|------|--------------|
| Directory Roles | Entra ID rollen + policies | `directoryRoleService.ts` |
| PIM Groups | PIM-onboarded groups (beta resources endpoint) | `pimGroupService.ts` |
| Intune (future) | Intune RBAC roles | `intuneService.ts` |

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

### Fetch Sequence voor PIM Groups

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

> **Note**: PIM Groups haalt momenteel GEEN policies op (duration, MFA, approval).
> Dit is een geplande uitbreiding voor toekomstige versies.

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
      <MobileMenuProvider>              ← Mobile menu state
        <UnifiedPimProvider>            ← Multi-workload state
          <PimDataProvider>             ← Directory Roles data (legacy name)
            <ViewModeContext>           ← View mode state
              <GlobalProgressBar />
              <App />
            </ViewModeContext>
          </PimDataProvider>
        </UnifiedPimProvider>
      </MobileMenuProvider>
    </ProtectedRoute>
  </AuthProvider>
</ThemeProvider>
```

> **Note:** `PimDataProvider` is the exported name from `DirectoryRoleContext.tsx` for backward compatibility.

### Caching Strategy

| Data Type | Cache Location | Expiry | Rationale |
|-----------|---------------|--------|-----------|
| Role Data | SessionStorage | 5 min | Frequente updates nodig |
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

| Workload | Workers | Delay | Rationale |
|----------|---------|-------|-----------|
| Directory Roles Policies | 8 | 300ms | Geoptimaliseerd, blijft binnen quota (10-22%) |
| PIM Groups | 8 | 300ms | Geoptimaliseerd voor consistente performance |

**Microsoft Graph API Limieten (Identity & Access):**

| Tenant Grootte | ResourceUnits per 10 sec | Policy Fetch Cost | Max Req/sec | Huidige Gebruik |
|----------------|-------------------------|-------------------|-------------|-----------------|
| Large (>500 users) | 8,000 RU | ~3 RU/req | ~266 req/sec | 26 req/sec (10%) |
| Medium (50-500) | 5,000 RU | ~3 RU/req | ~166 req/sec | 26 req/sec (16%) |
| Small (<50) | 3,500 RU | ~3 RU/req | ~116 req/sec | 26 req/sec (22%) |

**Berekening huidige gebruik:**
- 8 workers × 3.33 req/sec (1 request per 300ms) = ~26 req/sec totaal
- Conservatief en veilig voor alle tenant groottes

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
│    │          │      │ • PIM Groups  │     │ • Static files │      │
│    │ OAuth2.0 │      │ • Policies    │     │ • Global CDN   │      │
│    └──────────┘      └───────────────┘     └────────────────┘      │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Kwaliteitsattributen (NFRs)

| Attribuut | Requirement | Hoe bereikt |
|-----------|-------------|-------------|
| **Performance** | Initial load < 15s, policies < 5s (50 roles) | Geoptimaliseerde worker pool (8 workers, 300ms), progressive loading |
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
| ADR-001 | **Client-side only** (geen backend) | ✅ Accepted | Vermijdt server kosten, simpler deployment, data blijft bij gebruiker |
| ADR-002 | **Static Export** via Next.js | ✅ Accepted | Cloudflare Pages hosting, geen server-side rendering nodig |
| ADR-003 | **UnifiedPimContext** voor multi-workload | ✅ Accepted | Single source of truth, schaalt naar nieuwe workloads |
| ADR-004 | **Worker Pool pattern** voor API throttling | ✅ Accepted | Voorkomt 429 errors, 3x sneller dan sequentieel |
| ADR-005 | **Aggregated cards** i.p.v. per-workload | ✅ Accepted | Cleaner UI, schaalt beter |
| ADR-006 | **Incremental Consent** per workload | ✅ Accepted | Least privilege, user kiest welke data |
| ADR-007 | **Beta API** voor isPrivileged property | ⚠️ Risk Accepted | Nodig voor security insights, fallback naar v1.0 |

> Zie `docs/adr/` voor gedetailleerde ADR documenten (indien gecreëerd).

---

## Security Architectuur

### Data Classification

| Data Type | Sensitivity | Storage | Lifetime |
|-----------|-------------|---------|----------|
| Access tokens | High | Memory only | Session |
| Role data | Medium | SessionStorage | 5 minutes |
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
│  ├── Login: User.Read, openid, profile                        │
│  ├── Roles: RoleManagement.Read.Directory                     │
│  ├── PIM Groups: PrivilegedAccess.Read.AzureADGroup           │
│  └── Configure: RoleManagement.ReadWrite.Directory            │
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

- **Development**: Console.log/warn/error
- **Production**: Error boundary catches unhandled exceptions
- **Optional**: Sentry integration voor production monitoring

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
├── components/
│   ├── ErrorBoundary.tsx         # Error catching + fallback UI
│   ├── GlobalProgressBar.tsx     # Combined loading progress
│   ├── LoadingStatus.tsx         # Inline loading indicators
│   ├── InteractiveStatCard.tsx   # Reusable dashboard card
│   ├── ScopeBadge.tsx            # Scope visualization
│   ├── WorkloadChips.tsx         # Workload toggle chips
│   └── ThemeProvider.tsx         # Dark/light mode
│
├── services/
│   ├── directoryRoleService.ts   # Entra ID Roles + Policies
│   └── pimGroupService.ts        # PIM for Groups
│
├── contexts/
│   ├── UnifiedPimContext.tsx     # Multi-workload state
│   ├── DirectoryRoleContext.tsx  # Legacy roles context (exports PimDataProvider)
│   ├── ViewModeContext.tsx       # View mode state
│   └── MobileMenuContext.tsx     # Mobile menu state
│
├── hooks/
│   ├── useAggregatedData.ts      # Combined statistics
│   ├── useIncrementalConsent.ts  # Consent flow
│   ├── useConsentedWorkloads.ts  # Consent detection
│   └── useRoleFilters.ts         # Role filtering logic
│
├── types/
│   ├── directoryRole.types.ts    # Role data types
│   ├── pimGroup.types.ts         # Group data types
│   └── workload.ts               # Workload state types
│
└── utils/
    ├── workerPool.ts             # Parallel fetching utility
    ├── pimApi.ts                 # Policy read/write helpers
    └── scopeUtils.ts             # Scope enrichment
```

---
