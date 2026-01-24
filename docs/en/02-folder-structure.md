# Folder Structure

This document explains the organization of the PIM Configurator codebase. Understanding this structure helps you navigate the code and find specific functionality.

---

## Root Directory

```
PIM-configurator/
├── docs/                  # Documentation (you are here)
├── public/                # Static assets (icons, images)
├── src/                   # Source code (main application)
├── package.json           # Dependencies and scripts
├── DEPLOYMENT.md          # Deployment instructions
└── README.md              # Project overview
```

---

## Source Code (`/src`)

The `/src` folder contains all application code, organized by purpose:

```
src/
├── app/                   # Pages (Next.js App Router)
├── components/            # Reusable UI components
├── contexts/              # React Context providers
├── services/              # Data fetching logic
├── types/                 # TypeScript type definitions
├── utils/                 # Helper functions
├── config/                # Configuration constants
└── hooks/                 # Custom React hooks
```

---

## Detailed Breakdown

### 📁 `src/app/` - Pages

Each subfolder represents a page in the application.

| Folder | Purpose |
|--------|---------|
| `app/page.tsx` | Landing page (login) |
| `app/dashboard/` | Dashboard overview |
| `app/report/` | Main report page with all role data |
| `app/configure/` | (Coming Soon) Bulk configuration page |
| `app/layout.tsx` | Shared layout (navigation, providers) |
| `app/globals.css` | Global styles |

> [!NOTE]
> Next.js uses **file-based routing**. The folder structure directly maps to URLs:
> - `/app/report/page.tsx` → `https://yourapp.com/report`

---

### 📁 `src/components/` - UI Components

Reusable building blocks used across pages.

| Component | Purpose |
|-----------|---------|
| `Sidebar.tsx` | Side navigation bar |
| `HelpModal.tsx` | Help documentation overlay |
| `LoadingStatus.tsx` | Inline loading indicator for background policy fetch |
| `ScopeBadge.tsx` | Badge showing assignment scope (Tenant-wide, App, RMAU) |
| `RoleFilters.tsx` | Filter UI component for Report page |
| `RoleList.tsx` | List of selectable roles (used in Configure) |
| `RoleSettingsForm.tsx` | Form for PIM settings |
| `ProgressModal.tsx` | Progress indicator for bulk operations |

---

### 📁 `src/contexts/` - Shared State

React Context for sharing data across pages.

| File | Purpose |
|------|---------|
| `PimDataContext.tsx` | **Central data store** for all PIM data |

> [!IMPORTANT]
> `PimDataContext` is the heart of data sharing. It:
> - Fetches data once
> - Caches it in session storage
> - Provides it to all pages
> - Handles background policy loading

---

### 📁 `src/services/` - Data Fetching

Core logic for interacting with Microsoft Graph API.

| File | Purpose |
|------|---------|
| `directoryRoleService.ts` | **Directory Role data fetching** |
| `pimConfigurationService.ts` | **PIM Policy management** |

This file contains:
- `getRoleDefinitions()` - Fetch role definitions
- `fetchSinglePolicy()` - Fetch single role's PIM policy
- `concurrentFetchPolicies()` - Background policy fetching
- `getAllRolesOptimizedWithDeferredPolicies()` - Main data loading function

> [!WARNING]
> **Throttling Protection**: This file includes delays and concurrent worker limits to avoid Microsoft Graph API throttling. Do not remove these safeguards.

---

### 📁 `src/types/` - Type Definitions

TypeScript interfaces describing data structures.

| File | Purpose |
|------|---------|
| `roleData.ts` | All PIM-related types |
| `index.ts` | Exports for easy importing |

Key types:
- `RoleDefinition` - An Azure AD role
- `RoleAssignment` - A permanent assignment
- `PimEligibilitySchedule` - An eligible assignment
- `PimPolicy` - PIM configuration for a role
- `RoleDetailData` - Combined data for one role

---

### 📁 `src/utils/` - Helper Functions

Utility functions and API helpers.

| File | Purpose |
|------|---------|
| `pimApi.ts` | **[DEPRECATED]** Moved to services/pimConfigurationService |
| `scopeUtils.ts` | Scope detection and display utilities (Tenant-wide, App-scoped, RMAU) |
| `authContextApi.ts` | Authentication Context Class Reference API |

---

### 📁 `src/config/` - Configuration

Application configuration constants.

| File | Purpose |
|------|---------|
| `authConfig.ts` | Azure AD authentication configuration |
| `constants.ts` | Application-wide constants |
| `pdfExportConfig.ts` | **PDF Export configuration** - single source of truth for export sections and stats |
| `locales/en.ts` | **Externalized Text** - Centralized UI strings (Help, Settings, etc.) |

> [!TIP]
> To add a new stat to the PDF export, simply add an entry to the `OVERVIEW_STATS` array in `pdfExportConfig.ts`. It will automatically appear in the export modal and PDF.

> [!CAUTION]
> The `authConfig.ts` file contains your **Azure AD client ID**. Ensure this matches your app registration.

---

### 📁 `src/hooks/` - Custom Hooks

Reusable React hooks.

| File | Purpose |
|------|---------|
| `usePimData.ts` | **Main data hook** - provides access to PimDataContext |
| `useRoleFilters.ts` | Filter state management for the Report page |
| `useRoleSettings.ts` | Hook for managing role settings state |

---

## File Relationships

```mermaid
flowchart TD
    subgraph "Pages"
        A[Dashboard]
        B[Report]
        C[Configure]
    end

    subgraph "Shared"
        D[PimDataContext]
    end

    subgraph "Services"
        E[roleDataService]
    end

    subgraph "External"
        F[Microsoft Graph API]
    end

    A --> D
    B --> D
    C --> D
    D --> E
    E --> F
```

---

## Next Steps

- [Data Flow](./03-data-flow.md) - See how data moves through these files
- [Graph API Calls](./04-graph-api-calls.md) - Learn which APIs are called
