# Implementeren op Cloudflare Pages

De PIM Manager is een client-side Single Page Application (SPA) gebouwd met Next.js static export. De applicatie is geoptimaliseerd voor hosting op **Cloudflare Pages**.

---

## Configuratie-instellingen

Gebruik bij het koppelen van je GitHub repository aan Cloudflare Pages de volgende instellingen:

### 1. Build Configuratie

| Instelling | Waarde |
|---------|-------|
| **Framework Preset** | `Next.js (Static HTML Export)` |
| **Build Command** | `npm run build` |
| **Output Directory** | `out` |
| **Node.js Versie** | `20` (of 18+) |

> [!NOTE]
> Het project is geconfigureerd met `output: "export"` in `next.config.ts`. Dit genereert een statische HTML-site in de `out` map. Je hebt de `@cloudflare/next-on-pages` adapter **niet** nodig.

### 2. Omgevingsvariabelen (Environment Variables)

Configureer de volgende variabelen in het Cloudflare Pages dashboard (**Settings > Environment variables**):

| Variabele Naam | Beschrijving | Voorbeeld Waarde |
|---------------|-------------|-----------------|
| `NEXT_PUBLIC_CLIENT_ID` | Application (client) ID van je Microsoft Entra ID App Registratie | `00000000-0000-0000-0000-000000000000` |
| `NEXT_PUBLIC_REDIRECT_URI` | Volledige URL van je productieomgeving (optioneel, zie tip) | `https://pim-configurator.pages.dev` |

> [!TIP]
> **Redirect URI Tip:** De applicatie detecteert automatisch `window.location.origin` als `NEXT_PUBLIC_REDIRECT_URI` niet is ingesteld. Hierdoor werkt dezelfde build ook op **Preview Deployments** (bijv. `https://pr-123.pim-configurator.pages.dev`) zonder extra configuratie!

---

## Microsoft Entra ID Configuratie

Om de deployment te laten werken, moet je de Cloudflare URL toevoegen aan je **Microsoft Entra ID App Registratie**:

1. Ga naar **Azure Portal > Entra ID > App registrations > [Jouw App]**.
2. Selecteer **Authentication**.
3. Voeg onder **Single-page application** je productie-URI toe:
   - `https://[jouw-project].pages.dev`
4. **(Aanbevolen)** Voeg ook een wildcard toe voor preview deployments (als je beveiligingsbeleid dit toestaat):
   - `https://*.pages.dev` (Let op: Controleer of je tenant wildcards toestaat voor SPA's)

---

## Problemen Oplossen (Troubleshooting)

### `Error: Image Optimization Using Next.js default loader is not compatible with 'next export'`
- **Oorzaak:** Je gebruikt de `<Image />` component zonder `unoptimized: true` te configureren.
- **Oplossing:** Dit is al opgelost in `next.config.ts`. Controleer of `images: { unoptimized: true }` aanwezig is bij fouten.

### `404` bij Refresh
- **Oorzaak:** Single Page Apps regelen routing aan de client-kant. Als je `/report` ververst, zoekt de server naar `report.html`.
- **Oplossing:** Cloudflare Pages regelt dit standaard automatisch correct. Er is geen `_redirects` bestand nodig voor standaard Next.js exports, maar controleer je build output als dit probleem aanhoudt.
