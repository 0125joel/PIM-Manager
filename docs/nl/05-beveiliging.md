# Beveiligingsmodel

PIM Manager implementeert enterprise-grade beveiligingspraktijken met een zero-trust architectuur, client-side uitvoering en granulaire permission management.

## Overzicht

Het beveiligingsmodel van PIM Manager is gebouwd op drie kernprincipes:
1. **Zero Trust Architectuur** - Alleen client-side, geen backend opslag
2. **Least Privilege** - Granulaire permissies met incremental consent
3. **Transparantie** - Open source, controleerbare code

---

## 1. Zero Trust Architectuur

### Alleen Client-Side Uitvoering

PIM Manager draait volledig in je browser zonder backend server.

**Belangrijkste Implementatie:**
- **Static Export** (`next.config.ts`): Applicatie gecompileerd naar statische HTML/JS/CSS
- **Geen Backend API**: Alle dataverwerking gebeurt in browser geheugen
- **Directe Graph Integratie**: API calls gaan direct naar `graph.microsoft.com`
- **Geen Data Persistentie**: Geen server-side opslag, logging of caching

**Beveiligingsvoordeel:** Je PIM data passeert nooit onze infrastructuur. Zero server-side attack surface.

### Principe van Least Privilege

Elke permission scope is gerechtvaardigd en gedocumenteerd.

**Core Scopes** (Altijd Vereist):
```typescript
// src/config/authConfig.ts
const loginRequest = {
  scopes: [
    "User.Read",                                    // Basis profiel
    "RoleManagement.Read.Directory",                // Directory rollen
    "RoleAssignmentSchedule.Read.Directory",        // Assignment schedules
    "RoleEligibilitySchedule.Read.Directory",       // Eligibility schedules
    "RoleManagementPolicy.Read.Directory",          // Policy configuratie
    "Policy.Read.ConditionalAccess",                // Auth contexts alleen
    "User.Read.All",                                // User zoeken
    "Group.Read.All",                               // Group zoeken
    "AdministrativeUnit.Read.All",                  // Admin units
    "Application.Read.All"                          // Service principals
  ]
};
```

**Optionele Scopes** (Incremental Consent):
- `PrivilegedAccess.Read.AzureADGroup` - PIM for Groups
- `RoleManagementPolicy.Read.AzureADGroup` - Group policies
- `RoleManagementAlert.Read.Directory` - Security Alerts

**Standaard Read-Only:** Geen write scopes in core functionaliteit. PIM Manager is een visualisatie en rapportage tool.

---

## 2. Authenticatie & Token Management

### MSAL Integratie

Microsoft Authentication Library (MSAL) handelt alle authenticatie af.

**Configuratie** (`src/config/authConfig.ts`):
```typescript
export const msalConfig: Configuration = {
  auth: {
    clientId: process.env.NEXT_PUBLIC_CLIENT_ID!,
    authority: "https://login.microsoftonline.com/organizations",
    redirectUri: process.env.NEXT_PUBLIC_REDIRECT_URI ||
                 window.location.origin
  },
  cache: {
    cacheLocation: "sessionStorage",  // Kritiek: NIET localStorage
    storeAuthStateInCookie: false
  }
};
```

**Belangrijke Beveiligingskenmerken:**
- Multi-tenant ondersteuning (`/organizations` endpoint)
- Runtime validatie van vereiste environment variabelen
- Token opslag in sessionStorage (gewist bij browser sluiten)

### Token Opslag

**SessionStorage (Niet LocalStorage):**
```typescript
// src/config/authConfig.ts
cache: {
  cacheLocation: "sessionStorage"
}
```

**Waarom SessionStorage?**
- ✅ Tokens automatisch gewist wanneer browser/tab sluit
- ✅ Niet toegankelijk over browser tabs heen
- ✅ Niet persistent op disk
- ❌ LocalStorage blijft onbeperkt bestaan (beveiligingsrisico)

**Wat wordt Opgeslagen:**
- **sessionStorage**: Access tokens, refresh tokens, ID tokens, delta sync links
- **localStorage**: Alleen UI voorkeuren (theme, log level, workload zichtbaarheid)

### Token Levenscyclus

1. **Verkrijgen**: `acquireTokenPopup()` voor gebruiker-geïnitieerde login
2. **Vernieuwen**: `acquireTokenSilent()` voor automatische achtergrond refresh
3. **Verlopen**: MSAL handelt automatische token refresh af voor expiratie
4. **Opruimen**: Tokens gewist bij logout of browser sluiten

### Incremental Consent

