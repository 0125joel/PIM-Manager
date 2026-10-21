# Microsoft Graph API Calls

This document details all Microsoft Graph API endpoints used by PIM Manager. Understanding these helps with troubleshooting, permission scoping, and security reviews.

---

## API Overview

### Directory Roles

| Phase | Endpoint | Purpose | Permissions Required |
|-------|----------|---------|---------------------|
| 1 | roleDefinitions | Get all roles | RoleManagement.Read.Directory |
| 1 | roleAssignments | Get permanent assignments | RoleManagement.Read.Directory |
| 1 | roleEligibilitySchedules | Get eligible assignments | RoleEligibilitySchedule.Read.Directory |
| 1 | roleAssignmentSchedules | Get active assignments | RoleAssignmentSchedule.Read.Directory |
| 2 | roleManagementPolicyAssignments | Get PIM policies | RoleManagementPolicy.Read.Directory |

### PIM for Groups (Optional)

| Endpoint | Purpose | Permissions Required |
|----------|---------|---------------------|
| privilegedAccess/group/resources | Get PIM-onboarded groups | PrivilegedAccess.Read.AzureADGroup |
| groups (role-assignable filter) | Detect unmanaged groups | Group.Read.All |
| group/eligibilityScheduleInstances | Get group eligible assignments | PrivilegedAccess.Read.AzureADGroup |
| group/assignmentScheduleInstances | Get group active assignments | PrivilegedAccess.Read.AzureADGroup |
| roleManagementPolicyAssignments (Groups) | Get group PIM policies | RoleManagementPolicy.Read.AzureADGroup |

### Security Alerts (Optional)

| Endpoint | Purpose | Permissions Required |
|----------|---------|---------------------|
| roleManagementAlerts/alerts | Get security alerts | RoleManagementAlert.Read.Directory |

### Custom Extensions (Optional, Preview)

| Endpoint | Purpose | Permissions Required |
|----------|---------|---------------------|
| privilegedAccess/customExtensions | List the tenant's PIM custom extensions (picker, orphan check, CSV name resolution) | PrivilegedAccess-CustomExt.Read.All |
| roleManagementPolicyAssignments (rules) | Which extension a policy links; rides the normal policy read | RoleManagementPolicy.Read.Directory / .AzureADGroup |

### Configure (reads)

| Endpoint | Purpose | Permissions Required |
|----------|---------|---------------------|
| roleAssignmentScheduleInstances / roleEligibilityScheduleInstances `filterByCurrentUser(on='principal')` | The access check: the signed-in admin's active and eligible roles | RoleAssignmentSchedule.Read.Directory, RoleEligibilitySchedule.Read.Directory |
| privilegedAccess/group/{assignment,eligibility}ScheduleInstances `filterByCurrentUser(on='principal')` | The access check: the admin's PIM group memberships and ownerships | PrivilegedAccess.Read.AzureADGroup |
| me/ownedObjects/microsoft.graph.group | The access check: groups the admin owns | User.Read |
| directory/administrativeUnits/{id}/members/microsoft.graph.group, groups/{id} | The access check: groups in a unit or a role's scope (`membershipRule`, `onPremisesSyncEnabled`) | AdministrativeUnit.Read.All, Group.Read.All |
| roleEligibilityScheduleRequests / roleAssignmentScheduleRequests (roles and groups) with `isValidationOnly` | The dry run of new assignments in the review; nothing is written | The write scopes of the workload |
| identity/conditionalAccess/policies | The optional Conditional Access check of the review | Policy.Read.All (on demand) and a role that may read Conditional Access |
| users, groups (`$search`, `startswith` fallback) | Search for people in Add people and the approver picker | User.Read.All, Group.Read.All |
| directory/administrativeUnits, applications (`$search`) | The scopes of a new role assignment | AdministrativeUnit.Read.All, Application.Read.All |
| users, groups, servicePrincipals (`id in (...)`, `userPrincipalName in (...)`) | Import: the people of a file that the loaded assignments do not name | User.Read.All, Group.Read.All, Application.Read.All |

---

## Phase 1: Initial Load

### 1. Role Definitions

```http
GET /roleManagement/directory/roleDefinitions
```

**API Version**: `beta` (for `isPrivileged` property)

**Select Fields**:
- `id` - Unique identifier
- `displayName` - Human-readable name
- `description` - Role description
- `isBuiltIn` - Built-in or custom role
- `isPrivileged` - Microsoft's privileged classification
- `templateId` - Template for built-in roles

