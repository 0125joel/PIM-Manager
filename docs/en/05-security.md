# Security Model

PIM Manager implements enterprise-grade security practices with a zero-trust architecture, client-side execution, and granular permission management.

## Overview

PIM Manager's security model is built on three core principles:
1. **Zero Trust Architecture** - Client-side only, no backend storage
2. **Least Privilege** - Granular permissions with incremental consent
3. **Transparency** - Open source, auditable code

---

## 1. Zero Trust Architecture

### Client-Side Only Execution

PIM Manager runs entirely in your browser with no backend server.

**Key Implementation:**
- **Static Export** (`next.config.ts`): Application compiled to static HTML/JS/CSS
- **No Backend API**: All data processing happens in browser memory
- **Direct Graph Integration**: API calls go directly to `graph.microsoft.com`
- **No Data Persistence**: No server-side storage, logging, or caching

**Security Benefit:** Your PIM data never passes through our infrastructure. Zero server-side attack surface.

### Principle of Least Privilege

Every permission scope is justified and documented.

**Core Scopes** (Always Required):
```typescript
// src/config/authConfig.ts
const loginRequest = {
  scopes: [
    "User.Read",                                    // Basic profile
    "RoleManagement.Read.Directory",                // Directory roles
    "RoleAssignmentSchedule.Read.Directory",        // Assignment schedules
    "RoleEligibilitySchedule.Read.Directory",       // Eligibility schedules
    "RoleManagementPolicy.Read.Directory",          // Policy configuration
    "Policy.Read.ConditionalAccess",                // Auth contexts only
    "User.Read.All",                                // User search
    "Group.Read.All",                               // Group search
    "AdministrativeUnit.Read.All",                  // Admin units
    "Application.Read.All"                          // Service principals
  ]
};
```

**Optional Scopes** (Incremental Consent):
- `PrivilegedAccess.Read.AzureADGroup` - PIM for Groups
- `RoleManagementPolicy.Read.AzureADGroup` - Group policies
- `RoleManagementAlert.Read.Directory` - Security Alerts

**Read-Only by Default:** No write scopes in core functionality. PIM Manager is a visualization and reporting tool.

---

## 2. Authentication & Token Management

### MSAL Integration

Microsoft Authentication Library (MSAL) handles all authentication.

**Configuration** (`src/config/authConfig.ts`):
```typescript
export const msalConfig: Configuration = {
  auth: {
    clientId: process.env.NEXT_PUBLIC_CLIENT_ID!,
    authority: "https://login.microsoftonline.com/organizations",
    redirectUri: process.env.NEXT_PUBLIC_REDIRECT_URI ||
                 window.location.origin
  },
  cache: {
    cacheLocation: "sessionStorage",  // Critical: NOT localStorage
    storeAuthStateInCookie: false
  }
};
```

**Key Security Features:**
- Multi-tenant support (`/organizations` endpoint)
- Runtime validation of required environment variables
- Token storage in sessionStorage (cleared on browser close)

### Token Storage

**SessionStorage (Not LocalStorage):**
```typescript
// src/config/authConfig.ts
cache: {
  cacheLocation: "sessionStorage"
}
```

**Why SessionStorage?**
- ✅ Tokens automatically cleared when browser/tab closes
- ✅ Not accessible across browser tabs
- ✅ Not persisted to disk
- ❌ LocalStorage persists indefinitely (security risk)

**What's Stored:**
- **sessionStorage**: Access tokens, refresh tokens, ID tokens, delta sync links
- **localStorage**: UI preferences only (theme, log level, workload visibility)

### Token Lifecycle

1. **Acquisition**: `acquireTokenPopup()` for user-initiated login
2. **Refresh**: `acquireTokenSilent()` for automatic background refresh
3. **Expiration**: MSAL handles automatic token refresh before expiration
4. **Cleanup**: Tokens cleared on logout or browser close

### Incremental Consent

**Implementation** (`src/hooks/useIncrementalConsent.ts`):
```typescript
const consentToWorkload = async (workloadId: string) => {
  try {
    // Popup-first strategy (maintains user click context)
    const result = await instance.acquireTokenPopup({
      scopes: workloadScopes[workloadId],
      prompt: "consent"
    });

    // Persist consent to localStorage
    localStorage.setItem(`pim_workload_enabled_${workloadId}`, "true");
  } catch (popupError) {
    // Fallback to silent acquisition
    const result = await instance.acquireTokenSilent({
      scopes: workloadScopes[workloadId]
    });
  }
};
```