**Implementatie** (`src/hooks/useIncrementalConsent.ts`):
```typescript
const consentToWorkload = async (workloadId: string) => {
  try {
    // Popup-first strategie (behoudt gebruiker click context)
    const result = await instance.acquireTokenPopup({
      scopes: workloadScopes[workloadId],
      prompt: "consent"
    });

    // Persist consent naar localStorage
    localStorage.setItem(`pim_workload_enabled_${workloadId}`, "true");
  } catch (popupError) {
    // Fallback naar silent acquisition
    const result = await instance.acquireTokenSilent({
      scopes: workloadScopes[workloadId]
    });
  }
};
```

**Popup-First Strategie:** Voorkomt browser popup blocking door gebruiker click context te respecteren.

---

## 3. Data Bescherming

### Client-Side Verwerking

**Architectuur Validatie:**
```typescript
// next.config.ts
const nextConfig: NextConfig = {
  output: "export",  // Static export, geen server
  reactStrictMode: true
};
```

**Data Flow:**
1. Gebruiker authenticeert → Token opgeslagen in sessionStorage
2. Graph API call → Direct van browser naar graph.microsoft.com
3. Response verwerkt → Alleen in-memory (geen persistentie)
4. Delta links gecached → sessionStorage (voor efficiëntie)
5. Browser sluiten → Alle tokens en data gewist

**Geen Data Transmissie:** Zero data verzonden naar PIM Manager infrastructuur of third parties.

### Session Management

**SessionStorage Gebruik:**
```typescript
// src/services/deltaService.ts
const DELTA_LINK_KEY_ROLES = "pim_delta_roles";
const DELTA_LINK_KEY_ELIGIBLE = "pim_delta_eligible";
const DELTA_LINK_KEY_ACTIVE = "pim_delta_active";

sessionStorage.setItem(DELTA_LINK_KEY_ROLES, deltaLink);
```

**LocalStorage Gebruik (Niet-Gevoelig Alleen):**
```typescript
// src/utils/logger.ts
localStorage.setItem("LOG_LEVEL", "DEBUG");

// src/hooks/useIncrementalConsent.ts
localStorage.setItem("pim_workload_enabled_directoryRoles", "true");
localStorage.setItem("pim_visibility_directoryRoles", "true");
```

**Scheiding van Concerns:**
- sessionStorage: Tokens, API responses, delta links (gevoelig)
- localStorage: UI voorkeuren, feature flags (niet-gevoelig)

---

## 4. API Beveiliging

### Microsoft Graph Client SDK

Alle API calls gebruiken de officiële Microsoft Graph Client SDK.

**Implementatie** (`src/services/directoryRoleService.ts`):
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

**Ingebouwde Beveiliging:**
- Token injectie via authProvider
- Request validatie
- Error handling (401, 403, 429)

### Rate Limiting & Throttling Bescherming

**Worker Pool** (`src/utils/workerPool.ts`):
```typescript
export async function runWorkerPool<TInput, TOutput>(
  items: TInput[],
  taskFn: (item: TInput) => Promise<TOutput>,
  options: WorkerPoolOptions = {}
): Promise<TOutput[]> {
  const {
    workerCount = 8,      // Configureerbare concurrency
    delayMs = 300,        // Vertraging tussen requests per worker
    onProgress
  } = options;

  // Verdeel werk over workers met vertragingen
}
```

**Beschermingsmechanismen:**
- Configureerbare concurrency (standaard 8 workers, max 1 per resource)
- Vertraging tussen requests (standaard 300ms)
- Progress callbacks voor UI feedback
- Graceful handling van API throttling (429 errors)

**Per-Endpoint Vertragingen:**
- Paginated requests: 100ms vertraging (`src/services/directoryRoleService.ts:73`)
- Scope enrichment: 50ms vertraging (`src/services/directoryRoleService.ts:221`)

### Input Validatie

**OData Injectie Bescherming** (`src/components/UserGroupSearch.tsx`):
```typescript
function escapeODataString(str: string): string {
  return str.replace(/'/g, "''");  // Escape single quotes
}

const filter = `startswith(displayName,'${escapeODataString(debouncedQuery)}')`;
```

**Type Safety:**
- TypeScript strict mode ingeschakeld
- Runtime validatie bij API grenzen
- Zod schemas voor complexe datastructuren

**Error Handling:**
```typescript
// src/services/deltaService.ts
catch (error: unknown) {
  if (error instanceof Error && error.message.includes("410")) {
    // Delta token expired, fallback naar full sync
    return null;
  }
  throw error;
}
```

---

## 5. Content Beveiliging

### XSS Bescherming

**React Automatische Escaping:**
- React escapt alle JSX expressies standaard
- Geen gebruik van `dangerouslySetInnerHTML` met user input
- Veilige theme script embedding (`src/app/layout.tsx:41-58`)

