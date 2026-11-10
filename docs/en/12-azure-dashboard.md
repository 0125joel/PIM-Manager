# Azure Dashboard

The Azure Dashboard (`/azure`) is the Azure counterpart of the [Dashboard Page](./07-dashboard-page.md). It shows who can use privileged access on your Azure resources and on which terms, for the scopes your account can read. It follows the Entra dashboard in method and look; only the content differs.

---

## Overview

**Purpose:** Visibility into privileged access on Azure resources: assignments, role settings and PIM's own alerts, for management groups, subscriptions, resource groups and resources.

**Page head:** the title, a Basic or Advanced switch, in Advanced a Privileged roles or All roles switch, "synced N min ago", Refresh and Export.

**Scope bar:** under the head, in place of the workload chips (see below).

**Filter:** a click on a card, a legend row or an Easy to miss row sets one filter, kept in the URL as `f`. A bar under the scope bar shows the filter as a removable chip, a sentence with the count and "Open in report with this filter". Escape clears it.

**What you see:** Azure RBAC decides it, per scope. The dashboard shows what your Azure roles let you read and never claims a total for the tenant. Azure is turned on per account with a one-time consent for `https://management.azure.com/user_impersonation`, asked when you choose Turn on Azure, not at sign-in.

---

## Scope bar

The scope bar decides what is counted.

| Part | Behavior |
|------|----------|
| Path | "All you can read" when nothing is chosen, with the number of management groups and subscriptions; otherwise the path to the chosen scope. A click opens the scope dialog of the Azure Report: your tenant, and the delegated subscriptions in a tree of their own |
| Include inherited | Toggle chip, off by default. On a chosen scope it also counts what is assigned above it. Disabled on the top scope: "Nothing above this scope" |
| Delegated subscriptions | Toggle chip with the count and the Lighthouse tag, on by default. Off leaves delegated subscriptions out of every number |
| Visibility line | "You can read N of M subscriptions in the tenant, and K delegated." "Why not all?" appears only when a subscription of your own tenant cannot be read |

The scope tree shows the management group hierarchy when Azure answers the hierarchy read (`getEntities`), and stays flat otherwise. Below 640 px the path is a button that opens the scope dialog; the two chips and the visibility line stay visible below it.

### Show more details

Without **Show more details** (next to Basic and Advanced) the scope bar keeps the path and Delegated subscriptions; the counts, the Lighthouse tag, Include inherited on the top scope and the visibility line wait behind the checkbox. One sentence under the bar says what you can read: "You can read 4 of 5 subscriptions completely, and 1 in part." and, when something is out of reach, which kind (resource groups, the settings of a privileged role × scope). **What you can read** opens a list per subscription (all, partly, could not be read) and of the role settings you cannot read. Azure does not list the resource groups you cannot read, so a partly readable subscription says only that what you can read is counted.

Further down, Easy to miss shows only the rows that are not zero, without their explanation; From Microsoft, the "not counted" footnotes and Right now are left out, and Most privileged shows the first 5 accounts with only the delegated tag. Each view remembers its own choice in this browser; **Details** set to More in Settings shows everything.

---

## View Modes

### Basic Mode

