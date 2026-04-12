# Deployment

PIM Manager is a client-side SPA (Next.js static export) that can be hosted on any static hosting platform. This document covers the two supported deployment targets.

---

## Option A: Hosted Version (pimmanager.com)

No setup required. Visit [pimmanager.com](https://pimmanager.com) and sign in with your Microsoft Entra ID account.

You will need an App Registration in your tenant — see [App Registration](#app-registration) below.

---

## Option B: Self-Hosted on Azure Static Web Apps

Self-hosting runs PIM Manager entirely within your own Azure tenant. Nothing leaves your environment.

### Who this is for

This option assumes you are comfortable with:
- Creating and configuring resources in Azure Portal
- Microsoft Entra ID App Registrations and API permissions
- Understanding what a redirect URI is and why it matters

If you are not familiar with these concepts, use the hosted version instead.

### What gets deployed

The ARM template creates the following resources in your chosen Resource Group:

| Resource | Purpose | Cost |
|----------|---------|------|
| Azure Static Web App (Free tier) | Hosts the application | Free |
| User-assigned Managed Identity | Required by the deployment script | Free |
| Storage Account (Standard LRS) | Temporary state for the deployment script | ~€0.01/month |
| Deployment Script | Downloads the latest release and deploys it — removed after 24h | Free |

The Managed Identity and Storage Account are infrastructure concerns for the one-time deployment process. They have no relation to how the running application authenticates users — that is handled entirely by your App Registration.

### Authentication: why no secrets are needed

PIM Manager uses **Authorization Code Flow with PKCE** — the correct flow for browser-based SPAs. This flow requires only a Client ID, which is intentionally public. There is no client secret, no certificate, and nothing to rotate. Security is enforced by the redirect URI whitelist in your App Registration and by PKCE itself.

The Managed Identity in the ARM template is a separate concern: it only exists to authenticate the deployment container to Azure during the initial setup. Once the app is running, the Managed Identity is unused.

### Prerequisites

Before clicking Deploy, you need:

1. An **Azure subscription** with permission to create resources in a Resource Group
2. An **App Registration** in your Entra ID tenant — see [App Registration](#app-registration) below

> Create the App Registration first, but leave the Redirect URI blank for now. You will add it after deployment once you know your Static Web App URL.

### Deploy

[![Deploy to Azure](https://aka.ms/deploytoazurebutton)](https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2F0125joel%2FPIM-manager%2Fmain%2Fazuredeploy.json)

The deployment form asks for:

| Parameter | Description |
|-----------|-------------|
| **Subscription** | Your Azure subscription |
| **Resource Group** | Select existing or create new |
| **Static Web App Name** | Resource name in Azure (e.g. `pim-manager`) |
| **Location** | Azure region — West Europe recommended |
| **Entra Client ID** | Client ID from your App Registration |

Deployment takes approximately 3–5 minutes. When complete, the output shows your Static Web App URL.

### Post-deployment: add the Redirect URI

After deployment, add your Static Web App URL as a Redirect URI in your App Registration:

1. Go to **Entra ID > App registrations > [Your App] > Authentication**
2. Under **Single-page application**, add your SWA URL (e.g. `https://your-app.azurestaticapps.net`)
3. Save

> [!IMPORTANT]
> The redirect URI must be registered under **Single-page application**, not under "Web". Using the "Web" type will cause MSAL authentication to fail with a CORS-related error.

The app will not function until this step is completed.

---

## App Registration

All deployment options require an App Registration in your Microsoft Entra ID tenant.

### Create the App Registration

1. Go to **Entra ID > App registrations > New registration**
2. Name: anything recognisable (e.g. `PIM Manager`)
3. Supported account types: **Accounts in this organizational directory only**
4. Redirect URI: leave blank for now — add after deployment
5. Register

### Required API permissions

Grant the following **Delegated** permissions (no Application permissions, no secrets):

| Permission | Used for |
|------------|---------|
| `User.Read` | User profile |
| `RoleManagement.Read.Directory` | Role definitions |
| `RoleAssignmentSchedule.Read.Directory` | Active assignments |
| `RoleEligibilitySchedule.Read.Directory` | Eligible assignments |
| `RoleManagementPolicy.Read.Directory` | PIM policies |
| `Policy.Read.ConditionalAccess` | CA authentication contexts |
| `User.Read.All` | Resolve user display names |
| `Group.Read.All` | Group resolution |
| `AdministrativeUnit.Read.All` | AU-scoped assignments |
| `Application.Read.All` | App-scoped assignments |

Grant admin consent for your organisation after adding the permissions.

> Additional permissions for PIM Groups, Security Alerts, and Configure features are requested incrementally via consent popups when the user enables those features. They do not need to be pre-configured here.
