'use client';

import React from 'react';
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from 'sonner';

interface LandingShellProps {
  children: React.ReactNode;
}

/**
 * LandingShell - Minimal layout for unauthenticated landing page
 *
 * Features:
 * - ThemeProvider for dark/light mode
 * - No sidebar, no navigation
 * - Clean wrapper for hero page
 * - Toaster for notifications
 */
export function LandingShell({ children }: LandingShellProps) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
    >
      <div className="min-h-screen bg-background text-foreground">
        {children}
      </div>
      <Toaster />
    </ThemeProvider>
  );
}
