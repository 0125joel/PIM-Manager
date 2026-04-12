import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/AuthProvider";
import { ConditionalSidebar } from "@/components/ConditionalSidebar";
import { ConditionalLayout } from "@/components/ConditionalLayout";
import { ConditionalHeader } from "@/components/ConditionalHeader";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { PimDataProvider } from "@/contexts/DirectoryRoleContext";
import { UnifiedPimProvider } from "@/contexts/UnifiedPimContext";
import { MobileMenuProvider } from "@/contexts/MobileMenuContext";
import { ToastProvider } from "@/contexts/ToastContext";
import { GlobalProgressBar } from "@/components/GlobalProgressBar";
import { OnboardingWrapper } from "@/components/OnboardingWrapper";
import Script from "next/script";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

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
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-zinc-50 dark:bg-black`}
      >
        {/* beforeInteractive runs before hydration — sets runtime config and theme before React loads */}
        <Script src="/env-config.js" strategy="beforeInteractive" />
        <Script src="/theme-init.js" strategy="beforeInteractive" />
        <ThemeProvider>
          <AuthProvider>
            <ProtectedRoute>
              <MobileMenuProvider>
                <UnifiedPimProvider>
                  <PimDataProvider>
                    <ErrorBoundary>
                      <ToastProvider>
                        <GlobalProgressBar />
                        <div className="min-h-screen">
                          <ConditionalHeader />
                          <ConditionalSidebar />
                          <ConditionalLayout>
                            {children}
                          </ConditionalLayout>
                        </div>
                        <OnboardingWrapper />
                      </ToastProvider>
                    </ErrorBoundary>
                  </PimDataProvider>
                </UnifiedPimProvider>
              </MobileMenuProvider>
            </ProtectedRoute>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
