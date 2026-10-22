# What's New in PIM Manager

---

## v3.0.1 - 2026-10-22

A security update. Next.js goes from 16.4.0 to 16.4.2 for two advisories published today (GHSA-2464-fhr4-w9xw and GHSA-p3m5-59mp-jv5r). PIM Manager is a static site without the parts of Next.js these are about, so a hosted PIM Manager was not exposed. If you host PIM Manager yourself, update anyway: from today a build on 16.4.0 stops with a security error.

---

## v3.0.0 - 2026-10-17

PIM Manager 3.0 is here, and it looks nothing like 2.x.

I rebuilt the whole app around the questions an Entra admin actually asks. New look, a dashboard with a Basic and an Advanced view, and a Report that puts the list of roles or groups next to the detail of the one you pick. One filter, shared between the two.

Configure got the biggest rewrite. Edit roles and groups, follow Guided steps, or import a file. Every change waits in one basket, goes through a review with checks, and is written only when you apply. A snapshot comes first, and you can undo any of the last ten applies. The Access model page exports the recommended role settings as a CSV you can edit and import again; the import compares it with your tenant and goes through the same review. Fewer surprises, more control.

There is also support for Microsoft Entra Agent ID, so AI agents that hold a role show up as what they are, not as users or apps. PIM custom extensions are in as a preview. And if you want to look around first: the live demo on a made-up tenant runs at pimmanager.com, no sign-in needed.

And one thing I want to say plainly: the visual design of PIM Manager 3.0 is my own. In a time when a screen is one prompt away, I am proud that this look and feel comes from me and not from a generator. I took my time with it, and I think you can see that.

One thing to know. The Wizard, Manual and Bulk modes are gone, Edit, Guided and Import take their place.

Before you upgrade, if you host PIM Manager yourself:

- Sign-in now ends on a new `/redirect` page (MSAL 5). Add `https://<your app>/redirect` as a Single-page application redirect URI in your Microsoft Entra app registration.
- On Cloudflare Pages the build command must be `npm run build`. It adds the hashes of the inline scripts to the headers; without them the Content Security Policy blocks those scripts.

### Breaking changes

- **Configure is rebuilt.** One page with four modes replaces the Wizard, Manual and Bulk modes, which are gone. Edit, Guided and Import take their place. See Configure below.
- **The Report export is a new dialog.** The files have new names: `pim-overview-*` and `pim-bulk-*` CSV files and `pim-backup` JSON replace `pim-role-policies`, `pim-role-assignments`, `pim-group-assignments`, `pim-group-policies` and `pim-data-export`. Check any script that reads them.
- **The "Full refresh" button is gone.** Refresh re-reads the assignments and then every policy in the background. "Clear cached data" in Settings, under Advanced, empties the cache and reads everything again.
- **The dashboard card "Configuration errors" is gone.** A role whose settings failed to load or cannot be read now says so in its Report detail and in Edit.
- **Some dashboard numbers move.** An activation through a group now counts as "through a group" in Direct or through a group, so tenants with such activations see fewer direct ones.

### Security

