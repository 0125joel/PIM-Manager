import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import { AppProviders } from "@/components/AppProviders";
import Script from "next/script";

// IBM Plex replaced Geist (Configure design round 9, 2026-10-03): it reads more easily in dense tables
const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500"],
});

// viewport-fit=cover makes env(safe-area-inset-bottom) available for the bottom navigation
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "PIM Manager",
  description: "Streamline your Microsoft Entra ID Privileged Identity Management",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className={`${plexSans.variable} ${plexMono.variable} antialiased bg-page text-ink`}
      >
        {/* beforeInteractive runs before hydration, sets runtime config and theme before React loads */}
        <Script src="/env-config.js" strategy="beforeInteractive" />
        <Script src="/theme-init.js" strategy="beforeInteractive" />
        <AppProviders>
          {children}
        </AppProviders>
      </body>
    </html>
  );
}
