# PIM Manager Documentation

Welcome to the PIM Manager technical documentation. This guide is designed for **M365 Engineers** who want to understand how the application works.

## Table of Contents

| Document | Description |
|----------|-------------|
| [Architecture](./00-architecture.md) | Architecture and design decisions in one document |
| [Introduction](./01-introduction.md) | What is PIM Manager and what problems does it solve? |
| [Folder Structure](./02-folder-structure.md) | Overview of the codebase organization |
| [Data Flow](./03-data-flow.md) | How data is fetched and processed |
| [Graph API Calls](./04-graph-api-calls.md) | Which Microsoft Graph APIs are used |
| [Security Model](./05-security.md) | Authentication, authorization, and data protection |
| [Key Concepts](./06-key-concepts.md) | Important technical concepts explained |
| [Dashboard Page](./07-dashboard-page.md) | Visual overview and security insights |
| [Report Page](./08-report-page.md) | Detailed role configuration view |
| [Configure Page](./09-configure-page.md) | Edit, Guided, Import and Access model, with review and Undo |
| [Deployment](./10-deployment.md) | The hosted version at pimmanager.com or your own copy on Azure Static Web Apps, and the app registration |
| [Settings](./11-settings.md) | Workloads and consent framework |
| [Azure Dashboard](./12-azure-dashboard.md) | Privileged access on Azure resources |
| [Audit Page](./13-audit-page.md) | Activations and changes in Entra roles and groups and on Azure resources, with export |

---

## Quick Start

1. Clone the repository
2. Run `npm install`
3. Configure Microsoft Entra ID app registration (see [Introduction](./01-introduction.md))
4. Run `npm run dev` for development

---

## Need Help?

- Check the [Key Concepts](./06-key-concepts.md) for explanations of technical terms
- Review [Data Flow](./03-data-flow.md) to understand how the app fetches data
- Read the [Security Model](./05-security.md) to understand authentication and data protection