**Response Example**:
```json
{
  "value": [
    {
      "id": "62e90394-69f5-4237-9190-012177145e10",
      "displayName": "Global Administrator",
      "isBuiltIn": true,
      "isPrivileged": true
    }
  ]
}
```

> [!NOTE]
> The `isPrivileged` property is only available in the **beta** API. If it fails, the app falls back to `v1.0` without this field.

---

### 2. Role Assignments (Permanent)

```http
GET /roleManagement/directory/roleAssignments?$expand=principal
```

**API Version**: `v1.0`

**Expand**: `principal` - Includes user/group details inline

**Purpose**: Shows who has **permanent** (non-PIM) role assignments.

> [!WARNING]
> Permanent assignments bypass PIM entirely. These users don't need to activate their role.

### 1. Unified PIM Context (`UnifiedPimContext.tsx`)
- `GET /roleManagement/directory/roleDefinitions` (Fallback Full Sync)
- `GET /roleManagement/directory/roleAssignmentScheduleInstances`
- `GET /roleManagement/directory/roleEligibilityScheduleInstances`

---

### 3. Role Eligibility Schedules

```http
GET /roleManagement/directory/roleEligibilitySchedules?$expand=principal
```

**API Version**: `beta`

**Purpose**: Shows who is **eligible** for a role via PIM.

**Key Fields**:
- `principalId` - User or group ID
- `roleDefinitionId` - Which role
- `scheduleInfo` - Start/end dates
- `memberType` - Direct or inherited (via group)

---

### 4. Role Assignment Schedules

```http
GET /roleManagement/directory/roleAssignmentSchedules?$expand=principal
```

**API Version**: `beta`

**Purpose**: Shows currently **active** PIM assignments (activated roles).

---

## Phase 2: Policy Loading

### Role Management Policy Assignments

```http
GET /policies/roleManagementPolicyAssignments?$filter=scopeId eq '/' and scopeType eq 'DirectoryRole' and roleDefinitionId eq '{roleId}'&$expand=policy($expand=rules)
```

**API Version**: `beta`

**Purpose**: Get PIM configuration for a specific role.

**Response Structure**:
```json
{
  "value": [
    {
      "id": "DirectoryRole_{roleId}_...",
      "policyId": "DirectoryRole_{roleId}",
      "policy": {
        "rules": [
          {
            "@odata.type": "#microsoft.graph.unifiedRoleManagementPolicyExpirationRule",
            "id": "Expiration_EndUser_Assignment",
            "maximumDuration": "PT8H"
          },
          {
            "@odata.type": "#microsoft.graph.unifiedRoleManagementPolicyAuthenticationContextRule",
            "isEnabled": true,
            "claimValue": "c1"
          }
        ]
      }
    }
  ]
}
```

> [!IMPORTANT]
> Each role requires a **separate API call** for its policy. This is why Phase 2 takes longer than Phase 1.

---

### Authentication Context Class References

```http
GET /identity/conditionalAccess/authenticationContextClassReferences
```

**API Version**: `v1.0`

**Purpose**: Get all Authentication Context definitions from the tenant. These are used in PIM policies to require specific Conditional Access conditions for role activation.

**Response Example**:
```json
{
  "value": [
    {
      "id": "c1",
      "displayName": "Require MFA for PIM",
      "description": "Enforces MFA when activating privileged roles",
      "isAvailable": true
    }
  ]
}
```

> [!NOTE]
> Authentication Context is referenced in PIM policies via `claimValue` (e.g., "c1") and displayed with its friendly name.

---

## Directory Objects & Search

These endpoints are used for searching users/groups (filters) and resolving approver details.

### Search Users & Groups

```http
GET /users?$search="displayName:{term}"
GET /groups?$search="displayName:{term}"
```

**API Version**: `v1.0` (requires `ConsistencyLevel: eventual` header)

**Permissions**: `User.Read.All`, `Group.Read.All`

**Purpose**: Real-time search for assigning roles or approvers.

---

### Get Group Members

```http
GET /groups/{id}/members
```

**API Version**: `v1.0`

**Purpose**: Expand nested group assignments in the Assignment Overview.

---

## Rate Limiting & Throttling

Microsoft Graph enforces rate limits to protect service stability.