**Popup-First Strategy:** Prevents browser popup blocking by respecting user click context.

---

## 3. Data Protection

### Client-Side Processing

**Architecture Validation:**
```typescript
// next.config.ts
const nextConfig: NextConfig = {
  output: "export",  // Static export, no server
  reactStrictMode: true
};
```

**Data Flow:**
1. User authenticates → Token stored in sessionStorage
2. Graph API call → Direct from browser to graph.microsoft.com
3. Response processed → In-memory only (no persistence)
4. Delta links cached → sessionStorage (for efficiency)
5. Browser close → All tokens and data cleared

**No Data Transmission:** Zero data sent to PIM Manager infrastructure or third parties.

### Session Management

**SessionStorage Usage:**
```typescript
// src/services/deltaService.ts
const DELTA_LINK_KEY_ROLES = "pim_delta_roles";
const DELTA_LINK_KEY_ELIGIBLE = "pim_delta_eligible";
const DELTA_LINK_KEY_ACTIVE = "pim_delta_active";

sessionStorage.setItem(DELTA_LINK_KEY_ROLES, deltaLink);
```

**LocalStorage Usage (Non-Sensitive Only):**
```typescript
// src/utils/logger.ts
localStorage.setItem("LOG_LEVEL", "DEBUG");

// src/hooks/useIncrementalConsent.ts
localStorage.setItem("pim_workload_enabled_directoryRoles", "true");
localStorage.setItem("pim_visibility_directoryRoles", "true");
```

**Separation of Concerns:**
- sessionStorage: Tokens, API responses, delta links (sensitive)
- localStorage: UI preferences, feature flags (non-sensitive)

---

## 4. API Security

### Microsoft Graph Client SDK

All API calls use the official Microsoft Graph Client SDK.

**Implementation** (`src/services/directoryRoleService.ts`):
```typescript
import { Client } from "@microsoft/microsoft-graph-client";

const client = Client.initWithMiddleware({
  authProvider: {
    getAccessToken: async () => {
      const result = await instance.acquireTokenSilent(tokenRequest);
      return result.accessToken;
    }
  }
});
```

**Built-In Security:**
- Token injection via authProvider
- Request validation
- Error handling (401, 403, 429)

### Rate Limiting & Throttling Protection

**Worker Pool** (`src/utils/workerPool.ts`):
```typescript
export async function runWorkerPool<TInput, TOutput>(
  items: TInput[],
  taskFn: (item: TInput) => Promise<TOutput>,
  options: WorkerPoolOptions = {}
): Promise<TOutput[]> {
  const {
    workerCount = 8,      // Configurable concurrency
    delayMs = 300,        // Delay between requests per worker
    onProgress
  } = options;

  // Distribute work across workers with delays
}
```

**Protection Mechanisms:**
- Configurable concurrency (default 8 workers, max 1 per resource)
- Delay between requests (default 300ms)
- Progress callbacks for UI feedback
- Graceful handling of API throttling (429 errors)

**Per-Endpoint Delays:**
- Paginated requests: 100ms delay (`src/services/directoryRoleService.ts:73`)
- Scope enrichment: 50ms delay (`src/services/directoryRoleService.ts:221`)

### Input Validation

**OData Injection Protection** (`src/components/UserGroupSearch.tsx`):
```typescript
function escapeODataString(str: string): string {
  return str.replace(/'/g, "''");  // Escape single quotes
}

const filter = `startswith(displayName,'${escapeODataString(debouncedQuery)}')`;
```

**Type Safety:**
- TypeScript strict mode enabled
- Runtime validation at API boundaries
- Zod schemas for complex data structures

**Error Handling:**
```typescript
// src/services/deltaService.ts
catch (error: unknown) {
  if (error instanceof Error && error.message.includes("410")) {
    // Delta token expired, fallback to full sync
    return null;
  }
  throw error;
}
```

---

## 5. Content Security

### XSS Protection