- **Stricter Content Security Policy.** Neither `script-src` nor `style-src` allows `'unsafe-inline'` any more. Inline scripts are allowed by their hash, so injected markup cannot add scripts or styles of its own. The build fails if an inline style or `'unsafe-inline'` ever comes back.
- **MSAL 5.** Every sign-in popup and silent sign-in goes through the new `/redirect` page (see above).
- **Dependencies updated**, including Next.js (updated to 16.4.0), React 19.3 and MSAL 5.
- **Sign-in permissions are unchanged.** `Policy.Read.All` (Configure's Conditional Access check) and `PrivilegedAccess-CustomExt.Read.All` (custom extensions) are asked on demand only. Without `Policy.Read.All` the check shows as not checked, never as passed.
- **Signing out clears more.** The cached Graph data, the Configure basket and the history of applies are removed before you are signed out of Microsoft Entra ID.
- **Emergency access accounts stay in your browser.** They are stored per tenant in this browser only and can be exported and imported as a JSON list.

### Configure

- **One Configure with four modes on one basket of changes.** Edit roles and groups, Guided, Import a file and the Access model. Nothing is written until you review and apply. The start page shows what you can change, the three ways in, the access model and your last applies. A lock with the reason shows on what you cannot change.
- **Edit roles and groups.** Every role and group is listed with what it asks on activation, how many people have it and a dot when changes wait. Open one for its settings (Activation, Assignment, Notification) and "Who has it" (All, Eligible, Active) with Remove and Change end. The last owner of a group cannot be removed. "Add people" adds users or groups as eligible or active. The Notification tab covers the three kinds of email per role or group.
- **Change several at once.** "Select several" shows what every target has now. Keep leaves a target as it is, and a change is only added where the value differs. "Copy settings to" copies the Activation, Assignment or Notification settings of one role or group to others of the same kind and says first how many changes that makes.
- **Guided.** Five steps for the same rules on several roles or groups: what to set and where to start (the current settings, a copy of one role or group, or the PIM Monitor access model), the targets, the settings, the people to add, then the review. A choice you change in the first step clears what depends on it and says so.
- **Import a file.** Drop a CSV or an access model JSON of up to 5 MB. The kind is recognised from the headers and you can change it with "Not right? Read it as". "What can I import?" lists every column per type, "Download the template" gives an empty file, and example files are offered. Every row is compared with your tenant before it becomes a change. Import reads Scope ID and End Date, stops a row with a scope it does not know, and no longer breaks on a cell that holds a line break.
- **The access model.** A reference page shows the PIM Monitor catalog with plane and level, the recommended settings per level, the placement of your groups and every role of the catalog. It writes nothing; "Use as a template" opens Guided. The catalog is read from pimmonitor.com with a plain request that sends no tenant data, and a copy that ships with the app is the fallback. In Settings you choose which authentication context of your tenant stands for each label of the access model.
- **One review for every change.** It shows a verdict, the items to look at and every check, then what will be written step by step, each with Leave out. The checks warn or block on: approval without approvers, existing assignments that break the new rules, what changes for people who activate, an activation without a required end, removing your own access, emergency access accounts losing access, the last owner of a group, assignments made less than five minutes ago, scheduled assignments, and an authentication context without an enabled Conditional Access policy behind it. New assignments are also checked by Microsoft with a validation-only request. The form prevents MFA together with an authentication context and an end beyond the maximum.
- **Five-minute rule.** Microsoft does not remove an assignment in its first five minutes. The review warns about a removal, or an Undo, of an assignment that started less than five minutes ago, and says from when it can be removed. The form also stops an assignment shorter than five minutes.
- **Apply, result and Undo.** Apply writes step by step with a progress list and "Stop after this write". A snapshot of the targets is saved first, and removals need a confirmation by name. The result lists every change as done or not written, reads the tenant again to check it, and offers "Try the failed ones again", the results as CSV and "Undo this apply". The last ten applies are kept in this browser for Undo. An apply to 20 or more targets asks you to confirm the count per setting.
- **Your work is kept safe.** The basket survives a reload and a permission popup, and leaving Configure with changes waiting asks first.
- **Change in Configure.** The role and group detail of the Report, and the dashboard block "Role-assignable groups outside PIM", have a "Change in Configure" button.

### Dashboard

- **A shared filter.** Click a card, a legend row or an Easy to miss row and the dashboard filters itself. The filter lives in the address, and "Open in report with this filter" shows the same roles in the Report.
- **Dashboard Basic.** Eight cards, then who has access (permanent, eligible, active time-bound) and how roles are protected on activation (Entra MFA, authentication context or neither, plus approval, justification and activation longer than 8 hours). It also shows role-assignable groups outside PIM and Microsoft's own PIM alerts. Seven "Easy to miss" rows follow: permanent Global Administrators, eligible without an end date, apps with a privileged role, agents with a role, guests with a role, roles nobody is notified about, and roles with only permanent members. A tip bar computed from your tenant closes the page.
- **Dashboard Advanced.** Has access per workload and direct or through a group, activation charts with a Privileged or All roles switch, custom extensions, PIM for Groups, the most privileged accounts with their approvers, and what is happening right now.
- **Right now** replaces the Recent activations and Expiring soon widgets. It shows running activations and eligibilities that end within 7 days, for roles and groups.
- **Basic or Advanced as your start.** Settings chooses which of the two the dashboard opens in.

### Report

- **A new Report.** A list of roles or groups sits next to the detail of the one you pick. Below 1024 pixels wide the detail becomes its own view with a Back button. It has search, a filter panel with chips and an address you can copy. Old Report links are converted to the new address; a filter that has no equivalent is dropped.
- **Role and group detail in the same language.** Assignments are rows with tags (scope, end date, direct or through a group, emergency access), and the settings are tiles. Hover or focus a tag to see what it means.
- **Groups.** Members and owners of a group are read when you open it, the approvers of group policies have names, and an activation through a group shows up under that group. Role-assignable groups outside PIM list the roles they hold.
- **Settings you cannot read.** When Microsoft Graph answers 403 on the PIM settings of a role or group, it is marked "Settings not readable with your current access" instead of showing a load error. It is not retried, the dashboard leaves it out of the numbers about settings and says how many roles and groups that concerns, and the exports mark the settings as not readable.

### Export

- **One dialog for PDF and CSV from the dashboard.** The PDF is drawn from your data instead of captured from the screen. You choose Summary, Full or Full with appendix, an Admin or Management audience, whether people become Person 1, Person 2 and so on, bars, donuts or tables, and which workloads and blocks go in. The dialog can apply the current filter.
- **A new Report export** with three purposes. Overview is a CSV for Excel or an auditor. For Configure Import is the CSV format that Import reads. Backup is JSON with every policy and all its rules. The names of people can be replaced in the Overview.

### Microsoft Entra Agent ID

- **AI agents that hold a role are their own kinds of principal** instead of showing up as users or apps: agent identities and agent identity blueprint principals. The Report shows them with Microsoft's own names and help terms and has the filter Who with the value Agents. Blueprint names are read in the background, and a Microsoft Copilot Studio blueprint is named as such.
- **Agents on the dashboard.** The Easy to miss row "Agents with a role" and the chip Agents next to the workload chips. With the chip off, agents are left out of every number and of the export.
- **Agents in the demo.** Contoso has a Copilot Studio agent and an agent of its own.
- **Application.Read.All** is described as "apps and agent blueprints".

### PIM Custom Extensions (Preview)

A role or group activation can call your own API through a custom extension. Microsoft offers this as a preview and it needs a Microsoft Entra ID Governance or Microsoft Entra Suite licence on top of the Microsoft Entra ID P2 licence PIM requires. The extension objects live on Graph beta.

- **The Report shows which extension a role or group calls,** before and after approval. "(disabled)" follows the name of a switched-off link, and "Not found" marks a link to an extension the tenant no longer has. A filter finds every role that links one, and the role and group CSV exports carry the columns.
- **The dashboard lists custom extensions** in the activation section of Advanced: name, stage, the number of roles, "not found" for a link to an extension that no longer exists, and the roles that cannot be activated. A row filters the dashboard to the roles that link it. It shows only when a policy links an extension.
- **Link an extension in Configure.** The Activation tab of Edit and Guided ends with a custom extension section: pick an extension, set its custom attributes, and use the post-approval slot behind a disclosure. The review shows a summary line.
- **Import carries the extension too.** The role and group settings files have optional pre-approval and post-approval extension columns (name or id, resolved against your tenant; an empty cell keeps the link).
- **Permission on demand.** Listing the tenant's extensions asks for `PrivilegedAccess-CustomExt.Read.All` the first time it is needed.

### Reliability

- **Refresh actually refreshes.** The old smart refresh never saw assignments that had changed. It now re-reads the assignments of both workloads and then every policy in the background, so settings changed in Microsoft Entra come through after a Refresh. Approver names are kept when the approvers did not change. For PIM for Groups, Refresh reads the policies per onboarded group.
- **One loading engine for Directory Roles and PIM for Groups.** A read that fails is not cached and gets a second, slower pass. PIM for Groups fails the load with a sentence that says how many reads failed and why instead of showing an incomplete set. Errors stay until you dismiss them.
- **Honest loading and failure states.** A number that is not known yet shows a placeholder instead of 0. A block that failed says why in one sentence (the status Microsoft Graph answered, and "after 3 tries" where it really retried) and offers Try again.
- **Throttling.** The loader counts what Microsoft Graph charges per call, and every worker pauses for the Retry-After time when one request is throttled.
- **A real prompt when your session expires,** instead of a dead-end "Failed to fetch PIM data".
- **A permission popup no longer empties the page.** Granting a permission in Configure or Settings keeps the page and its state on screen.
- **Microsoft Graph errors show their real meaning.** An answer such as "assignment already exists" used to fall through to a generic message.
- **Smoother progress.** Loading progress updates at most 4 times per second and re-renders only the progress indicators and the role list.
- **Smaller fixes.** A duration of `P365D` shows as "1 Year". The update banner of a self-hosted install compares versions semantically, so a build ahead of the public release no longer shows an "update" to an older version.

### A new look, a new shell and Help

- **A new look for the whole app.** Warm neutrals replace the blue-grey slate, on the three brand colours: IntoTheCloud blue as accent, the PIM Monitor orange for attention and the logo purple for changes. IBM Plex Sans and IBM Plex Mono replace Geist, in the app and in the PDF. The app has an icon set of its own, with icons only where they carry meaning.
- **A new shell.** A top bar from 640 pixels wide, and a compact header with bottom navigation below that, replace the sidebar. The account menu shows the tenant name and ID with "Copy tenant ID", Theme (Light, Dark, System), Settings, Help, What's new with the app version, Documentation and Sign out.
- **Settings is a page,** not a dialog. It has five sections: Workloads and permissions (per workload what PIM Manager may read and change, with a button to grant it), Display, Emergency access accounts, Access model labels and Advanced (log level, Clear cached data, app version).
- **Help next to your work.** The question mark opens a panel that follows the page you are on, docked beside the page from 1280 pixels wide and a sheet below that. What's new lives in the same panel. `/help` is the full guide, with the permission list built from the scopes the app requests. The tour no longer starts by itself; start it from the panel or the guide.
- **A redesigned front page** with a new hero, the official Microsoft sign-in button, a table of what the app covers, a "why I built this" section, a data-flow panel (browser to Microsoft sign-in to Microsoft Graph, no backend), a comparison of the hosted and the self-hosted version, and a permissions overview.
- **Microsoft terminology** in the app and in the docs: "PIM for Groups" and "Microsoft Entra admin center".

### Live demo

- **A live demo without sign-in.** "Live demo" on the front page opens the whole app on Contoso, a made-up tenant, signed in as Alex Wilber. A banner says nothing is read from or sent to Microsoft and changes are not saved, with "Exit demo". Actions that write are switched off and say why; the validation-only checks of the Configure review still run. Only in the hosted version: a self-hosted install shows a page that points to pimmanager.com.

### Hosting and deployment

- **Deploy to Azure for a self-hosted install is more robust.** The deployment script installs the native libraries the Static Web Apps deploy tool needs, runs the deploy from a local folder and retries while the new Static Web App's token is not yet valid. The deployment guide names the resource providers your subscription must have registered and explains what a SequencerJob timeout means.

---

## v2.1.0 — 2026-05-28

### Reliability

- **Throttle-Aware Graph Client** — Sliding-window rate limiter (500 RU/10s cap) wraps all Graph API calls. Respects `Retry-After` headers and holds new requests when the budget is exhausted, preventing cascading 429 errors under tenant-level throttling.
- **Policy Preflight Validation** — Detects incoherent settings before any write is attempted: approval enabled without approvers configured, activation duration exceeding the max assignment duration, conflicting constraint combinations. Shown as inline warnings in the configure flow.
- **Policy Conflict Detection** — Identifies existing PIM assignments that would violate a pending policy change (for example, active assignments that exceed a new max eligible duration). Surfaced in the Review and Apply steps.
- Policy fetch concurrency raised from 8 workers / 300ms to 12 workers / 200ms, reducing full-tenant policy load time by approximately 30%.

### Configure Improvements

- ReviewStep and ApplyStep expanded with conflict and preflight warnings, per-operation detail, and improved error surfacing.
- ManualMode staged apply queue redesigned; policy auto-load on target selection; per-target progress tracking improved.
- AssignmentPanel: duplicate-assignment guard added; existing assignment removal flow improved.
- Graph API error codes now translated to user-friendly messages in the apply flow.

### Bug Fixes

- Pending schedule request checks now use shared filters and a consistent logging context, preventing false "already has a pending request" rejections on rapid successive applies.
- Approval mode requirements enforced for PIM Groups role assignments (was silently creating invalid requests).
- ReportExportModal: CSV export column alignment corrected.

### Infrastructure

- Azure Static Web App deployment workflow pinned to `ubuntu-22.04`; `ubuntu-latest` (now 24.04) caused `StaticSitesClient` binary failures due to a glibc version mismatch.
- README: App Registration prerequisite link corrected to point directly to the prerequisites section in the introduction docs.

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
