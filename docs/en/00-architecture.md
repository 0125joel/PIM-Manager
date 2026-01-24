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
17. [Test Strategy](#test-strategy)

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
│  ┌──────────────┐  ┌──────────────┐                           │
│  │directoryRole │  │pimGroup      │                           │
│  │Service       │  │Service       │                           │
│  └──────────────┘  └──────────────┘                           │
│  ┌──────────────┐  ┌──────────────┐                           │
│  │pimConfigur-  │  │delta         │                           │
│  │ationService  │  │Service       │                           │
│  └──────────────┘  └──────────────┘                           │
└─────────────────────────────────────────────────────────────┘
```

**Guidelines:**
- Each module has a single responsibility (Single Responsibility Principle)
- Modules communicate via props, contexts, or hooks - never directly
- New workloads can be added without modifying existing code

### Clean Code

The codebase follows strict clean code principles:

| Principle | Application in PIM Manager |
|-----------|----------------------------|
| **Meaningful Names** | `directoryRoleService.ts` not `roleData.ts`, `useAggregatedData` not `useData` |
| **Small Functions** | Max ~50 lines per function, helper functions for complex logic |
| **DRY (Don't Repeat)** | `workerPool.ts` utility reused by all services |
| **Consistent Formatting** | Prettier + ESLint configuration enforced |
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
| `InteractiveStatCard` | Dashboard, Report, future pages |
| `LoadingStatus` | Dashboard header, Report header |
| `GlobalProgressBar` | All pages (via layout) |
| `workerPool.ts` | directoryRoleService, pimGroupService, future services |
| `useAggregatedData` | OverviewCards, SecurityCharts, future components |
| `ScopeBadge` | Role details, Group details, Reports |

**Design Pattern: Composition over Inheritance**

```tsx
// ❌ Don't: Props drilling
<Dashboard>
  <Cards rolesData={...} groupsData={...} loading={...} />
</Dashboard>

// ✅ Do: Hook-based data access
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
- Consistent icons (Lucide) and colors (Tailwind palette)
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

**Incremental Consent Strategy:**
1. Base permissions on login (User.Read, RoleManagement.Read.Directory)
2. Request additional scopes when user activates a workload
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
│  │ enableWorkload  │  │ refreshWorkload │  │register-   │   │
│  └─────────────────┘  └─────────────────┘  │Workload-   │   │
│                                            │Refresh     │   │
│  ┌─────────────────────────────────────┐   └────────────┘   │
│  │ refreshAllWorkloads() - UNIVERSAL   │                    │
│  │ (delegates to registered handlers)  │                    │
│  └─────────────────────────────────────┘                    │
└─────────────────────────────────────────────────────────────┘
          │                         │
          ▼                         ▼
┌──────────────────┐      ┌──────────────────┐
│ DirectoryRole    │      │ PimGroup         │
│ Context          │      │ Service          │
│ (registers its   │      │                  │
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

### Service Layer Naming

After refactoring, all services follow a consistent pattern:

| Service | Purpose | Filename |
|---------|---------|----------|
| Directory Roles | Entra ID roles + policies | `directoryRoleService.ts` |
| PIM Groups | PIM-onboarded groups (beta resources endpoint) | `pimGroupService.ts` |
| PIM Configuration | App-wide configuration and settings | `pimConfigurationService.ts` |
| Delta Service | Smart processing of object updates | `deltaService.ts` |
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

### Fetch Sequence for PIM Groups

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

> **Note**: PIM Groups does NOT currently fetch policies (duration, MFA, approval).
> This is a planned extension for future versions.

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
| Role Data | SessionStorage | 5 min | Frequent updates needed |
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

| Workload | Workers | Delay | Rationale |
|----------|---------|-------|-----------|
| Directory Roles Policies | 8 | 300ms | Optimized for speed while respecting API limits |
| PIM Groups | 8 | 300ms | Consistent configuration across workloads |
| Policy Comparison | 8 | 300ms | Fast refresh operations |

**Microsoft Graph API Limits (Identity & Access):**
- Small tenant: 3,500 ResourceUnits per 10 sec
- Medium tenant: 5,000 ResourceUnits per 10 sec
- Large tenant: 8,000 ResourceUnits per 10 sec
- Policy fetch cost: ~3 ResourceUnits per request

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
│    │          │      │ • PIM Groups  │     │ • Static files │      │
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
| ADR-001 | **Client-side only** (no backend) | ✅ Accepted | Avoids server costs, simpler deployment, data stays with user |
| ADR-002 | **Static Export** via Next.js | ✅ Accepted | Cloudflare Pages hosting, no server-side rendering needed |
| ADR-003 | **UnifiedPimContext** for multi-workload | ✅ Accepted | Single source of truth, scales to new workloads |
| ADR-004 | **Worker Pool pattern** for API throttling | ✅ Accepted | Prevents 429 errors, 3x faster than sequential |
| ADR-005 | **Aggregated cards** instead of per-workload | ✅ Accepted | Cleaner UI, scales better |
| ADR-006 | **Incremental Consent** per workload | ✅ Accepted | Least privilege, user chooses which data |
| ADR-007 | **Beta API** for isPrivileged property | ⚠️ Risk Accepted | Needed for security insights, fallback to v1.0 |

> See `docs/adr/` for detailed ADR documents (if created).

---

## Security Architecture

### Data Classification

| Data Type | Sensitivity | Storage | Lifetime |
|-----------|-------------|---------|----------|
| Access tokens | High | Memory only | Session |
| Role data | Medium | SessionStorage | 5 minutes |
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
│  ├── Login: User.Read, openid, profile                        │
│  ├── Roles: RoleManagement.Read.Directory                     │
│  ├── PIM Groups: PrivilegedAccess.Read.AzureADGroup           │
│  └── Configure: RoleManagement.ReadWrite.Directory            │
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

- **Development**: Console.log/warn/error
- **Production**: Error boundary catches unhandled exceptions
- **Optional**: Sentry integration for production monitoring

---

## Deployment Architecture

For detailed deployment instructions, see: **[08-deployment.md](./08-deployment.md)**

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
| `NEXT_PUBLIC_CLIENT_ID` | Azure AD App Registration Client ID |
| `NEXT_PUBLIC_REDIRECT_URI` | OAuth redirect (auto-detected if empty) |

---

## Test Strategy

### Test Pyramid

```
         ┌─────────────────┐
         │     E2E         │  ← Manual testing, Playwright (future)
         │   (few tests)   │
         └───────┬─────────┘
                 │
         ┌───────┴─────────┐
         │  Integration    │  ← Critical user flows
         │  (some tests)   │
         └───────┬─────────┘
                 │
         ┌───────┴─────────┐
         │     Unit        │  ← Utilities, hooks, services
         │  (many tests)   │
         └─────────────────┘
```

### Priorities

| Component | Test Type | Priority | Reason |
|-----------|-----------|----------|--------|
| `workerPool.ts` | Unit | 🔴 High | Critical utility for all fetching |
| `useAggregatedData.ts` | Unit | 🔴 High | Data aggregation logic |
| `pimApi.ts` | Unit | 🟡 Medium | Policy parsing functions |
| Dashboard flow | E2E | 🟡 Medium | Happy path validation |
| Error handling | Integration | 🟡 Medium | 429 throttling scenario |

### Test Tools (Recommended)

| Tool | Purpose |
|------|---------|
| **Jest** | Unit test runner |
| **React Testing Library** | Component tests |
| **Playwright** | E2E browser tests |
| **MSW** | Mock Graph API responses |

> **Note**: Test infrastructure is not yet implemented. This section serves as a roadmap.

---

## Appendix: File Structure

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

*Last updated: December 24, 2024*