**React Automatic Escaping:**
- React escapes all JSX expressions by default
- No use of `dangerouslySetInnerHTML` with user input
- Safe theme script embedding (`src/app/layout.tsx:41-58`)

**Input Sanitization:**
- OData escaping for search queries
- Type validation before rendering
- No dynamic code execution

### Error Handling

**Error Boundaries** (`src/components/ErrorBoundary.tsx`):
```typescript
componentDidCatch(error: Error, errorInfo: ErrorInfo) {
  if (process.env.NODE_ENV === "production") {
    console.error("Error boundary caught:", error.message);
  } else {
    console.error("Error boundary caught:", error, errorInfo);
  }
}
```

**Security Principles:**
- Production: Minimal error details logged
- Development: Full stack traces in console only
- No sensitive data in error messages
- User-friendly fallback UI

**Protected Routes** (`src/components/ProtectedRoute.tsx`):
```typescript
if (!isAuthenticated) {
  return <Navigate to="/login" />;
}
```

**Graceful Degradation:**
- 403 errors: Hide features, show empty state
- 401 errors: Redirect to login
- Network errors: Retry with exponential backoff

---

## 6. Privacy

### No Telemetry or Tracking

**Zero External Services:**
- ❌ No Google Analytics
- ❌ No Mixpanel, Segment, Amplitude
- ❌ No error tracking (Sentry, Rollbar)
- ❌ No telemetry beacons
- ✅ Only Microsoft Graph API calls

**Visitor Counter:** External badge in README (non-functional, cosmetic only)

### Data Never Leaves Client

**Verified Data Flow:**
1. User → Browser → Microsoft Graph API
2. No intermediate proxies or logging services
3. No backend persistence
4. Process data in-memory only

**Open Source Transparency:**
- Full source code available on GitHub
- Auditable by security professionals
- Community-driven security reviews

### Data Processed

**What PIM Manager Accesses:**
- Directory role definitions and assignments
- PIM eligibility and active assignments
- PIM policy configurations (activation, assignment, notification rules)
- User and group display names (for search/assignments)
- Administrative units and scopes
- Security alerts (optional)

**What PIM Manager Does NOT Access:**
- Passwords or credentials
- Email content or messages
- Calendar events or files
- Personal documents or OneDrive
- Teams chats or channels

**Workload Isolation:**
- Core: Directory Roles (always enabled)
- Optional: PIM Groups, Security Alerts (explicit consent required)
- Planned: Intune, Exchange, SharePoint (not implemented)

---

## 7. Security Best Practices

### For End Users

**✅ Do:**
- Review requested permissions before consenting
- Use modern browsers (Chrome, Edge, Firefox, Safari)
- Log out when finished (clears all tokens)
- Enable MFA on your Microsoft account
- Keep your browser up to date

**❌ Don't:**
- Share your session with others
- Use PIM Manager on public computers without logging out
- Install untrusted browser extensions
- Bypass consent prompts blindly

### For Administrators

**✅ Do:**
- Review app registration permissions in Entra ID
- Monitor consent grants in audit logs
- Use Conditional Access policies for PIM Manager access
- Regularly audit PIM configuration changes
- Enable sign-in risk policies

**❌ Don't:**
- Grant admin consent for unnecessary scopes
- Allow PIM Manager in unmanaged devices (without Conditional Access)
- Skip security reviews of open-source dependencies

---

## 8. Deployment Security

### Recommended Security Headers (Cloudflare Pages)

**Content Security Policy:**
```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'unsafe-inline' 'unsafe-eval';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: https:;
  connect-src 'self' https://graph.microsoft.com https://login.microsoftonline.com;
  font-src 'self';
  frame-ancestors 'none';
```

**Additional Headers:**
```
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), microphone=(), camera=()
```

**HTTPS Only:**
- Enforce HTTPS in production
- Enable HSTS (HTTP Strict Transport Security)
- Redirect HTTP → HTTPS

---

## 9. Threat Model

### What PIM Manager Protects Against

✅ **Unauthorized Access**
- MSAL enforces authentication before any API calls
- Multi-factor authentication (MFA) supported
- Conditional Access policies respected

