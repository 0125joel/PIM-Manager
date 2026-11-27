# Introduction

## What is PIM Manager?

Admin role management for Microsoft Entra and Azure. PIM Manager is a web application that helps administrators **view and analyze** who holds which admin role, under which Privileged Identity Management (PIM) settings, for Microsoft Entra ID roles and groups and for Azure resources. Azure is read only for now.

### The Problem It Solves

Managing PIM settings in a large organization is challenging:

| Challenge | How PIM Manager Helps |
|-----------|-----------------------|
| No bulk view of all role configurations | Shows all roles, groups, and their PIM settings in one dashboard |
| Clicking through each role takes hours | Generates a comprehensive report in ~30 seconds |
| No easy way to compare configurations | Side-by-side comparison of role settings |
| Hard to see PIM Group settings | Full support for PIM for Groups |

---

## Target Users

This application is designed for:

- **Global Administrators** managing PIM policies
- **Security Teams** auditing role configurations
- **M365 Engineers** implementing governance standards

---

## Key Features

### Dashboard Page
- **View Modes:** Toggle between **Basic** (high-level overview) and **Advanced** (detailed metrics) views
- **Role Overview:** Searchable list of roles with instant drill-down navigation to the Report page
- **Security Alerts:** Read-only view of PIM security recommendations (e.g., potential stale accounts)
- **Overview Cards:** Quick insights into total roles, active sessions, and configuration health
- **Security Charts:** Visual breakdown of privileged vs. non-privileged roles and assignment types
- **Actionable Insights:** "Approvers Overview" and "Configuration Errors" widgets (Advanced mode)
- **Pro Tips:** Dynamic suggestions for improving your security posture

### Report Page (Main Feature)
- **Multi-Workload:** View both Directory Roles and PIM for Groups in one unified interface
- View all Microsoft Entra ID roles with their PIM configurations
- Filter by role type, assignment type, member type, scope, and user
- Export as CSV (Overview, or the format of Configure Import) or as a JSON backup of every policy and assignment
- See who is assigned to each role (eligible, active, permanent)
- View scope information (Tenant-wide, App-scoped, RMAU)
- Authentication Context display for roles requiring specific access

### Configure Page
- **Edit**: master-detail list of roles and groups with Activation, Assignment and Notification settings, Who has it, and Select several
- **Guided**: a route in steps for a change on many targets, optionally from the access model
- **Import**: CSV or JSON files compared with the tenant, then one review and apply; the **Access model** page shows the PIM Monitor catalog
- Apply consistent activation settings (MFA, approval, max duration) across multiple roles and groups
- Create, manage, and remove eligible/active assignments with AU scope support

> [!NOTE]
> Write permissions for Configure (`RoleManagementPolicy.ReadWrite.Directory` and related scopes) are requested via incremental consent, only when you choose Grant permission in Configure. Read-only reporting does not require these permissions.

### Azure Pages
- **Azure Dashboard** (`/azure`): who can use privileged access on your Azure resources and on which terms. Assignments, role settings and PIM's own alerts for management groups, subscriptions, resource groups and resources, in Basic and Advanced, with a PDF or CSV export
- **Azure Report** (`/azure/report`): the roles and assignments per scope, with a scope tree, the role settings and a CSV export
- Every Azure number is about the scope you choose in the scope bar; delegated subscriptions (Lighthouse) can be left out
- Read only, with your own Azure roles: you see what you can read, never a total for the whole tenant. Azure is turned on per account with a one-time consent for Azure Resource Manager

### Audit Page
- **Entra** (`/audit`): role and group activations, assignment and settings changes and role changes outside PIM in one timeline, with filters and a **No activation** view. That view reports activity in the period, not whether a role can be removed
- Up to 30 days from the Entra audit log with `AuditLog.Read.All`, which an admin approves once for the tenant. Choose Log Analytics workspaces in Settings to read further back; the page then opens on 180 days
- **Azure** (`/azure/audit`): the same page for the Azure scopes you can read, from the Azure activity log and the PIM requests. It opens on 30 days and goes up to 90, or up to a year with workspaces. No new permission: your Azure roles decide what you see
- An activation through a group shows like a direct one, with the group under **Through**
- Export the current view as CSV, JSON or PDF

---

## Finding your way: the tours

Nobody reads a manual before they start clicking, so PIM Manager explains itself while you look around. The first time you open a part of the app, a short tour starts. First one through the app itself: the switch between Entra ID and Azure, the pages, Refresh, Help, Settings and your account. Then one for the page in front of you. On Azure it starts with the scope, because every Azure number is about the scope you chose.

- Every part gets its own tour the first time you open it: the Dashboard in Basic and in Advanced, the Report, Audit, Configure and each of its modes, and the same on Azure.
- A tour is a handful of steps: what you see, what it means and what you can do with it. The last step tells you where to look next.
- **Skip tour** ends that tour. **Turn off tours** stops every tour from starting by itself; switch them back on under **Settings > Display > Tours**.
- **Start the tour** in Help, in the panel and in the full guide, lets you pick: per product and per page, or **All of Entra** and **All of Azure** in one go.
- In the live demo PIM Manager first asks **Do you want to start the tour?**. **Start the tour** shows the tour of the app and of that page; every other page shows its own the first time you open it; **No thanks** skips the tour of that page, and the next parts still show their own.
- What the tours remember, which ones you saw and whether they are on, stays in this browser. No tenant data.

---

## Prerequisites

### Microsoft Entra App Registration

The application requires a Microsoft Entra app registration with the following **delegated permissions**:

