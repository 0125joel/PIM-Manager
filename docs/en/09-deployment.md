# Deploying to Cloudflare Pages

The PIM Manager is a client-side Single Page Application (SPA) built with Next.js static export. It is optimized for hosting on **Cloudflare Pages**.

---

## Configuration Settings

When connecting your GitHub repository to Cloudflare Pages, use the following build settings:

### 1. Build Configuration

| Setting | Value |
|---------|-------|
| **Framework Preset** | `Next.js (Static HTML Export)` |
| **Build Command** | `npm run build` |
| **Output Directory** | `out` |
| **Node.js Version** | `20` (or 18+) |

> [!NOTE]
> The project is configured with `output: "export"` in `next.config.ts`, which generates a static HTML site in the `out` directory. You do not need the `@cloudflare/next-on-pages` adapter.

### 2. Environment Variables

You must configure the following Environment Variables in the Cloudflare Pages dashboard (**Settings > Environment variables**):

| Variable Name | Description | Example Value |
|---------------|-------------|---------------|
| `NEXT_PUBLIC_CLIENT_ID` | Application (client) ID from your Microsoft Entra ID App Registration | `00000000-0000-0000-0000-000000000000` |
| `NEXT_PUBLIC_REDIRECT_URI` | Full URL of your production site (optional, see note) | `https://pim-configurator.pages.dev` |

> [!TIP]
> **Redirect URI Note:** The application automatically detects `window.location.origin` if `NEXT_PUBLIC_REDIRECT_URI` is not set. This allows the same build to work on **Preview Deployments** (e.g., `https://pr-123.pim-configurator.pages.dev`) without manual reconfiguration!

---

## Microsoft Entra ID Configuration

For the deployment to work, you must add the Cloudflare URL to your **Microsoft Entra ID App Registration**:

1. Go to **Azure Portal > Entra ID > App registrations > [Your App]**.
2. Select **Authentication**.
3. Under **Single-page application**, add your production URI:
   - `https://[your-project].pages.dev`
4. **(Recommended)** Also add a wildcard for preview deployments if your security policy allows:
   - `https://*.pages.dev` (Note: Check if your tenant allows wildcards for SPAs)

---

## Troubleshooting

### `Error: Image Optimization Using Next.js default loader is not compatible with 'next export'`
- **Cause:** You used `<Image />` component without configuring `unoptimized: true`.
- **Fix:** This is already handled in `next.config.ts`. If you see this, ensure `images: { unoptimized: true }` is present.

### `404` on Refresh
- **Cause:** Single Page Apps handle routing client-side. If you refresh `/report`, the server looks for `report.html`.
- **Fix:** Cloudflare Pages automatically handles this by default. No `_redirects` file is strictly needed for standard Next.js exports, but if issues persist, ensure your build output structure is correct.
