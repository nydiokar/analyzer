'use client';

import React, { useState, useMemo } from 'react';
import { ThemeProvider } from "@/components/theme-provider";
import Sidebar from "@/components/layout/Sidebar";
import { Toaster } from 'sonner';
import { SWRConfig, SWRConfiguration } from 'swr';
import { defaultSWRConfig } from '@/lib/swr-config';
import { AppCacheProvider } from '@/lib/cache-provider';

interface LayoutClientShellProps {
  children: React.ReactNode;
}

export default function LayoutClientShell({ children }: LayoutClientShellProps) {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

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
          <main className="flex-1 overflow-auto transition-all duration-300 ease-in-out">
            {children}
          </main>
        </div>
        <Toaster />
      </ThemeProvider>
    </SWRConfig>
  );
} 