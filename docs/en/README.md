# PIM Manager Documentation

Welcome to the PIM Manager technical documentation. This guide is designed for **M365 Engineers** who want to understand how the application works.

## Table of Contents

| Document | Description |
|----------|-------------|
| [Introduction](./01-introduction.md) | What is PIM Configurator and what problems does it solve? |
| [Folder Structure](./02-folder-structure.md) | Overview of the codebase organization |
| [Data Flow](./03-data-flow.md) | How data is fetched and processed |
| [Graph API Calls](./04-graph-api-calls.md) | Which Microsoft Graph APIs are used |
| [Key Concepts](./05-key-concepts.md) | Important technical concepts explained |
| [Report Page](./06-report-page.md) | Features and functionality of the Report page |
| [Configure Page](./07-configure-page.md) | Configure page features (In Development) |
| [Deployment](./08-deployment.md) | Hosting on Cloudflare Pages |
| [Settings](./09-settings.md) | Workloads and Consent Framework |

---

## Quick Start

1. Clone the repository
2. Run `npm install`
3. Configure Azure AD app registration (see [Introduction](./01-introduction.md))
4. Run `npm run dev` for development

---

## Need Help?

- Check the [Key Concepts](./05-key-concepts.md) for explanations of technical terms
- Review [Data Flow](./03-data-flow.md) to understand how the app fetches data