**Input Sanitisatie:**
- OData escaping voor zoekqueries
- Type validatie voor rendering
- Geen dynamische code execution

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

**Beveiligingsprincipes:**
- Productie: Minimale error details gelogd
- Development: Volledige stack traces alleen in console
- Geen gevoelige data in error messages
- Gebruiksvriendelijke fallback UI

**Protected Routes** (`src/components/ProtectedRoute.tsx`):
```typescript
if (!isAuthenticated) {
  return <Navigate to="/login" />;
}
```

**Graceful Degradation:**
- 403 errors: Verberg features, toon lege state
- 401 errors: Redirect naar login
- Network errors: Retry met exponential backoff

---

## 6. Privacy

### Geen Telemetrie of Tracking

**Zero Externe Services:**
- ❌ Geen Google Analytics
- ❌ Geen Mixpanel, Segment, Amplitude
- ❌ Geen error tracking (Sentry, Rollbar)
- ❌ Geen telemetrie beacons
- ✅ Alleen Microsoft Graph API calls

**Bezoekersteller:** Externe badge in README (niet-functioneel, alleen cosmetisch)

### Data Verlaat Nooit de Client

**Geverifieerde Data Flow:**
1. Gebruiker → Browser → Microsoft Graph API
2. Geen tussenliggende proxies of logging services
3. Geen backend persistentie
4. Verwerk data alleen in-memory

**Open Source Transparantie:**
- Volledige broncode beschikbaar op GitHub
- Controleerbaar door beveiligingsprofessionals
- Community-gedreven security reviews

### Verwerkte Data

**Wat PIM Manager Toegang Tot Heeft:**
- Directory role definities en assignments
- PIM eligibility en active assignments
- PIM policy configuraties (activatie, assignment, notificatie regels)
- Gebruiker en groep display names (voor zoeken/assignments)
- Administrative units en scopes
- Security alerts (optioneel)

**Wat PIM Manager GEEN Toegang Tot Heeft:**
- Wachtwoorden of credentials
- Email content of berichten
- Agenda events of bestanden
- Persoonlijke documenten of OneDrive
- Teams chats of kanalen

**Workload Isolatie:**
- Core: Directory Roles (altijd ingeschakeld)
- Optioneel: PIM Groups, Security Alerts (expliciete consent vereist)
- Gepland: Intune, Exchange, SharePoint (niet geïmplementeerd)

---

## 7. Best Practices Beveiliging

### Voor Eindgebruikers

**✅ Wel:**
- Review gevraagde permissies voor consent
- Gebruik moderne browsers (Chrome, Edge, Firefox, Safari)
- Log uit wanneer klaar (wist alle tokens)
- Schakel MFA in op je Microsoft account
- Houd je browser up-to-date

**❌ Niet:**
- Deel je sessie met anderen
- Gebruik PIM Manager op publieke computers zonder uit te loggen
- Installeer onbetrouwbare browser extensies
- Bypass consent prompts blindelings

### Voor Administrators

**✅ Wel:**
- Review app registratie permissies in Entra ID
- Monitor consent grants in audit logs
- Gebruik Conditional Access policies voor PIM Manager toegang
- Audit PIM configuratie wijzigingen regelmatig
- Schakel sign-in risk policies in

**❌ Niet:**
- Verleen admin consent voor onnodige scopes
- Sta PIM Manager toe op unmanaged devices (zonder Conditional Access)
- Sla security reviews van open-source dependencies over

---

## 8. Deployment Beveiliging

### Aanbevolen Security Headers (Cloudflare Pages)

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

**Aanvullende Headers:**
```
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), microphone=(), camera=()
```

**Alleen HTTPS:**
- Forceer HTTPS in productie
- Schakel HSTS in (HTTP Strict Transport Security)
- Redirect HTTP → HTTPS

---

## 9. Threat Model

### Wat PIM Manager Beschermt Tegen

✅ **Ongeautoriseerde Toegang**
- MSAL forceert authenticatie voor alle API calls
- Multi-factor authenticatie (MFA) ondersteund
- Conditional Access policies gerespecteerd

✅ **Data Exfiltratie**
- Client-only architectuur voorkomt server-side data diefstal
- Geen data persistentie buiten browser sessie
- Directe Graph API calls (geen tussenliggende proxies)

✅ **Token Diefstal**
- SessionStorage gewist bij browser sluiten
- Tokens niet toegankelijk over tabs heen
- MSAL handelt veilige token opslag af

✅ **API Misbruik**
- Rate limiting via worker pool
- Throttling bescherming met vertragingen
- Request validatie voor API calls

✅ **XSS Aanvallen**
- React automatische escaping
- Input sanitisatie (OData escaping)
- Geen dynamische code execution

