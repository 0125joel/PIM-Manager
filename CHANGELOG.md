# What's New in PIM Manager

---

## v2.0.1 — 2026-04-13

### Bug Fixes

- **PDF export** — Fixed PDF generation failing due to a Content Security Policy violation. Added `'wasm-unsafe-eval'` to the CSP `script-src` directive, which is required by `@react-pdf/renderer` to instantiate its WebAssembly module. Affected all deployments (SaaS and self-hosted).

---

## v2.0.0 — 2026-04-12

The biggest update to PIM Manager yet — introducing the **Configure** feature for full read/write PIM management, Azure self-hosted deployment, and stability improvements across the board.

---

## 🚀 Major Features

### Configure — Wizard Mode

Guided step-by-step PIM configuration for Directory Roles and PIM Groups:

- **Backup step** — Refresh and verify data freshness before making any changes
- **Workload selection** — Configure Directory Roles, PIM Groups, or both in one session
- **Config type choice** — Policies only, Assignments only, or both
- **Scope step** — Select roles/groups with Start Fresh, Load Current, or Clone From modes
- **Policies step** — Full activation, assignment, and notification settings
- **Assignments step** — Create eligible/active assignments with Administrative Unit scope picker and duration controls
- **Review step** — Preview all pending changes before applying
- **Apply step** — Real-time progress per target with per-rule success/failure tracking
- **Navigation guard** — Warns on unsaved changes; disabled automatically on the completion step

### Configure — Manual Mode

Freeform 3-column layout for direct policy and assignment management:

- **Workload tabs** — Switch between Directory Roles and PIM Groups
- **Full policy form** — Activation, assignment, and notification settings for both member and owner policies
- **Stage Changes workflow** — Queue multiple targets before applying, or Apply Now directly
- **Assignment Panel** — Create eligible/active assignments with AU scope picker and existing assignment management
- **Per-target progress** — Individual success/error tracking in ProgressModal
- **Incremental consent** — Write permissions requested only when entering Configure

### Configure — Bulk Mode

CSV-based batch configuration for policy and assignment management:

- **CSV Upload** — Support for 4 types: Role Policies, Group Policies, Role Assignments, Group Assignments
- **Auto-detection** — System detects CSV type from headers
- **Compare View** — Side-by-side diff of current vs. desired state
- **Assignment Preview** — Row-by-row validation with errors/warnings
- **Selective Apply** — Choose which changes to apply before execution
- **Write consent gate** — Incremental consent per workload
- **Retry Failed** — Re-select failed rows for re-submission

### Filtering in Configure

Role and group lists in the Configure page now have quick-filter pills, making it easier to find what you're looking for in large tenants.

**Wizard — Scope step:**
- **Roles tab:** filter by Type (Built-in / Custom), Privilege, and Assignments (With / Without)
- **Groups tab:** filter by Group type (Security / M365 / Mail-enabled)

**Manual Mode:**
- Role selector: same three filter rows as the Wizard
- Group selector: Group type filter

"Select All Visible" respects active filters — only the currently visible items are selected.

### Azure Static Web Apps — Self-Hosted Deployment

PIM Manager can now be deployed to your own Azure tenant with a single click — no fork required:

- **Deploy to Azure button** — One-click ARM template deployment directly from the public repository
- **Three inputs only** — Resource name, region, and your App Registration Client ID
- **Fully automated** — ARM template provisions Azure Static Web Apps (Free tier), downloads the latest release, and injects your Client ID at deploy time
- **No secrets needed** — Uses Authorization Code Flow with PKCE; the Client ID is intentionally public
- **Self-contained** — Nothing leaves your Azure tenant once deployed

### Update Notifications (Self-Hosted)

Self-hosted instances now show a version badge in the sidebar footer when a newer release is available:

- Displays the current installed version with its release date
- Shows the latest available version with its release date
- Clickable link to the GitHub Releases page
- Checked once per session; no impact on performance

---

## ✨ User Experience Enhancements

### Configure Quality of Life

- Group-inherited assignments clearly marked with "via Group" badge — removal correctly disabled with tooltip
- Approver notification input shows info tooltip when disabled (Graph API limitation)
- ProgressModal stays open on partial apply failure for review; auto-closes only on full success
- Incremental write-consent gate per workload — right permissions, right moment

### Help & Documentation

- Help modal updated with dedicated sections for all three Configure modes, including step-by-step Wizard overview and write permissions reference

---

## 🔒 Security

### Write Permissions via Incremental Consent

Write permissions are **never requested at login**. They are requested via incremental consent only when the user actively enters Configure mode:

**Directory Roles:**
- `RoleManagementPolicy.ReadWrite.Directory` — Update role policies
- `RoleEligibilitySchedule.ReadWrite.Directory` — Create eligible assignments
- `RoleAssignmentSchedule.ReadWrite.Directory` — Create active assignments

**PIM for Groups:**
- `RoleManagementPolicy.ReadWrite.AzureADGroup` — Update group policies
- `PrivilegedEligibilitySchedule.ReadWrite.AzureADGroup` — Create eligible group assignments
- `PrivilegedAssignmentSchedule.ReadWrite.AzureADGroup` — Create active group assignments

