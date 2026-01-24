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
import { GlobalProgressBar } from "@/components/GlobalProgressBar";


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
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  const theme = localStorage.getItem('theme') || 'system';
                  const root = document.documentElement;
                  root.classList.remove('light', 'dark');

                  if (theme === 'system') {
                    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
                    root.classList.add(systemTheme);
                  } else {
                    root.classList.add(theme);
                  }
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body
        suppressHydrationWarning
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-zinc-50 dark:bg-black`}
      >
        <ThemeProvider>
          <AuthProvider>
            <ProtectedRoute>
              <MobileMenuProvider>
                <UnifiedPimProvider>
                  <PimDataProvider>
                    <ErrorBoundary>
                      <GlobalProgressBar />
                      <div className="min-h-screen">
                        <ConditionalHeader />
                        <ConditionalSidebar />
                        <ConditionalLayout>
                          {children}
                        </ConditionalLayout>
                      </div>
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
