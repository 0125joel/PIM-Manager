# What's New in PIM Manager

**Release Date**: January 24, 2026

A comprehensive update bringing powerful new features, major performance improvements, and critical security enhancements.

---

## 🚀 Major Features

### Full PIM Groups Support

Comprehensive support for Microsoft Entra PIM Groups:

- **Complete feature parity** with Directory Roles
- **Member/Owner distinction** - Separate policy management for different group roles
- **Integrated reporting** - Groups data seamlessly integrated across dashboard and reports
- **Unmanaged Groups detection** - Identify groups not yet enrolled in PIM

### Smart Sync Technology

Data synchronization improvements:

- **Delta queries** - Only fetch changes since last sync where possible (not full datasets)
- **Parallel fetching** - Multiple API calls execute simultaneously
- **70-80% faster** data synchronization compared to full refresh
- **Optimized caching** - Authentication contexts and policy data cached intelligently
- **Sync status indicator** - Always know when your data was last updated

### PDF Export

Reporting capabilities built-in:

- **Customizable exports** - Choose which charts and data to include
- **Stat cards and styled sections** - Clean visual design
- **Metadata included** - Tenant ID, user info, and report timestamps
- **Export-ready reports** - For compliance and governance

---

## ✨ User Experience Enhancements

### Enhanced Dashboard

- **Multi-select filters** - Select multiple values simultaneously for advanced filtering
- **Authentication Contexts chart** - Visualize Conditional Access requirements
- **Managed vs Unmanaged Groups** - See PIM coverage at a glance
- **Interactive stat cards** - Click to filter, double-click to clear
- **Granular duration buckets** - Precise breakdown (≤1h, 2-4h, 5-8h, 9-12h, >12h)

### Improved Help & Settings

- **Search functionality** - Find help topics instantly
- **Permission grouping** - Better organized consent requirements
- **Troubleshooting section** - Common issues and solutions
- **Tabbed Settings Modal** - Cleaner organization of workload configurations
- **Accessibility improvements** - Enhanced keyboard navigation and screen reader support

---

## ⚡ Performance & Technical Improvements

### API & Data Management

- **v1.0 Graph API** - Migrated from beta to stable Microsoft Graph endpoints
- **Worker pool utility** - Parallel data fetching with throttling protection
- **Optimized caching** - SessionStorage for authentication contexts
- **Reduced throttling** - Smart delays prevent 429 errors

### Code Quality

- **Type safety enhancements** - Replaced `any` types with `unknown` for safer error handling
- **Code cleanup** - Removed debug code and unused features
- **Better patterns** - Context API replaces prop drilling

---

## 🔒 Security Hardening

### Production Safety

- All debug logging disabled in production
- Error messages sanitized for user-facing displays
- Security-sensitive operations require explicit permissions
- Client-side only architecture (no server-side data storage)

---

## 🐛 Bug Fixes

### Data Synchronization

- Race conditions on page refresh resolved
- Infinite loops in delta query logic eliminated
- False change detection on initial load prevented

### User Interface

- Filter state properly persists between page navigation
- Duration format bugs corrected across all components
- PDF export color handling for canvas rendering fixed
- Notification recipient mapping corrected

---

## 📚 Documentation & Transparency

### Open Source Commitment

- **GPL v3.0 License** - Full transparency and open-source licensing
- **Comprehensive README** - Clear architecture philosophy and governance focus
- **Development transparency** - Full changelog and version history available

### Enhanced Documentation

- Architecture deep-dives with enterprise sections
- PIM Groups data flow documentation
- PDF export usage guides
- Help modal improvements with better navigation

---

_PIM Manager is client-side only, open-source, and designed with Zero Trust principles. Your data stays in your browser, and you maintain complete control._