Cards, then in two columns: **Has access** (permanent, eligible, active time-bound) and **On activation** (Entra MFA, authentication context, neither, with approval, justification and over 8 h), **Easy to miss** (rows in three categories; apps and managed identities apart, agents, guests and deleted accounts) and **From Microsoft** (PIM's own alerts per subscription, read only), and a **tip bar** with tips computed from what you can read.

### Advanced Mode

The same head and cards, then full width sections: **Has access, and how** (per level of the scope tree, direct or through a group), **On activation** (MFA, approval, justification and maximum duration charts for privileged roles or all roles), **Most privileged, and who approves** (the accounts with the most privileged access, and approvers) and **Right now** (running activations, eligibility ending within 7 days). PIM for Groups is not part of the Azure dashboard.

**Privileged roles or All roles:** Advanced counts privileged roles by default. Privileged are the five roles Microsoft lists as privileged administrator roles, and every role whose actions let it change access (the definition on Microsoft Learn). The role definitions are read once per session. The switch counts every role instead; the cards stay the same.

---

## Cards

Every number names its unit: role × scope, or assignments.

| Card | Number |
|------|--------|
| Role × scope | Distinct roles with an assignment, counted once per scope |
| Active now | Active assignments |
| Permanent | Active assignments without an end date |
| Eligible | Eligible assignments |
| Privileged roles | Role × scope of privileged roles |
| Require approval | Privileged role × scope that need approval on activation |
| Custom roles | Role × scope of custom roles |
| Inherited | On the top scope: assignments made on a management group. On a chosen scope: assignments from above |

Numbers that depend on role settings or role definitions show a skeleton until those are read. An unknown value is never shown as 0.

---

## States

- **Loading:** skeletons and a progress line that names subscriptions and role settings.
- **Filter active:** the blocks the filter does not apply to are dimmed.
- **A subscription failed:** a banner "1 of N subscriptions could not be loaded." with Refresh. When the whole load fails, a box with the cause and Try again; the numbers shown are from the last load.
- **Throttled (429):** a notice that Azure is limiting requests.
- **Nothing readable:** the page says so and shows the Azure roles you are eligible for, or that they could not be read, instead of zeros.
- **Apps and managed identities unknown:** when Microsoft Graph could not tell them apart, both rows show "-" and say how many there are together.
- **Role settings not readable:** numbers about settings leave that role × scope out and say so.

---

## Filtering

The dashboard uses the filter model of the Azure Report. A click sets exactly one filter, written to the URL as `f`; the chosen scope is kept in the `scope` parameter. Every target the dashboard can set has a counterpart in the Azure Report, so "Open in report with this filter" shows the same assignments.

**What filters:** the cards (except Role × scope), the legend rows of Has access and On activation and the three figures under On activation, every Easy to miss row, and in Advanced the legend of Has access, and how, the Direct or through a group rows and every bar of On activation. A filter on role settings (approval, MFA, justification, maximum duration, notification) matches only assignments whose role settings are read; the filter sentence says how many are not.

---

## Navigation to Report

| Component | Link | Behavior |
|-----------|------|----------|
| Filter bar | "Open in report with this filter" | Opens `/azure/report` with the same scope and filter |

---

## Data Sources

All reads run in the browser with your own token. Azure Resource Manager (ARM) reads use the `user_impersonation` permission; Azure RBAC at each scope decides what answers.

| Read | api-version | Purpose |
|------|-------------|---------|
| `GET /subscriptions` | `2022-12-01` | Subscriptions, their state and tenant (to spot delegated ones) |
| `GET /subscriptions/{id}/resourcegroups` and `/resources` | `2021-04-01` | For a subscription you can read only below its own level: the resource groups and resources you can read |
| `POST /providers/Microsoft.Management/getEntities` | `2020-05-01` | The management group hierarchy for the scope tree |
| `roleAssignmentScheduleInstances` | `2020-10-01` | Active assignments (also your own, with `asTarget()`) |
| `roleEligibilitySchedules` | `2020-10-01` | Eligible assignments (the instance list leaves out a custom role that can only be assigned below the subscription) |
| `roleEligibilityScheduleInstances` with `asTarget()` | `2020-10-01` | Your own eligible roles, shown when you can read no scope |
| `roleDefinitions` (built-in and custom, tenant level; per subscription as fallback) | `2022-04-01` | Role actions, to tell privileged roles from other roles. Read once per session, kept in memory |
| `roleManagementPolicies` (one role at one scope) | `2020-10-01` | Role settings: MFA, approval, justification, duration |
| `roleManagementAlerts` (per subscription) | `2022-08-01-preview` | PIM's own alerts. Preview: there is no generally available version |

### Minimum Azure role per read

Consent lets the app ask. Azure RBAC decides, scope by scope, whether it gets an answer. Reader is enough for every read Microsoft documents a role for; nothing here needs Owner. The management group hierarchy is the one read Microsoft gives no role for, and the table says so rather than guess.

| Read | Azure RBAC action | Minimum built-in role | Source |
|------|-------------------|-----------------------|--------|
| `GET /subscriptions` | `Microsoft.Resources/subscriptions/read` | Reader on the subscription or anything below it. A role on a single resource is enough to list its subscription; a data-only role (such as Storage Blob Data Reader) is not | [Resource provider operations](https://learn.microsoft.com/en-us/azure/role-based-access-control/permissions/management-and-governance); measured |
| `GET /subscriptions/{id}/resourcegroups` | `Microsoft.Resources/subscriptions/resourceGroups/read` | Reader on the subscription. With Reader on one resource only, the list came back empty | Resource provider operations; measured |
| `GET /subscriptions/{id}/resources` | `Microsoft.Resources/subscriptions/resources/read` | Reader on the resource: you get the resources you can read | Resource provider operations; measured |
| `POST /providers/Microsoft.Management/getEntities` | `Microsoft.Management/getEntities/action` | Not documented. Owner on a subscription with User Access Administrator at the root got the tree; Reader on one subscription got an empty list in one test. Without it the scope tree stays flat | [Entities - List](https://learn.microsoft.com/en-us/rest/api/managementgroups/entities/list) gives no role; measured, not conclusive |
| `roleAssignmentScheduleInstances` at a scope | `Microsoft.Authorization/roleAssignments/read` at that scope | Reader at that scope. With a role only below a subscription, the list at the subscription refuses and the list at your resource group or resource answers | [PIM REST: active access](https://learn.microsoft.com/en-us/rest/api/authorization/privileged-role-assignment-rest-sample); measured |
| `roleAssignmentScheduleInstances` with `asTarget()` at the root | Not documented | None: your own active roles come back, also when your only role is a data role | Measured |
| `roleEligibilitySchedules` | `Microsoft.Authorization/roleAssignments/read` at that scope | Reader at that scope | [PIM REST: eligible access](https://learn.microsoft.com/en-us/rest/api/authorization/privileged-role-eligibility-rest-sample) |
| `roleEligibilityScheduleInstances` with `asTarget()` at the root | Not documented | None: your own eligible roles come back without any Azure role | Measured |
| `roleDefinitions` list (tenant level, per subscription as fallback) | `Microsoft.Authorization/roleDefinitions/read` | Reader (`*/read`) at the scope. Whether Reader on one subscription also gets the tenant-level list is not measured; the per-subscription list is the fallback | Resource provider operations; [Reader](https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles/general#reader) |
| `getRoleDefinition` (one role, for its description in the Azure Report's role view) | `Microsoft.Authorization/roleDefinitions/read` | Reader at the assignment's scope. When it cannot be read, the role view shows no description | Resource provider operations; Reader |
| `roleManagementPolicies` (one role at one scope) | `Microsoft.Authorization/roleAssignments/read` at that scope | Reader at that scope. Not at the root: there it answers 400 `InvalidResource`, also with User Access Administrator at the root | [PIM REST: role settings](https://learn.microsoft.com/en-us/rest/api/authorization/privileged-role-policy-rest-sample); measured |
| `roleManagementAlerts` (per subscription) | `Microsoft.Authorization/roleAssignments/read` at the subscription | Reader on the subscription. Refreshing or dismissing an alert needs Owner or User Access Administrator; the app does neither | [PIM REST: alerts](https://learn.microsoft.com/en-us/rest/api/authorization/role-management-alert-rest-sample) |

Microsoft's samples say every built-in role holds `Microsoft.Authorization/roleAssignments/read`. A data-only role has no `Microsoft.Authorization` action at all, so count on Reader, not on any role.

Two Microsoft Graph reads. `servicePrincipals` with `$select=id,servicePrincipalType`, 15 ids per request, to tell apps from managed identities among the service principals that hold an Azure role; it uses `Application.Read.All`. And `users` and `groups` with `$select=id`, 15 ids per request, to find principals that hold an Azure role but no longer exist; they use `User.Read.All` and `Group.Read.All`. The app already asks all three at sign-in; no new permission.

Nothing is written. Tenant data stays in your session.

---

## Export

**Triggered by:** the Export button in the page head. One dialog for a PDF report or a CSV.

- **PDF:** the detail level (Summary, Full, or Full with appendix, which is for the admin audience only), the audience, replacing names, chart form, what is counted (the chosen scope, Include inherited and Delegated subscriptions), applying the current filter, and the blocks to include.
- **CSV:** one row per assignment in the chosen scope, with the Azure fields (scope, level, subscription, delegated, role, principal, kind, state, origin and end).

---

## Data Refresh

- **Button:** Refresh in the page head reads the assignments and the role settings again. Role definitions are read once per session.
- **Alerts:** read after the role settings, once per readable subscription; there is no separate refresh for alerts.
- **Delay:** Azure can take up to 10 minutes to apply a role change; Refresh then reads it again.

---

## Azure and Entra: what differs

| Topic | On Azure |
|-------|----------|
| Unit | Role × scope: the same role on two scopes counts twice |
| Role settings | Set per role per scope; they do not inherit from a higher scope |
| Groups | No PIM for Groups and no groups outside PIM on this dashboard |
| Alerts | PIM alerts per subscription, preview, read only. A subscription Microsoft has not scanned yet shows none, even when there is something to find |
| Delegated access | Azure Lighthouse subscriptions of another tenant are counted and marked Delegated |
| Apps, managed identities and agents | Only active: they cannot be eligible |

---

## Next Steps

- [Dashboard Page](./07-dashboard-page.md) - The Entra dashboard
- [Report Page](./08-report-page.md) - Detailed configuration view
- [Key Concepts](./06-key-concepts.md) - Understanding PIM terminology