### Smart Refresh Strategy
To improve performance, the application implements a **Smart Refresh** logic:
1.  **Directory Roles**: Graph has no delta for PIM assignments or policies (`/directoryRoles/delta` only reports activated role objects), so Refresh re-reads the definitions and assignment schedules without blocking the page and then every policy in the background (one paged call for the tenant). Approver names of policies whose approvers did not change are kept.
2.  **PIM for Groups**: No delta. Graph's `/groups/delta` only filters on `id` and never reports PIM eligibility or policy changes, so the app reads the PIM inventory (`/identityGovernance/privilegedAccess/group/resources` plus the role-assignable groups) and then, per onboarded group, the eligibility and assignment schedule instances and the policies (3 workers, 500 ms). Group details stay as loaded.
3.  **Parallel Execution**: Both workloads refresh concurrently for maximum speed.

### Limits

| Resource | Limit | Period |
|----------|-------|--------|
| General | 10,000 requests | 10 minutes |
| Role Management | ~60 requests | 1 minute |

### Throttling Response

When throttled, Graph returns:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 30
```

### How PIM Manager Handles Throttling

| Mechanism | Implementation |
|-----------|----------------|
| **Rate limiting** | 8 concurrent workers, 300ms delay (default); policy fetch uses 12 workers, 200ms delay |
| **Deduplication** | Skips already-fetched policies |
| **Conservative quota usage** | Uses only 10-22% of available quota |

**Performance Impact:**
- Policy fetch time reduced from ~15-20s to ~3-5s (for 50 roles)
- 70-80% faster than original implementation
- Well within Microsoft Graph API throttling limits for all tenant sizes

**Microsoft Graph API Limits (Identity & Access):**

| Tenant Size | ResourceUnits per 10 sec | Current Usage | Percentage |
|-------------|-------------------------|---------------|------------|
| Large (>500 users) | 8,000 RU | ~26 req/sec | 10% |
| Medium (50-500) | 5,000 RU | ~26 req/sec | 16% |
| Small (<50) | 3,500 RU | ~26 req/sec | 22% |

> [!CAUTION]
> If you see frequent `429` errors, your tenant may have hitting limits from other applications too. Wait and retry.

---

## PIM for Groups API Calls

PIM Manager supports Microsoft Entra PIM for Groups, allowing you to manage privileged access through group membership with separate policies for Members and Owners.

### 1. Get PIM-Onboarded Groups

```http
GET /identityGovernance/privilegedAccess/group/resources
```

**API Version**: `beta`

**Permission**: `PrivilegedAccess.Read.AzureADGroup`

**Purpose**: Discover which groups are enrolled in PIM (have PIM policies configured).

**Response**: Returns groups with `id`, `displayName`, and resource metadata.

---

### 2. Get Role-Assignable Groups

```http
GET /groups?$filter=isAssignableToRole eq true
```

**API Version**: `v1.0`

**Permission**: `Group.Read.All`

**Purpose**: Fetch all role-assignable groups to identify unmanaged groups (those with `isAssignableToRole: true` but no PIM policy).

**Use Case**: Security gap detection - groups that can assign roles but aren't managed by PIM.

---

### 3. Get Group Details

```http
GET /groups/{id}
```

**API Version**: `v1.0`

**Permission**: `Group.Read.All`

**Purpose**: Fetch group metadata (display name, description) for groups discovered via PIM resources endpoint.

---

### 4. Get Group Eligibility Schedules

```http
GET /identityGovernance/privilegedAccess/group/eligibilityScheduleInstances
  ?$filter=groupId eq '{groupId}'
  &$expand=principal,group
```

**API Version**: `v1.0`

**Permission**: `PrivilegedAccess.Read.AzureADGroup`

**Purpose**: Fetch eligible assignments for a specific group (who can activate membership/ownership).

**Key Fields**:
- `accessId`: `member` or `owner`
- `principal`: User or group assigned
- `startDateTime`, `endDateTime`: Assignment validity period

---

### 5. Get Group Assignment Schedules

```http
GET /identityGovernance/privilegedAccess/group/assignmentScheduleInstances
  ?$filter=groupId eq '{groupId}'
  &$expand=principal,group
```

**API Version**: `v1.0`

**Permission**: `PrivilegedAccess.Read.AzureADGroup`

**Purpose**: Fetch active assignments (permanently assigned or currently activated).

---

### 6. Get Group PIM Policies

```http
GET /policies/roleManagementPolicyAssignments
  ?$filter=scopeId eq '{groupId}' and scopeType eq 'Group'
  &$expand=policy($expand=rules)