### Security Hardening

- **CSP hardened** — Inline theme script moved to `public/theme-init.js`; `'unsafe-eval'` removed; `object-src 'none'` and `base-uri 'self'` added; missing MSAL domains (`aadcdn.msftauth.net`, `login.microsoft.com`) added to `script-src` and `connect-src`
- **Simplified sessionStorage** — Data is now stored as plain JSON for better debuggability and transparency
- **npm vulnerabilities fixed** — 4 audit issues resolved: brace-expansion (moderate), flatted (high), next (moderate), picomatch (high)

---

## ⚡ Reliability Improvements

- Policy updates and assignment removals retry on 429/5xx with exponential backoff
- Administrative Unit list fetches all pages (was hard-capped at 100)
- Duration parser correctly handles sub-hour values (PT30M, PT1H30M)
- Notification email recipients split correctly on semicolon separator

---

## 🐛 Bug Fixes

- **GroupSelector** — Rapid-toggle stale closure fixed; selection changes always propagate correctly
- **Wizard** — Back-navigation no longer shows stale dynamic steps from a previous workload selection
- **Group partial-cache** — On-demand policy fetch fills either missing member or owner policy independently
- **Owner policy** — Correctly applied for permanent-allowed constraint checks in assignments
- **Dashboard** — 9–24h activation duration range now displays correctly (dead branch removed)
- **Theme script** — Replaced inline `<script>` with `next/script` (`beforeInteractive`) to suppress React hydration warning

---

## Previous Release — v1.9.0

**Release Date**: January 24, 2026

A comprehensive update bringing powerful new features, major performance improvements, and critical security enhancements.

---

### 🚀 Major Features

#### Full PIM Groups Support

Comprehensive support for Microsoft Entra PIM Groups:

- **Complete feature parity** with Directory Roles
- **Member/Owner distinction** - Separate policy management for different group roles
- **Integrated reporting** - Groups data seamlessly integrated across dashboard and reports
- **Unmanaged Groups detection** - Identify groups not yet enrolled in PIM

#### Smart Sync Technology

Data synchronization improvements:

- **Delta queries** - Only fetch changes since last sync where possible (not full datasets)
- **Parallel fetching** - Multiple API calls execute simultaneously
- **70-80% faster** data synchronization compared to full refresh
- **Optimized caching** - Authentication contexts and policy data cached intelligently
- **Sync status indicator** - Always know when your data was last updated

#### PDF Export

Reporting capabilities built-in:

- **Customizable exports** - Choose which charts and data to include
- **Stat cards and styled sections** - Clean visual design
- **Metadata included** - Tenant ID, user info, and report timestamps
- **Export-ready reports** - For compliance and governance

---

### ✨ User Experience Enhancements

#### Enhanced Dashboard

- **Multi-select filters** - Select multiple values simultaneously for advanced filtering
- **Authentication Contexts chart** - Visualize Conditional Access requirements
- **Managed vs Unmanaged Groups** - See PIM coverage at a glance
- **Interactive stat cards** - Click to filter, double-click to clear
- **Granular duration buckets** - Precise breakdown (≤1h, 2-4h, 5-8h, 9-12h, >12h)

#### Improved Help & Settings

- **Search functionality** - Find help topics instantly
- **Permission grouping** - Better organized consent requirements
- **Troubleshooting section** - Common issues and solutions
- **Tabbed Settings Modal** - Cleaner organization of workload configurations
- **Accessibility improvements** - Enhanced keyboard navigation and screen reader support

---

### ⚡ Performance & Technical Improvements

#### API & Data Management

- **v1.0 Graph API** - Migrated from beta to stable Microsoft Graph endpoints
- **Worker pool utility** - Parallel data fetching with throttling protection
- **Optimized caching** - SessionStorage for authentication contexts
- **Reduced throttling** - Smart delays prevent 429 errors

#### Code Quality

- **Type safety enhancements** - Replaced `any` types with `unknown` for safer error handling
- **Code cleanup** - Removed debug code and unused features
- **Better patterns** - Context API replaces prop drilling

---

### 🔒 Security Hardening

#### Production Safety

- All debug logging disabled in production
- Error messages sanitized for user-facing displays
- Security-sensitive operations require explicit permissions
- Client-side only architecture (no server-side data storage)

---

### 🐛 Bug Fixes

#### Data Synchronization

- Race conditions on page refresh resolved
- Infinite loops in delta query logic eliminated
- False change detection on initial load prevented

#### User Interface

- Filter state properly persists between page navigation
- Duration format bugs corrected across all components
- PDF export color handling for canvas rendering fixed
- Notification recipient mapping corrected

---

### 📚 Documentation & Transparency

#### Open Source Commitment

- **GPL v3.0 License** - Full transparency and open-source licensing
- **Comprehensive README** - Clear architecture philosophy and governance focus
- **Development transparency** - Full changelog and version history available

#### Enhanced Documentation

- Architecture deep-dives with enterprise sections
- PIM Groups data flow documentation
- PDF export usage guides
- Help modal improvements with better navigation

---

_PIM Manager is client-side only, open-source, and designed with Zero Trust principles. Your data stays in your browser, and you maintain complete control._