✅ **Data Exfiltration**
- Client-only architecture prevents server-side data theft
- No data persistence beyond browser session
- Direct Graph API calls (no intermediate proxies)

✅ **Token Theft**
- SessionStorage cleared on browser close
- Tokens not accessible across tabs
- MSAL handles secure token storage

✅ **API Abuse**
- Rate limiting via worker pool
- Throttling protection with delays
- Request validation before API calls

✅ **XSS Attacks**
- React automatic escaping
- Input sanitization (OData escaping)
- No dynamic code execution

### What PIM Manager Does NOT Protect Against

❌ **Compromised User Account**
- If user's Microsoft account is compromised, attacker inherits PIM Manager access
- **Mitigation**: Enable MFA, monitor sign-in logs

❌ **Malicious Browser Extensions**
- Extensions can read sessionStorage and intercept API calls
- **Mitigation**: Only install trusted extensions, review permissions

❌ **Physical Access to Unlocked Device**
- Active session can be hijacked if device is unlocked
- **Mitigation**: Lock screen when away, log out after use

❌ **Man-in-the-Middle (MITM)**
- If HTTPS is compromised (e.g., rogue CA), tokens can be intercepted
- **Mitigation**: Use trusted networks, verify SSL certificates

---

## 10. Security Audit Trail

### Key Files for Security Review

| File | Purpose | Security Relevance |
|------|---------|-------------------|
| `src/config/authConfig.ts` | MSAL configuration | Token storage, scopes, authority |
| `src/hooks/useIncrementalConsent.ts` | Consent management | Permission requests, localStorage |
| `src/utils/workerPool.ts` | Rate limiting | Throttling protection, concurrency |
| `src/components/UserGroupSearch.tsx` | OData escaping | Input validation, injection protection |
| `src/services/directoryRoleService.ts` | Graph API calls | Error handling, data fetching |
| `next.config.ts` | Build configuration | Static export, no server |

### Audit Checklist

**Authentication:**
- [ ] Verify `cacheLocation: "sessionStorage"` in `authConfig.ts`
- [ ] Confirm no write scopes in core `loginRequest`
- [ ] Check MSAL version for known vulnerabilities

**Data Protection:**
- [ ] Verify `output: "export"` in `next.config.ts`
- [ ] Confirm no backend API endpoints
- [ ] Check sessionStorage vs localStorage usage

**API Security:**
- [ ] Verify OData escaping in user input
- [ ] Confirm worker pool delays configured
- [ ] Check error handling for 401/403/429

**Content Security:**
- [ ] Review CSP headers in deployment config
- [ ] Verify no `dangerouslySetInnerHTML` with user input
- [ ] Check ErrorBoundary implementation

---

## 11. Reporting Security Issues

**Responsible Disclosure:**

If you discover a security vulnerability in PIM Manager:

1. **Do NOT** open a public GitHub issue
2. Use [GitHub Security Advisories](https://github.com/0125joel/PIM-manager-private/security/advisories) (private reporting)
3. Or email security contact: [See GitHub profile](https://github.com/0125joel)

**What to Include:**
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

**Response Timeline:**
- Initial response: 48 hours
- Severity assessment: 1 week
- Fix timeline: Based on severity (Critical: 7 days, High: 30 days, Medium: 90 days)

---

## Summary

PIM Manager implements defense-in-depth security:

| Layer | Implementation | Protection |
|-------|----------------|-----------|
| **Authentication** | MSAL, sessionStorage tokens | Unauthorized access |
| **Authorization** | Granular scopes, least privilege | Excessive permissions |
| **Data Protection** | Client-only, sessionStorage | Data exfiltration |
| **API Security** | Graph SDK, throttling, validation | API abuse, injection |
| **Content Security** | React escaping, OData sanitization | XSS attacks |
| **Privacy** | No telemetry, client-only | Data leakage |
| **Transparency** | Open source, auditable code | Hidden backdoors |

**Security is a continuous process.** Regularly review permissions, monitor audit logs, and keep dependencies updated.

---

## Next Steps

- [**Architecture**](./00-architecture.md) - Understanding the client-side design
- [**Data Flow**](./03-data-flow.md) - How data moves through the application
- [**Deployment**](./09-deployment.md) - Secure deployment on Cloudflare Pages