```

**API Version**: `beta`

**Permission**: `RoleManagementPolicy.Read.AzureADGroup`

**Purpose**: Fetch PIM policy configuration for a group. Returns **two** policies per group:
- **Member policy** (`roleDefinitionId` ends with `_member`)
- **Owner policy** (`roleDefinitionId` ends with `_owner`)

**Policy Rules Include**:
- Maximum activation duration
- MFA requirement on activation
- Approval workflow
- Justification requirement
- Authentication context (Conditional Access integration)
- Notification settings

**Note**: Member and Owner policies are completely independent and can have different configurations.

---

## Security Alerts API Calls

PIM Manager integrates with Microsoft Entra ID Security Alerts to surface PIM-related security risks.

### Get Security Alerts

```http
GET /identityGovernance/roleManagementAlerts/alerts
  ?$filter=scopeId eq '/' and scopeType eq 'DirectoryRole'
  &$expand=alertDefinition,alertConfiguration
```

**API Version**: `beta`

**Permission**: `RoleManagementAlert.Read.Directory`

**Purpose**: Fetch active security alerts for Directory Roles (e.g., too many global admins, roles assigned outside PIM, stale eligible assignments).

**Key Fields**:
- `alertDefinition.severityLevel`: `high`, `medium`, `low`, `informational`
- `alertDefinition.description`: Human-readable explanation
- `incidentCount`: Number of affected items
- `isActive`: Whether alert is currently triggered

**Graceful Degradation**: If the permission is not granted (403 Forbidden), the feature is hidden without breaking the app.

**Display**: Security alerts appear in the Dashboard's Security Alerts panel, sorted by severity.

---

## Custom Extensions API Calls (Preview)

PIM Custom Extensions let a role or group activation call an external REST API (typically a Logic App behind API Management) that answers `Approved`, `AutoApproved` or `Denied`. PIM Manager reads which extension a policy links, links one from Configure and lists the tenant's extensions for the picker. Building the endpoint stays outside the app; `docs/Assets/pim-custom-extension-logic-app-setup.md` covers that side.

### Linked extension on a policy (no extra permission)

Both slots ride the existing policy read (`roleManagementPolicyAssignments?$expand=policy($expand=rules)`, Directory Roles on v1.0, PIM for Groups on beta). They are two rules in the same `rules` array, present on every policy once the preview is rolled out to the tenant:

```json
{
  "@odata.type": "#microsoft.graph.unifiedRoleManagementPolicyCustomExtensionRule",
  "id": "CustomExtension_PreApproval_EndUser_Assignment",
  "isEnabled": true,
  "customExtensionId": "a05c9349-5950-4884-bab4-7fb6aa3e4ff5",
  "displayName": "Outside office hours",
  "customAttributes": ["ticketNumber"],
  "target": { "caller": "EndUser", "operations": ["All"], "level": "Assignment", "inheritableSettings": [], "enforcedSettings": [] }
}
```

`CustomExtension_PostApproval_EndUser_Assignment` has the same shape. `displayName` is denormalized by Graph, so the Report and the Dashboard need no further call. Tenants without the preview have no such rules and every custom extension surface renders nothing.

### List custom extensions

```http
GET /identityGovernance/privilegedAccess/customExtensions
```

**API Version**: `beta`

**Permission**: `PrivilegedAccess-CustomExt.Read.All` (delegated, incremental consent; probed silently, the popup only opens when the user asks for the list)

**Purpose**: the picker in Configure, name-to-id resolution for Import files, and orphan detection (a linked `customExtensionId` that no longer exists).

**Graceful Degradation**: a 403 (no consent, or no Microsoft Entra ID Governance / Entra Suite licence) is mapped to `PERMISSION_DENIED`; the list-dependent parts hide and the rest of the app is unchanged.

### Link or unlink an extension

```http
PATCH /policies/roleManagementPolicies/{policyId}/rules/CustomExtension_PreApproval_EndUser_Assignment
```

Body: `@odata.type`, `id`, `isEnabled`, `customExtensionId`, `customAttributes` and a `target` that carries its own `"@odata.type": "microsoft.graph.unifiedRoleManagementPolicyRuleTarget"` with `operations: ["All"]` (the `createRuleTarget()` shape). Never send `displayName`. An unlink sends `customExtensionId: ""` with `isEnabled: false`. Confirmed live on v1.0 and beta for Directory Roles (`docs/Assets/pim-custom-extensions-research.md` §3.3a); PIM for Groups uses the same rule ids. A `target` copied from a GET response (no discriminator, lowercase `all`) fails with `MissingProvider`.

**Permission**: `RoleManagementPolicy.ReadWrite.Directory` or `RoleManagementPolicy.ReadWrite.AzureADGroup`, the existing Configure write scopes; linking needs no custom extension scope.

---

## Permission Summary

### Configure Write Permissions

| Permission | Scope | Used For |
|------------|-------|----------|
| `RoleManagementPolicy.ReadWrite.Directory` | Delegated | Update PIM policy rules for Directory Roles |
| `RoleEligibilitySchedule.ReadWrite.Directory` | Delegated | Create eligible assignments for Directory Roles |
| `RoleAssignmentSchedule.ReadWrite.Directory` | Delegated | Create active assignments for Directory Roles |
| `RoleManagementPolicy.ReadWrite.AzureADGroup` | Delegated | Update PIM policies for PIM for Groups |
| `PrivilegedEligibilitySchedule.ReadWrite.AzureADGroup` | Delegated | Create eligible assignments for PIM for Groups |
| `PrivilegedAssignmentSchedule.ReadWrite.AzureADGroup` | Delegated | Create active assignments for PIM for Groups |

> [!NOTE]
> Write permissions are requested via incremental consent only when the user enters Configure mode. They are not included in the initial login request.

### Configure Write API Endpoints

| Operation | Endpoint | Method | Permission |
|-----------|----------|--------|------------|
| Update policy rule | `/policies/roleManagementPolicies/{policyId}/rules/{ruleId}` | PATCH | RoleManagementPolicy.ReadWrite.Directory |
| Create role eligible assignment | `/roleManagement/directory/roleEligibilityScheduleRequests` | POST | RoleEligibilitySchedule.ReadWrite.Directory |
| Create role active assignment | `/roleManagement/directory/roleAssignmentScheduleRequests` | POST | RoleAssignmentSchedule.ReadWrite.Directory |
| Create group assignment | `/identityGovernance/privilegedAccess/group/assignmentScheduleRequests` | POST | PrivilegedAssignmentSchedule.ReadWrite.AzureADGroup |
| Update group policy rule | `/policies/roleManagementPolicies/{policyId}/rules/{ruleId}` | PATCH | RoleManagementPolicy.ReadWrite.AzureADGroup |
| Link or unlink a custom extension | `/policies/roleManagementPolicies/{policyId}/rules/CustomExtension_{PreApproval,PostApproval}_EndUser_Assignment` | PATCH | RoleManagementPolicy.ReadWrite.Directory or .AzureADGroup |

---

### Core Permissions (Directory Roles)

| Permission | Scope | Used For |
|------------|-------|----------|
| `User.Read` | Delegated | Get signed-in user info |
| `RoleManagement.Read.Directory` | Delegated | Read role definitions |
| `RoleAssignmentSchedule.Read.Directory` | Delegated | Read active PIM assignments |
| `RoleEligibilitySchedule.Read.Directory` | Delegated | Read eligible PIM assignments |
| `RoleManagementPolicy.Read.Directory` | Delegated | Read PIM policies for roles |
| `Policy.Read.ConditionalAccess` | Delegated | Read authentication contexts |
| `User.Read.All` | Delegated | Resolve user display names |
| `Group.Read.All` | Delegated | Resolve group display names & role-assignable groups |
| `AdministrativeUnit.Read.All` | Delegated | Read administrative unit names |
| `Application.Read.All` | Delegated | Read application names |

### Optional Permissions (PIM for Groups, Security Alerts, Custom Extensions, Conditional Access)

| Permission | Scope | Used For |
|------------|-------|----------|
| `PrivilegedAccess.Read.AzureADGroup` | Delegated | Read PIM for Groups assignments and resources |
| `RoleManagementPolicy.Read.AzureADGroup` | Delegated | Read PIM policies for groups (Member/Owner) |
| `RoleManagementAlert.Read.Directory` | Delegated | Read security alerts for roles |
| `PrivilegedAccess-CustomExt.Read.All` | Delegated | List the tenant's PIM custom extensions (Preview) |
| `Policy.Read.All` | Delegated | Configure's optional Conditional Access check, requested on demand |

> [!TIP]
> The application follows the **least privilege principle** by using granular permissions instead of broad permissions like `Directory.Read.All`. `Policy.Read.All` is only asked for when you start the optional Conditional Access check in Configure. Admin consent can be granted in the Microsoft Entra admin center.

> [!IMPORTANT]
> All permissions are **delegated**. The app acts on behalf of the signed-in user, using their permissions in Microsoft Entra ID.

---

## Next Steps

- [Key Concepts](./06-key-concepts.md) - Technical concepts explained
- [Report Page](./08-report-page.md) - How the Report page works
