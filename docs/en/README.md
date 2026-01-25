# PIM Manager Documentation

Welcome to the PIM Manager technical documentation. This guide is designed for **M365 Engineers** who want to understand how the application works.

## Table of Contents

| Document | Description |
|----------|-------------|
| [Introduction](./01-introduction.md) | What is PIM Manager and what problems does it solve? |
| [Folder Structure](./02-folder-structure.md) | Overview of the codebase organization |
| [Data Flow](./03-data-flow.md) | How data is fetched and processed |
| [Graph API Calls](./04-graph-api-calls.md) | Which Microsoft Graph APIs are used |
| [Security Model](./05-security.md) | Authentication, authorization, and data protection |
| [Key Concepts](./06-key-concepts.md) | Important technical concepts explained |
| [Dashboard Page](./07-dashboard-page.md) | Visual overview and security insights |
| [Report Page](./08-report-page.md) | Detailed role configuration view |
| [Configure Page](./09-configure-page.md) | Planned write capabilities |
| [Deployment](./10-deployment.md) | Hosting on Cloudflare Pages |
| [Settings](./11-settings.md) | Workloads and consent framework |

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