| Permission | Purpose |
|------------|---------|
| `User.Read` | Read signed-in user profile |
| `RoleManagement.Read.Directory` | Read role definitions and assignments |
| `RoleAssignmentSchedule.Read.Directory` | Read PIM active assignments |
| `RoleEligibilitySchedule.Read.Directory` | Read PIM eligible assignments |
| `RoleManagementPolicy.Read.Directory` | Read PIM policies |
| `Policy.Read.ConditionalAccess` | Read authentication contexts |
| `User.Read.All` | Read user display names |
| `Group.Read.All` | Read group display names |
| `AdministrativeUnit.Read.All` | Read administrative unit names |
| `Application.Read.All` | Read application names |

**Optional Read Permissions** (features gracefully degrade if not granted):

| Permission | Feature Enabled | Fallback Behavior |
|------------|-----------------|-------------------|
| `RoleManagementAlert.Read.Directory` | Security Alerts panel | Panel hidden if permission denied (403) |
| `AuditLog.Read.All` | Audit page | The page asks you to grant it, and an admin must approve it once for your tenant; the rest of the app works without it. Reading the log also needs Reports Reader, Security Reader or Security Administrator |
| `https://api.loganalytics.io/Data.Read` | Audit page, from Log Analytics workspaces you choose in Settings | Audit reads 30 days of the Entra audit log and 90 days of the Azure activity log |
| `PrivilegedAccess.Read.AzureADGroup` | PIM for Groups workload | Workload not shown in settings |
| `RoleManagementPolicy.Read.AzureADGroup` | PIM for Groups policies | Groups data incomplete without this |
| `PrivilegedAccess-CustomExt.Read.All` | List of PIM custom extensions (Preview) | Picker and orphan check hidden; which extension a policy links still shows |
| `Policy.Read.All` | Configure's Conditional Access check (asked on demand) | The check shows "Not checked"; the rest of the review runs |
| `user_impersonation` (Azure Resource Manager) | The Azure environment: Azure dashboard and Azure Report (PIM for Azure resources), asked with a consent popup when you turn Azure on | Every Azure page shows the consent screen |

**Configure Write Permissions** (requested via incremental consent when you choose Grant permission in Configure):

| Permission | Feature Enabled |
|------------|-----------------|
| `RoleManagementPolicy.ReadWrite.Directory` | Update PIM policies for Directory Roles |
| `RoleEligibilitySchedule.ReadWrite.Directory` | Create eligible assignments for Directory Roles |
| `RoleAssignmentSchedule.ReadWrite.Directory` | Create active assignments for Directory Roles |
| `RoleManagementPolicy.ReadWrite.AzureADGroup` | Update PIM policies for PIM for Groups |
| `PrivilegedEligibilitySchedule.ReadWrite.AzureADGroup` | Create eligible assignments for PIM for Groups |
| `PrivilegedAssignmentSchedule.ReadWrite.AzureADGroup` | Create active assignments for PIM for Groups |

> [!TIP]
> The application follows the **least privilege principle**. Read-only permissions cover all reporting features. Write permissions are only requested when you choose Grant permission in Configure, and only for the workload you choose to configure.



### Supported Browsers

Any modern browser (Chrome, Edge, Firefox, Safari) with JavaScript enabled.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    User's Browser                       │
├─────────────────────────────────────────────────────────┤
│  Next.js React Application                              │
│  ├── Dashboard Page (Analytics & Insights)              │
│  ├── Report Page (Detailed Configuration View)          │
│  ├── Audit Page (Activations & Changes)                 │
│  ├── Configure Page (Edit / Guided / Import / Model)    │
│  └── Azure Pages (Dashboard / Report / Audit)           │
├─────────────────────────────────────────────────────────┤
│  State Management Layer                                 │
│  ├── UnifiedPimContext (Workload Orchestration)         │
│  ├── AzureContext (Azure resources)                     │
│  └── ViewModeContext (UI Preferences)                   │
├─────────────────────────────────────────────────────────┤
│  Data Services                                          │
│  ├── directoryRoleService (Roles & Policies)            │
│  ├── pimGroupService (PIM for Groups)                       │
│  └── SessionStorage (60-minute cache)                   │
├─────────────────────────────────────────────────────────┤
│  Microsoft Authentication Library (MSAL)                │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
            ┌─────────────────────────┐
            │   Microsoft Graph API   │
            │   (Microsoft Entra ID / PIM)      │
            └─────────────────────────┘
```

All data fetching happens **client-side** in the user's browser. The application:
1. Authenticates the user via Microsoft Entra ID
2. Acquires an access token with the required permissions
3. Makes direct calls to Microsoft Graph API
4. Processes and displays the data

> [!NOTE]
> There is no backend server. All sensitive operations use the user's own permissions.

### Performance & Advanced Features

**Smart Refresh:**
- Directory Roles: re-reads the assignments without blocking the page, then every policy in the background
- PIM for Groups: re-reads the schedule instances and policies per onboarded group and keeps the group details
- Graph has no delta for PIM assignments or policies, so a setting changed in Entra shows after one Refresh only because both are read again

**SessionStorage Caching:**
- Data persists across page navigation
- 60-minute freshness check before re-fetching
- Reduces unnecessary API calls

**Workload Management:**
- Enable/disable specific workloads (Directory Roles, PIM for Groups)
- Permission-based feature visibility
- Per-workload sync status tracking

**Graceful Degradation:**
- Optional features (Security Alerts, PIM for Groups) hide if permissions missing
- No breaking errors for missing optional permissions
- Clear indicators when features are unavailable

---

## Next Steps

- [Folder Structure](./02-folder-structure.md) - Understand how the code is organized
- [Data Flow](./03-data-flow.md) - Learn how data is fetched and processed
