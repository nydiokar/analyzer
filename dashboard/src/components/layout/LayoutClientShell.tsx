'use client';

import React, { useState } from 'react';
import { ThemeProvider } from "@/components/theme-provider";
import Sidebar from "@/components/layout/Sidebar";
import { Toaster } from 'sonner';

interface LayoutClientShellProps {
  children: React.ReactNode;
}

export default function LayoutClientShell({ children }: LayoutClientShellProps) {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const toggleSidebar = () => {
    setIsSidebarCollapsed(!isSidebarCollapsed);
  };

  return (
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
  );
} 