### Wat PIM Manager NIET Beschermt Tegen

❌ **Gecompromitteerd Gebruikersaccount**
- Als gebruiker's Microsoft account gecompromitteerd is, erft aanvaller PIM Manager toegang
- **Mitigatie**: Schakel MFA in, monitor sign-in logs

❌ **Kwaadaardige Browser Extensies**
- Extensies kunnen sessionStorage lezen en API calls intercepteren
- **Mitigatie**: Installeer alleen betrouwbare extensies, review permissies

❌ **Fysieke Toegang tot Ontgrendeld Apparaat**
- Actieve sessie kan gekaapt worden als apparaat ontgrendeld is
- **Mitigatie**: Lock screen wanneer weg, log uit na gebruik

❌ **Man-in-the-Middle (MITM)**
- Als HTTPS gecompromitteerd is (bijv. rogue CA), kunnen tokens onderschept worden
- **Mitigatie**: Gebruik betrouwbare netwerken, verifieer SSL certificaten

---

## 10. Security Audit Trail

### Belangrijke Bestanden voor Security Review

| Bestand | Doel | Beveiligingsrelevantie |
|---------|------|------------------------|
| `src/config/authConfig.ts` | MSAL configuratie | Token opslag, scopes, authority |
| `src/hooks/useIncrementalConsent.ts` | Consent management | Permission requests, localStorage |
| `src/utils/workerPool.ts` | Rate limiting | Throttling bescherming, concurrency |
| `src/components/UserGroupSearch.tsx` | OData escaping | Input validatie, injectie bescherming |
| `src/services/directoryRoleService.ts` | Graph API calls | Error handling, data fetching |
| `next.config.ts` | Build configuratie | Static export, geen server |

### Audit Checklist

**Authenticatie:**
- [ ] Verifieer `cacheLocation: "sessionStorage"` in `authConfig.ts`
- [ ] Bevestig geen write scopes in core `loginRequest`
- [ ] Check MSAL versie voor bekende vulnerabilities

**Data Bescherming:**
- [ ] Verifieer `output: "export"` in `next.config.ts`
- [ ] Bevestig geen backend API endpoints
- [ ] Check sessionStorage vs localStorage gebruik

**API Beveiliging:**
- [ ] Verifieer OData escaping in user input
- [ ] Bevestig worker pool delays geconfigureerd
- [ ] Check error handling voor 401/403/429

**Content Beveiliging:**
- [ ] Review CSP headers in deployment config
- [ ] Verifieer geen `dangerouslySetInnerHTML` met user input
- [ ] Check ErrorBoundary implementatie

---

## 11. Beveiligingsproblemen Melden

**Responsible Disclosure:**

Als je een beveiligingsprobleem ontdekt in PIM Manager:

1. Open **GEEN** publieke GitHub issue
2. Gebruik [GitHub Security Advisories](https://github.com/0125joel/PIM-manager-private/security/advisories) (privé rapportage)
3. Of email security contact: [Zie GitHub profiel](https://github.com/0125joel)

**Wat te Includeren:**
- Beschrijving van de vulnerability
- Stappen om te reproduceren
- Potentiële impact
- Voorgestelde fix (indien van toepassing)

**Response Timeline:**
- Initiële respons: 48 uur
- Severity beoordeling: 1 week
- Fix timeline: Gebaseerd op severity (Kritiek: 7 dagen, Hoog: 30 dagen, Gemiddeld: 90 dagen)

---

## Samenvatting

PIM Manager implementeert defense-in-depth beveiliging:

| Laag | Implementatie | Bescherming |
|------|---------------|-------------|
| **Authenticatie** | MSAL, sessionStorage tokens | Ongeautoriseerde toegang |
| **Autorisatie** | Granulaire scopes, least privilege | Excessieve permissies |
| **Data Bescherming** | Client-only, sessionStorage | Data exfiltratie |
| **API Beveiliging** | Graph SDK, throttling, validatie | API misbruik, injectie |
| **Content Beveiliging** | React escaping, OData sanitisatie | XSS aanvallen |
| **Privacy** | Geen telemetrie, client-only | Data lekkage |
| **Transparantie** | Open source, controleerbare code | Verborgen backdoors |

**Beveiliging is een continu proces.** Review permissies regelmatig, monitor audit logs en houd dependencies up-to-date.

---

## Volgende Stappen

- [**Architectuur**](./00-architecture.md) - Begrijpen van het client-side design
- [**Data Flow**](./03-dataflow.md) - Hoe data door de applicatie beweegt
- [**Deployment**](./10-deployment.md) - Veilige deployment op Cloudflare Pages
