'use client';

import React, { useState, useMemo } from 'react';
import { ThemeProvider } from "@/components/theme-provider";
import { EmailVerificationBanner } from "@/components/auth/EmailVerificationBanner";
import { UserMenu } from "@/components/auth/UserMenu";
import { WalletSearch } from "@/components/sidebar/WalletSearch";
import { Toaster } from 'sonner';
import { SWRConfig, SWRConfiguration } from 'swr';
import { defaultSWRConfig } from '@/lib/swr-config';
import { AppCacheProvider } from '@/lib/cache-provider';
import { useProactiveRefresh } from '@/hooks/useProactiveRefresh';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import Image from 'next/image';

interface AppShellProps {
  children: React.ReactNode;
}

/**
 * AppShell - Main application layout with top bar navigation
 *
 * Features:
 * - Fixed top bar with horizontal navigation
 * - Logo + tool links (left)
 * - Search + Favorites + Profile (right)
 * - Email verification banner
 * - SWR cache provider
 * - Proactive JWT refresh
 */
export function AppShell({ children }: AppShellProps) {
  // Keep active users signed in by refreshing 5 minutes before expiry when tab is active
  useProactiveRefresh();

  const pathname = usePathname();

  // Create cache provider once and reuse it
  const cacheProvider = useMemo(() => new AppCacheProvider(), []);

  // Create SWR config once and reuse it
  const swrConfig = useMemo(() => ({
    ...defaultSWRConfig,
    provider: () => cacheProvider,
  }), [cacheProvider]);

  const navItems = [
    { href: '/discover', label: 'Discover' },
    { href: '/trackers', label: 'My Wallets' },
    { href: '/similarity-lab', label: 'Similarity Lab' },
    { href: '/tools/holder-profiles', label: 'Holder Profiles' },
    { href: '/tools/top-holders', label: 'Top Holders' },
  ];

  const isActiveRoute = (href: string) => {
    if (href === '/discover') {
      return pathname === href;
    }
    return pathname.startsWith(href);
  };

  return (
    <SWRConfig value={swrConfig as SWRConfiguration}>
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        enableSystem
        disableTransitionOnChange
      >
        <div className="flex flex-col h-screen w-screen bg-background text-foreground overflow-hidden">
          {/* Top Bar */}
          <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
            <div className="flex h-14 items-center px-4 gap-4">
              {/* Left: Logo + Navigation */}
              <div className="flex items-center gap-6">
                {/* Logo */}
                <Link href="/discover" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
                  <Image
                    src="/logo.svg"
                    alt="Sova Intel"
                    width={24}
                    height={24}
                    className="w-6 h-6"
                  />
                  <span className="font-semibold text-base hidden sm:inline-block">Sova Intel</span>
                </Link>

                {/* Navigation Links */}
                <nav className="hidden md:flex items-center gap-1">
                  {navItems.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
                        isActiveRoute(item.href)
                          ? "bg-accent text-accent-foreground"
                          : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                      )}
                    >
                      {item.label}
                    </Link>
                  ))}
                </nav>
              </div>

              {/* Right: Search + Favorites + Profile */}
              <div className="ml-auto flex items-center gap-3">
                {/* Search */}
                <div className="w-64 hidden lg:block">
                  <WalletSearch />
                </div>

                {/* Favorites (Placeholder) */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
                  title="Favorites (Coming Soon)"
                >
                  <Star className="h-4 w-4" />
                </Button>

                {/* Profile Menu */}
                <UserMenu />
              </div>
            </div>
          </header>

          {/* Main Content */}
          <main className="flex-1 overflow-y-auto overflow-x-hidden">
            <EmailVerificationBanner />
            {children}
          </main>
        </div>
        <Toaster />
      </ThemeProvider>
    </SWRConfig>
  );
}
