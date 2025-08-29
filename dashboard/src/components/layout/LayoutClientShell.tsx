'use client';

import React, { useState, useMemo } from 'react';
import { ThemeProvider } from "@/components/theme-provider";
import Sidebar from "@/components/layout/Sidebar";
import { UserMenu } from "@/components/auth/UserMenu";
import { EmailVerificationBanner } from "@/components/auth/EmailVerificationBanner";
import { useAuth } from "@/hooks/useAuth";
import { usePathname } from "next/navigation";
import { Toaster } from 'sonner';
import { SWRConfig, SWRConfiguration } from 'swr';
import { defaultSWRConfig } from '@/lib/swr-config';
import { AppCacheProvider } from '@/lib/cache-provider';

interface LayoutClientShellProps {
  children: React.ReactNode;
}

export default function LayoutClientShell({ children }: LayoutClientShellProps) {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);
  const { isAuthenticated } = useAuth();
  const pathname = usePathname();

  // ✅ Create cache provider once and reuse it
  const cacheProvider = useMemo(() => new AppCacheProvider(), []);
  
  // ✅ Create SWR config once and reuse it
  const swrConfig = useMemo(() => ({
    ...defaultSWRConfig,
    provider: () => cacheProvider,
  }), [cacheProvider]);

  const toggleSidebar = () => {
    setIsSidebarCollapsed(!isSidebarCollapsed);
  };

  // Show UserMenu only on non-homepage routes when authenticated
  const showUserMenuInHeader = isAuthenticated && pathname !== '/';

  return (
    <SWRConfig value={swrConfig as SWRConfiguration}>
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        enableSystem
        disableTransitionOnChange
      >
        <div className="flex h-screen bg-background text-foreground">
          <Sidebar isCollapsed={isSidebarCollapsed} toggleSidebar={toggleSidebar} />
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Header for authenticated users on non-homepage routes */}
            {showUserMenuInHeader && (
              <header className="h-14 border-b border-gray-200 dark:border-gray-700 bg-background px-4 flex items-center justify-end flex-shrink-0">
                <UserMenu />
              </header>
            )}
            <main className="flex-1 overflow-auto transition-all duration-300 ease-in-out">
              <div className="p-4">
                <EmailVerificationBanner />
              </div>
              {children}
            </main>
          </div>
        </div>
        <Toaster />
      </ThemeProvider>
    </SWRConfig>
  );
} 