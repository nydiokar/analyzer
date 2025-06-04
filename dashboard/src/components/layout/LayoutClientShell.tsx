'use client';

import React, { useState } from 'react';
import { ThemeProvider } from "@/components/theme-provider";
import Sidebar from "@/components/layout/Sidebar";

interface LayoutClientShellProps {
  children: React.ReactNode;
}

export default function LayoutClientShell({ children }: LayoutClientShellProps) {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const toggleSidebar = () => {
    setIsSidebarCollapsed(!isSidebarCollapsed);
  };

  // const sidebarWidth = isSidebarCollapsed ? '5rem' : '16rem'; // This is no longer needed for marginLeft

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
    >
      <div className="flex h-screen">
        <Sidebar isCollapsed={isSidebarCollapsed} toggleSidebar={toggleSidebar} />
        <main 
          className={`flex-1 overflow-auto transition-all duration-300 ease-in-out`}
          // style={{ marginLeft: sidebarWidth }} // REMOVED: Flexbox handles positioning
        >
          {children}
        </main>
      </div>
    </ThemeProvider>
  );
} 