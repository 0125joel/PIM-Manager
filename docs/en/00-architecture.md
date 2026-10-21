# PIM Manager - Architecture Design Document

This document describes the complete architecture and design decisions of the PIM Manager application.

## Table of Contents
1. [Overview](#overview)
2. [Design Principles & Quality Guidelines](#design-principles--quality-guidelines)
3. [Technical Stack](#technical-stack)
4. [Microsoft Entra ID Integration](#microsoft-entra-id-integration)
5. [Multi-Workload Architecture](#multi-workload-architecture)
6. [Data Flow](#data-flow)
7. [State Management](#state-management)
8. [Performance Optimizations](#performance-optimizations)
9. [UI/UX Design Decisions](#uiux-design-decisions)
10. [Future Workloads](#future-workloads)
11. [Context Diagram](#context-diagram)
12. [Quality Attributes (NFRs)](#quality-attributes-nfrs)
13. [Architectural Decision Records (ADRs)](#architectural-decision-records-adrs)
14. [Security Architecture](#security-architecture)
15. [Error Handling](#error-handling)
16. [Deployment Architecture](#deployment-architecture)

---

## Overview

PIM Manager is a client-side Next.js application for managing and visualizing Microsoft Entra ID Privileged Identity Management (PIM) configurations. The app supports multiple PIM workloads:

- **Directory Roles** (Entra ID Roles) - Fully implemented
- **PIM for Groups** - Fully implemented
- **Intune Roles** - Planned (Phase 4)
- **Exchange Roles** - Planned (Phase 4)

### Core Principles

1. **Client-side only** - No backend server, all data processing in the browser
2. **Static Export** - Deployable on Cloudflare Pages, GitHub Pages, etc.
3. **Incremental Consent** - Users only grant permission for workloads they activate
4. **Performance First** - Parallel data fetching with worker pools
5. **Progressive Loading** - UI responds immediately, data loads in background

---

## Design Principles & Quality Guidelines

### Modularity

The application is built from **loosely coupled modules** that can be developed and tested independently:

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
│  ┌──────────────┐  ┌──────────────┐                           │
│  │directoryRole │  │pimGroup      │                           │
│  │Service       │  │Service       │                           │
│  └──────────────┘  └──────────────┘                           │
│  ┌──────────────┐  ┌──────────────┐                           │
│  │pimConfigur-  │  │configureApply│                           │
│  │ationService  │  │Service       │                           │
│  └──────────────┘  └──────────────┘                           │
└─────────────────────────────────────────────────────────────┘
```

**Guidelines:**
- Each module has a single responsibility (Single Responsibility Principle)
- Modules communicate via props, contexts, or hooks - never directly. One exception: `app/configure/**` (the page container and its edit components) may import from `services/` directly (calls happen in event handlers and effects, never during render), see `AGENTS.md` and `docs/architecture/code-map.md`
- New workloads can be added without modifying existing code

### Clean Code

The codebase follows strict clean code principles:

| Principle | Application in PIM Manager |
|-----------|----------------------------|
| **Meaningful Names** | `directoryRoleService.ts` not `roleData.ts`, `useAggregatedData` not `useData` |
| **Small Functions** | Max ~50 lines per function, helper functions for complex logic |
| **DRY (Don't Repeat)** | `workerPool.ts` utility reused by all services |
| **Consistent Formatting** | ESLint (`eslint-config-next`) with zero tolerance: `npm run lint` must report 0 problems |
| **Type Safety** | Strict TypeScript types for all interfaces |
| **Error Handling** | Try-catch with clear error messages, never silent fail |

**Naming Conventions:**

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

### Reusability

Components and utilities are designed for **maximum reusability**:

| Component/Utility | Reused in |
|-------------------|-----------|
| `ui/StatCard` | Dashboard cards (button when it sets a filter) |
| `LoadingStatus` | Dashboard header, Report header |
| `GlobalProgressBar` | All pages (via layout) |
| `workerPool.ts` | directoryRoleService, pimGroupService, future services |
| `useAggregatedData` | Dashboard and report components |

**Design Pattern: Composition over Inheritance**

```tsx
// Don't: Props drilling
<Dashboard>
  <Cards rolesData={...} groupsData={...} loading={...} />
</Dashboard>

// Do: Hook-based data access
function OverviewCards() {
  const aggregated = useAggregatedData();  // Gets data itself
  return <Cards value={aggregated.totalItems} />;
}
```

### Intuitive & Smart UI

The UI is designed around **user-centric principles**:

#### 1. Progressive Disclosure
- Basic view shows essential information
- Advanced view reveals detail-level controls
- Tooltips for extra context without clutter

#### 2. Visual Hierarchy
```
┌────────────────────────────────────────┐
│ 🔵 Primary: Action buttons, totals      │
│                                        │
│ 🟢 Success: Positive statuses          │
│                                        │
│ 🟡 Warning: Attention points           │
│                                        │
│ 🔴 Danger: Problems, errors            │
│                                        │
│ ⚪ Neutral: Supporting info            │
└────────────────────────────────────────┘
```

#### 3. Responsive Feedback
- **Loading states** always show progress `(17/135)`
- **Combined progress bar** for multiple workloads
- **Error messages** contain actionable guidance
- **Success confirmations** disappear automatically

#### 4. Smart Defaults
- **Chips** only show consented workloads
- **Cards** aggregate automatically when multiple workloads are active
- **Filters** remember last selection per session

#### 5. Consistency
- Same interaction patterns throughout the app
- Consistent icons (own icon set) and colors (Tailwind palette)
- Uniform spacing and typography

### Accessibility

The app follows WCAG 2.1 guidelines where possible:

- **Keyboard navigation** for all interactions
- **Dark mode** for reduced eye strain
- **Color contrast** minimum 4.5:1 ratio
- **Focus indicators** clearly visible
- **Screen reader** labels for icons and graphical elements

---

## Technical Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Framework | Next.js 16 (App Router) | Static export (`output: "export"`), client components only, no SSR |
| Styling | Tailwind CSS | Utility-first, dark mode support |
| Auth | MSAL.js (@azure/msal-react) | Microsoft identity platform |
| API Client | @microsoft/microsoft-graph-client | Type-safe Graph API calls |
| Charts | Own SVG components | No dependency, drawn from data |
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

## Microsoft Entra ID Integration

### PIM Workloads in Microsoft Ecosystem

Microsoft Entra ID PIM manages privileged access for various workloads:

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
│  * Not via Graph API, requires Azure Resource Manager API   │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                 Related RBAC Workloads                       │
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
| PIM for Groups | `/identityGovernance/privilegedAccess/group/` | beta (policies and their assignments use v1.0) | PrivilegedAccess.Read.AzureADGroup |
| Intune Roles (planned) | `/deviceManagement/roleDefinitions` | v1.0 | DeviceManagementRBAC.Read.All |

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

**Incremental Consent Strategy:**
1. Ten read scopes on login (`loginRequest` in `config/authConfig.ts`): User.Read, RoleManagement.Read.Directory, RoleAssignmentSchedule.Read.Directory, RoleEligibilitySchedule.Read.Directory, RoleManagementPolicy.Read.Directory, Policy.Read.ConditionalAccess, User.Read.All, Group.Read.All, AdministrativeUnit.Read.All, Application.Read.All
2. Request additional scopes when user activates a workload (PIM for Groups, Security Alerts), asks for the custom extension list (PrivilegedAccess-CustomExt.Read.All) or enters Configure (write scopes: RoleManagementPolicy / RoleEligibilitySchedule / RoleAssignmentSchedule.ReadWrite.Directory and RoleManagementPolicy / PrivilegedEligibilitySchedule / PrivilegedAssignmentSchedule.ReadWrite.AzureADGroup)
3. Consent state stored in localStorage for session persistence

---

## Multi-Workload Architecture

### Unified Context Pattern

The app uses a **Unified Context** pattern to manage multiple workloads:

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

**Three contexts per provider (render performance).** `UnifiedPimProvider` renders three nested contexts from one state object: a data context (`useUnifiedData`: per-workload `data`, `consent`, `lastFetched`, memoized per workload so it only changes when those references change), a loading context (`useUnifiedLoading`: per-workload loading phase and progress plus `syncHistory`) and an actions context (`useUnifiedActions`: `loadWorkload`, `refreshWorkload`, `refreshAllWorkloads`, `enableWorkload`, `disableWorkload`, `clearWorkload`, `patchWorkload`, `peekWorkload`, `addSyncHistoryEntry`, `getGraphClient`; every member is a stable callback, so the object is created once). The Directory Roles hooks `useRolesData`, `useRolesLoading` and `useRolesActions` (`hooks/usePimData.ts`) are selectors over the `directoryRoles` slices of the same three contexts. During policy loading only the loading consumers (`GlobalProgressBar`, `LoadingStatus`, `SyncStatus`) and the components that show the roles re-render; the search boxes and every action-only consumer stay untouched. `useUnifiedPimData()` and `usePimData()` remain as compatibility hooks that merge the three slices and therefore re-render on any change.

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

### Service Layer Naming

After refactoring, all services follow a consistent pattern:

| Service | Purpose | Filename |
|---------|---------|----------|
| Directory Roles | Entra ID roles + policies | `directoryRoleService.ts` |
| PIM for Groups | PIM-onboarded groups (beta resources endpoint) | `pimGroupService.ts` |
| PIM Configuration | Read and write the PIM policy of a directory role (`getRolePolicy`, `updatePimPolicy`) | `pimConfigurationService.ts` |
| Configure Apply | The one apply engine of Configure: snapshot first, then policies and assignments step by step | `configureApplyService.ts` |
| Custom Extensions | PIM custom extensions (Preview): list and create the tenant's extension objects (beta) | `customExtensionService.ts` |
| Write Access | The reads of the Configure access check: your roles, owned groups and PIM group instances | `writeAccessService.ts` |
| Dry Run | The new assignments of the basket sent once as validation only | `assignmentDryRunService.ts` |
| Conditional Access | The optional Conditional Access check of the review | `conditionalAccessService.ts` |
| Principal Lookup | The people of an imported file that the loaded data does not name | `principalLookupService.ts` |
| Tenant | The tenant display name for the account button | `tenantService.ts` |
| Agent Blueprints | The blueprint names of Entra Agent IDs | `agentBlueprintService.ts` |
| User Search | Search users and groups in Add people | `userSearchService.ts` |
| Scope Options | Administrative units and applications as the scope of a new assignment | `scopeOptionsService.ts` |
| Group Membership | Members and owners of a group, read on demand in the Report | `groupMembershipService.ts` |
| Policy Parser | Parse PIM policy rule structures into `PolicySettings` | `utils/policyParser.ts` |
| Intune (future) | Intune RBAC roles | `intuneService.ts` |

---

## Data Flow

### Fetch Sequence for Directory Roles

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

### Fetch Sequence for PIM for Groups

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

> **Note**: PIM for Groups policy data (duration, MFA, approval) is fetched as part of the group data load.

### Data Aggregation

The `useAggregatedData` hook combines data from multiple workloads:

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
        <UnifiedPimProvider>            ← Multi-workload state, one engine per workload
          <ErrorBoundary>               ← Catches render errors, fallback UI
            <ToastProvider>             ← Toast notifications
              <GlobalProgressBar />
              <AppShell>{children}</AppShell>   ← Top bar, compact header, bottom navigation
              <OnboardingWrapper />     ← First-visit tour and feature highlights
            </ToastProvider>
          </ErrorBoundary>
        </UnifiedPimProvider>
    </ProtectedRoute>
  </AuthProvider>
</ThemeProvider>
```

The provider tree lives in `components/AppProviders.tsx` (a client component rendered by `app/layout.tsx`). The MSAL redirect bridge page `/redirect` is rendered outside this tree: MSAL v5 delivers popup and silent token responses to that page, which broadcasts them to the opener and must not be wrapped in `MsalProvider`.

> **Note:** `ViewModeProvider` is not part of the global layout. It is applied locally in `app/dashboard/page.tsx` only. `ConfigureBasketProvider` is applied locally in `app/configure/page.tsx`.

> **Note:** The static HTML and the hydration pass render only the start-up spinner; the tree follows on the client. In a demo tab `DemoModeProvider` wraps it and `DemoAuthProvider` takes the place of `AuthProvider`. The old `PimDataProvider` and `DirectoryRoleContext` are gone: Directory Roles live in `UnifiedPimProvider`.

### Caching Strategy

| Data Type | Cache Location | Expiry | Rationale |
|-----------|---------------|--------|-----------|
| Role Data | SessionStorage | 60 min | Balance between performance and freshness |
| Consent State | LocalStorage | Permanent | Remember user preferences |
| Workload Settings | LocalStorage | Permanent | User config |
| Navigation State | URL Search Params | Transient | Temporary overrides (e.g. ?workload=directoryRoles) |

### Navigation State Strategy

The application uses a **Hybrid State** approach for navigation:
1. **Persistent Preferences:** User toggle choices are saved to `localStorage` (default view).
2. **Transient Overrides:** URL parameters (e.g., from Dashboard drill-down links) override `localStorage` *temporarily*.
   - The overridden state is NOT saved back to storage.
   - Navigating away (clearing URL) restores the user's saved preference.
   - This prevents temporary filtered views from "sticking" and annoying the user.

---

## Configure

The **Configure page** (`/configure`) has four modes (Edit, Guided, Import, Access model) on one change basket, one review and one apply engine. See [Configure Page](./09-configure-page.md) and the Configure Feature section of `docs/architecture/features.md` for the files: `utils/configureBasket.ts` (basket), `utils/policyRules.ts` (the one write mapper), `utils/configurePreflight.ts` (review checks), `services/configureApplyService.ts` (apply) and `utils/configureHistory.ts` (snapshots and Undo).

---

## Performance Optimizations

### Worker Pool Pattern

All parallel API fetching uses a universal **worker pool utility**:

```typescript
// src/utils/workerPool.ts
async function runWorkerPool<TItem, TResult>({
    items: TItem[],
    workerCount: number,      // default: 8 (optimized)
    delayMs: number,          // default: 300ms (optimized)
    processor: (item, workerId) => Promise<TResult>,
    onProgress?: (current, total) => void
}): Promise<WorkerPoolResult<TItem, TResult>>
```

**Benefits:**
- **8x faster** than sequential (optimized from 3x)
- Prevents Graph API throttling (429)
- Consistent progress reporting
- Reusable for all workloads

**Performance Impact:**
- Policy fetch time: ~15-20s → ~3-5s (for 50 roles)
- **70-80% faster** than original implementation
- Still well within Microsoft Graph API throttling limits:
  - Large tenant (>500 users): 10% of quota usage
  - Medium tenant (50-500): 16% of quota usage
  - Small tenant (<50): 22% of quota usage

### Rate Limiting Strategy

| Workload / Operation | Workers | Delay | Where |
|----------------------|---------|-------|-------|
| Directory Roles: per-role policy fetch | 12 | 200ms | `concurrentFetchPolicies` (called by `workloads/directoryRolesAdapter.ts`); raised from 8/300ms in v2.1.0 |
| Directory Roles: scope enrichment | 8 | 300ms | `enrichAssignmentsWithScope` |
| PIM for Groups: managed groups (full load, 4 calls per group) | 3 | 500ms | `fetchAllPimGroupData` |
| PIM for Groups: managed groups (smart refresh, 2 calls per group) | 3 | 500ms | `refreshPimGroupAssignments` |
| PIM for Groups: unmanaged groups | 5 | 200ms | `fetchAllPimGroupData`, `refreshPimGroupAssignments` (one lightweight call per group) |
| PIM for Groups: member count of unmanaged groups | 6 | 500ms | `addMemberCounts` (`pimGroupService.ts`) |
| Worker pool default (if not specified) | 8 | 300ms | `runWorkerPool` |

The Configure apply (`services/configureApplyService.ts`) runs its steps on `runWorkerPool` with 4 workers and a 500 ms delay. `updatePimPolicy` is not pooled: its rules are PATCHed one at a time with a 300 ms pause. Every Graph call, pooled or not, also passes through `graphRateLimiter` (`utils/rateLimiter.ts`, sliding window of 500 resource units per 10 seconds).

**Microsoft Graph API Limits (Identity & Access):**
- Small tenant: 3,500 ResourceUnits per 10 sec
- Medium tenant: 5,000 ResourceUnits per 10 sec
- Large tenant: 8,000 ResourceUnits per 10 sec
- Policy fetch cost: 2 ResourceUnits per request, derived from the Graph rules (a request costs 1, `$expand` adds 1). Microsoft publishes no cost for `/policies/roleManagementPolicyAssignments`, so this is not measured; the `x-ms-resource-unit` response header shows the real value.
- The app's own cap is 500 ResourceUnits per 10 sec (`graphRateLimiter`): 14% of a small, 10% of a medium and 6% of a large tenant's budget, about 25 policy requests per second.

---

## UI/UX Design Decisions

### Dashboard Cards Aggregation

**Decision:** Combined totals with breakdown in description

```
┌──────────────────────────────┐
│  Total Items                 │
│  142                         │
│  130 roles + 12 groups       │  ← Show breakdown
└──────────────────────────────┘
```

**Rationale:**
- One card per metric, not per workload
- Breakdown in description for detail
- Scales to future workloads

### Groups Display Strategy

**Decision:** Show ALL role-assignable groups, highlight PIM-enabled:

| Badge | Meaning |
|-------|---------|
| 🟢 PIM Active | Group has active/eligible assignments |
| ⚪ No PIM | Role-assignable but no PIM assignments |

**Rationale:**
- User sees full potential
- Clear which groups are not yet protected

### Loading Progress

**Decision:** Consistent progress format and combined loadbar:

- **LoadingStatus:** `(current/total)` format for both workloads
- **GlobalProgressBar:** Weighted average of all loading workloads
  - Blue gradient: Only roles
  - Emerald gradient: Only groups
  - Multi-color gradient: Both simultaneously

---

## Future Workloads

### Phase 4: M365 Workloads

#### Intune Roles
```
Endpoint: GET /deviceManagement/roleDefinitions
Permissions: DeviceManagementRBAC.Read.All
Relationship: Some Intune roles link to Entra groups
```

#### Exchange Roles
```
Endpoint: GET /roleManagement/exchange/roleDefinitions
Permissions: RoleManagement.Read.Exchange
Note: Limited Graph API support, may need EXO PowerShell
```

### Workload Link Detection (Phase 4+)

Many M365 workloads link to Entra ID groups:

```
PIM Group "IT Admins"
├── Linked to: Intune "Helpdesk Administrator" role
├── Linked to: Exchange "Organization Management" role
└── Linked to: Defender "Security Operator" role
```

The `workloadLinkDetector` service will detect and visualize these relationships.

---

## Context Diagram

The application within the external ecosystem:

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

## Quality Attributes (NFRs)

| Attribute | Requirement | How Achieved |
|-----------|-------------|--------------|
| **Performance** | Initial load < 15s, policies < 3min | Worker pool, progressive loading |
| **Scalability** | Support 1000+ roles, 100+ groups | Pagination, lazy loading |
| **Availability** | 99.99% uptime | Static hosting (Cloudflare edge) |
| **Security** | Minimal permissions, no data storage | MSAL, incremental consent, client-side only |
| **Maintainability** | Modular code, clean architecture | Layered architecture, DRY, TypeScript |
| **Usability** | Intuitive UI, < 3 clicks to action | Progressive disclosure, smart defaults |
| **Compatibility** | Modern browsers (Chrome, Edge, Firefox) | ES2020+, no polyfills needed |

---

## Architectural Decision Records (ADRs)

Key architectural decisions documented for future reference:

| # | Decision | Status | Rationale |
|---|----------|--------|-----------|
| ADR-001 | **Client-side only** (no backend) | Accepted | Avoids server costs, simpler deployment, data stays with user |
| ADR-002 | **Static Export** via Next.js | Accepted | Cloudflare Pages hosting, no server-side rendering needed |
| ADR-003 | **UnifiedPimContext** for multi-workload | Accepted | Single source of truth, scales to new workloads |
| ADR-004 | **Worker Pool pattern** for API throttling | Accepted | Prevents 429 errors, up to 8x faster than sequential |
| ADR-005 | **Aggregated cards** instead of per-workload | Accepted | Cleaner UI, scales better |
| ADR-006 | **Incremental Consent** per workload | Accepted | Least privilege, user chooses which data |
| ADR-007 | **Beta API** only where v1.0 lacks the data: `isPrivileged`, alerts, custom extensions, PIM for Groups resources, group members and member count | ⚠️ Risk Accepted | Needed for security insights and PIM for Groups; each beta call carries its reason in a code comment. The `isPrivileged` read falls back to v1.0 without that field |

> See `docs/adr/` for detailed ADR documents (if created).

---

## Security Architecture

### Data Classification

| Data Type | Sensitivity | Storage | Lifetime |
|-----------|-------------|---------|----------|
| Access tokens | High | Memory only | Session |
| Role data | Medium | SessionStorage | 60 minutes |
| Consent state | Low | LocalStorage | Permanent |
| User preferences | Low | LocalStorage | Permanent |

### Data in Transit

- **HTTPS only** - Enforced by Cloudflare
- **TLS 1.2+** - Graph API requirement
- **No data transmission to third parties** - Only Microsoft APIs

### Authentication & Authorization

```
┌───────────────────────────────────────────────────────────────┐
│                    Authorization Flow                          │
│                                                                │
│  User ──► MSAL Popup ──► Microsoft Identity ──► Token         │
│                              Platform                          │
│                                                                │
│  Token Scopes (cumulative):                                   │
│  ├── Login: ten read scopes (see Incremental Consent Strategy) │
│  ├── PIM for Groups: PrivilegedAccess.Read.AzureADGroup,      │
│  │     RoleManagementPolicy.Read.AzureADGroup                  │
│  ├── Security Alerts: RoleManagementAlert.Read.Directory       │
│  ├── Custom Extensions: PrivilegedAccess-CustomExt.Read.All    │
│  └── Configure: granular *.ReadWrite.Directory and            │
│        *.ReadWrite.AzureADGroup scopes                         │
│                                                                │
└───────────────────────────────────────────────────────────────┘
```

### Security Principles

1. **Least Privilege** - Only request necessary scopes
2. **No Server-side Storage** - No data stored on servers
3. **Consent Transparency** - User sees which permissions are requested
4. **Token Handling** - No manual token storage, MSAL managed

---

## Error Handling

### Client-side Error Handling

| Error Type | Handling | User Feedback |
|------------|----------|---------------|
| **Network errors** | Retry with exponential backoff | Toast notification |
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

- All logging goes through `Logger` (`utils/logger.ts`); `src/` contains no direct `console.*` calls
- Level is dynamic: `localStorage.setItem('LOG_LEVEL', 'DEBUG')` switches on debug output in any environment
- Error boundaries (global) catch unhandled render exceptions; no external monitoring service is integrated

---

## Deployment Architecture

For detailed deployment instructions, see: **[10-deployment.md](./10-deployment.md)**

### Overview

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

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_CLIENT_ID` | Microsoft Entra ID App Registration Client ID |
| `NEXT_PUBLIC_REDIRECT_URI` | OAuth redirect (auto-detected if empty) |

---

## Appendix: File Structure

```
src/
├── app/                          # Routes: /, dashboard, report, configure, settings, help, redirect, demo
├── components/
│   ├── AppProviders.tsx          # The provider tree (rendered by app/layout.tsx)
│   ├── ui/                       # Primitives: Button, Chip, Dialog, Menu, SegmentedControl, StatCard, Tag, Skeleton, Toast, DurationSlider, DemoLock, ...
│   ├── charts/                   # Donut, StackedBar, BarList (own SVG charts)
│   ├── icons/                    # Icon.tsx, iconData.ts (own icon set)
│   ├── shell/                    # AppShell, ShellFrame, TopBar, CompactHeader, BottomNav, AccountMenu, HelpPanel, EnvironmentSwitcher, DemoBanner
│   ├── pdf/                      # ReportDocument.tsx (PDF export renderer)
│   ├── ErrorBoundary.tsx         # Error catching + fallback UI
│   ├── GlobalProgressBar.tsx     # Combined loading progress
│   ├── LoadingStatus.tsx         # Inline loading indicators
│   ├── WorkloadChips.tsx         # Workload toggle chips
│   └── ThemeProvider.tsx         # Dark/light mode
│
├── workloads/                    # WorkloadEngine, session cache, Directory Roles and PIM for Groups adapters
│
├── services/
│   ├── directoryRoleService.ts   # Entra ID Roles + Policies
│   ├── pimGroupService.ts        # PIM for Groups
│   ├── pimConfigurationService.ts # Role policy read and write
│   ├── configureApplyService.ts  # The apply engine of Configure
│   ├── assignmentDryRunService.ts # Dry run of new assignments (isValidationOnly)
│   ├── writeAccessService.ts     # Reads of the Configure access check
│   ├── conditionalAccessService.ts # Optional Conditional Access check
│   └── ...                       # customExtension, groupMembership, userSearch, scopeOptions, principalLookup, tenant, agentBlueprint
│
├── contexts/
│   ├── UnifiedPimContext.tsx     # Multi-workload state (data, loading, actions)
│   ├── ConfigureBasketContext.tsx # The Configure basket
│   ├── DemoModeContext.tsx       # Live demo flag
│   ├── ViewModeContext.tsx       # View mode state
│   └── ToastContext.tsx          # Toast notification system
│
├── hooks/
│   ├── usePimData.ts             # Directory Roles selectors over UnifiedPimContext
│   ├── usePimSelectors.ts        # Thin selectors over UnifiedPimContext
│   ├── useAggregatedData.ts      # Combined statistics across workloads
│   ├── useIncrementalConsent.ts  # Consent flow
│   ├── useConsentedWorkloads.ts  # Consent detection
│   ├── useDashboardFilter.ts     # The shared filter `f` in the URL
│   ├── useReportUrlState.ts      # Report URL state
│   ├── useWriteAccess.ts         # Configure access check
│   ├── useConfigureReview.ts     # Configure review (pre-flight, dry run)
│   ├── useConfigureApply.ts      # Configure apply, result and undo
│   ├── useLeaveGuard.ts          # Warn on unsaved changes in Configure
│   ├── useOnboarding.ts          # First-visit tour and feature highlight state
│   └── useUpdateCheck.ts         # GitHub release check (self-hosted only)
│
├── types/
│   ├── shared.types.ts           # Principal, AuthenticationContext, CustomExtensionSlots (shared shapes)
│   ├── directoryRole.types.ts    # Role data types (PimPolicyRule, ApprovalStage, PrimaryApprover)
│   ├── pimGroup.types.ts         # Group data types
│   ├── workload.types.ts         # Workload state types
│   ├── configure.types.ts        # The Configure basket
│   ├── dashboardFilter.types.ts  # Filter types
│   ├── securityAlerts.types.ts   # Security alert types
│
├── demo/                         # The live demo: runtime patches, fake Graph, Contoso tenant
│
└── utils/
    ├── workerPool.ts             # Parallel fetching utility (default: 8 workers, 300ms)
    ├── rateLimiter.ts            # graphRateLimiter: sliding window, 500 RU per 10 s
    ├── graphClient.ts            # createGraphClient, ThrottleWatcher (429 pauses the limiter)
    ├── retryUtils.ts             # withRetry() exponential backoff for 429/5xx
    ├── errorUtils.ts             # getErrorMessage/getErrorCode/isAbortError for catch (error: unknown)
    ├── graphErrorMapping.ts      # Raw Graph errors to user-friendly messages
    ├── odataUtils.ts             # escapeODataString() and OData query helpers
    ├── durationUtils.ts          # ISO 8601 duration parsing + formatting
    ├── policyRules.ts            # The one write mapper for policy rules
    ├── configureBasket.ts        # Basket reducers and storage
    ├── configurePreflight.ts     # The checks of the review as data
    ├── policyConflicts.ts        # What changes for people who activate when a policy changes
    ├── throttle.ts               # createTrailingThrottle for batched progress updates
    ├── etagCache.ts              # ETag-based HTTP caching
    ├── scopeUtils.ts             # Scope type detection (6 scope types)
    ├── logger.ts                 # Structured logging with dynamic levels
    ├── authContextApi.ts         # Fetch Conditional Access auth contexts
    ├── alertFormatting.ts        # Security alert icons + colors
    └── exportReport.ts           # content of the PDF/CSV export as data
```

---
