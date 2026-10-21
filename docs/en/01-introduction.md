# Introduction

## What is PIM Manager?

PIM Manager is a web application that helps Microsoft 365 administrators **view and analyze** Privileged Identity Management (PIM) settings for Microsoft Entra ID roles and groups.

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

### 📈 Dashboard Page (New!)
- **View Modes:** Toggle between **Basic** (high-level overview) and **Advanced** (detailed metrics) views
- **Role Overview:** Searchable list of roles with instant drill-down navigation to the Report page
- **Security Alerts:** Read-only view of PIM security recommendations (e.g., potential stale accounts)
- **Overview Cards:** Quick insights into total roles, active sessions, and configuration health
- **Security Charts:** Visual breakdown of privileged vs. non-privileged roles and assignment types
- **Actionable Insights:** "Approvers Overview" and "Configuration Errors" widgets (Advanced mode)
- **Pro Tips:** Dynamic suggestions for improving your security posture

### 📊 Report Page (Main Feature)
- **Multi-Workload:** View both Directory Roles and PIM for Groups in one unified interface
- View all Microsoft Entra ID roles with their PIM configurations
- Filter by role type, assignment type, member type, scope, and user
- Export to PDF (Executive Report) or CSV
- See who is assigned to each role (eligible, active, permanent)
- View scope information (Tenant-wide, App-scoped, RMAU)
- Authentication Context display for roles requiring specific access

### ⚙️ Configure Page
- **Edit**: master-detail list of roles and groups with Activation, Assignment and Notification settings, Who has it, and Select several
- **Guided**: a route in steps for a change on many targets, optionally from the access model
- **Import**: CSV or JSON files compared with the tenant, then one review and apply; the **Access model** page shows the PIM Monitor catalog
- Apply consistent activation settings (MFA, approval, max duration) across multiple roles and groups
- Create, manage, and remove eligible/active assignments with AU scope support

> [!NOTE]
> Write permissions for Configure (`RoleManagementPolicy.ReadWrite.Directory` and related scopes) are requested via incremental consent, only when you choose Grant permission in Configure. Read-only reporting does not require these permissions.

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
| `PrivilegedAccess.Read.AzureADGroup` | PIM for Groups workload | Workload not shown in settings |
| `RoleManagementPolicy.Read.AzureADGroup` | PIM for Groups policies | Groups data incomplete without this |
| `PrivilegedAccess-CustomExt.Read.All` | List of PIM custom extensions (Preview) | Picker and orphan check hidden; which extension a policy links still shows |
| `Policy.Read.All` | Configure's Conditional Access check (asked on demand) | The check shows "Not checked"; the rest of the review runs |

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
│  └── Configure Page (Edit / Guided / Import / Model)    │
├─────────────────────────────────────────────────────────┤
│  State Management Layer                                 │
│  ├── UnifiedPimContext (Workload Orchestration)         │
│  ├── DirectoryRoleContext (Directory Roles)             │
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
