'use client';

import React, { useState, useMemo } from 'react';
import { ThemeProvider } from "@/components/theme-provider";
import { EmailVerificationBanner } from "@/components/auth/EmailVerificationBanner";
import { UserMenu } from "@/components/auth/UserMenu";
import { WalletSearch } from "@/components/shared/WalletSearch";
import { AuthModal } from "@/components/auth/AuthModal";
import { Toaster } from 'sonner';
import { SWRConfig, SWRConfiguration } from 'swr';
import { defaultSWRConfig } from '@/lib/swr-config';
import { AppCacheProvider } from '@/lib/cache-provider';
import { useProactiveRefresh } from '@/hooks/useProactiveRefresh';
import { useAuth } from '@/hooks/useAuth';
import { useUIStore } from '@/store/ui-store';
import { useCredits } from '@/hooks/useCredits';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Star, Menu, Send, Coins } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import Image from 'next/image';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

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
  const router = useRouter();
  const { isAuthenticated, user } = useAuth();
  const { balance } = useCredits();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Use global UI store for auth modal (can be triggered from anywhere)
  const { showAuthModal, authModalReason, setShowAuthModal } = useUIStore();

  // Create cache provider once and reuse it
  const cacheProvider = useMemo(() => new AppCacheProvider(), []);

  // Create SWR config once and reuse it
  const swrConfig = useMemo(() => ({
    ...defaultSWRConfig,
    provider: () => cacheProvider,
  }), [cacheProvider]);

  const navItems = [
    { href: '/discover', label: 'Discover' },
    { href: '/trackers', label: 'Tracked Wallets' },
    { href: '/similarity-lab', label: 'Similarity Lab' },
    { href: '/tools/holder-profiles', label: 'Holder Profiles' },
    { href: '/wallet-hunt', label: 'Wallet Hunt' },
    ...(user?.isAnalyst || user?.isAdmin
      ? [
          { href: '/tools/sig-buyers', label: 'Sig Buyers' },
          { href: '/radar', label: 'Radar' },
          { href: '/tokens', label: 'Tokens' },
        ]
      : []),
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
              <div className="flex items-center gap-3 md:gap-6">
                {/* Mobile Menu Button */}
                <Dialog open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
                  <DialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="md:hidden h-9 w-9 text-white"
                    >
                      <Menu className="h-5 w-5" />
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                      <DialogTitle>Navigation</DialogTitle>
                    </DialogHeader>
                    <nav className="flex flex-col gap-2 mt-4">
                      {navItems.map((item) => (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={() => setMobileMenuOpen(false)}
                          className={cn(
                            "px-4 py-3 text-sm font-medium rounded-md transition-colors",
                            isActiveRoute(item.href)
                              ? "bg-accent text-accent-foreground"
                              : "hover:bg-accent/50"
                          )}
                        >
                          {item.label}
                        </Link>
                      ))}
                    </nav>
                  </DialogContent>
                </Dialog>

                {/* Logo */}
                <Link href="/discover" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
                  <Image
                    src="/sova_badge_primary.svg"
                    alt="Sova Intel"
                    width={28}
                    height={28}
                    className="w-7 h-7"
                  />
                  <span className="font-semibold text-sm sm:text-base text-white whitespace-nowrap">Sova Intel</span>
                </Link>

                {/* Desktop Navigation Links */}
                <nav className="hidden md:flex items-center gap-1">
                  {navItems.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "px-3 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap",
                        isActiveRoute(item.href)
                          ? "bg-accent text-white"
                          : "text-white/70 hover:text-white hover:bg-accent/50"
                      )}
                    >
                      {item.label}
                    </Link>
                  ))}
                </nav>
              </div>

              {/* Right: Search + Favorites + Profile/Auth */}
              <div className="ml-auto flex items-center gap-3">
                {/* Search */}
                <div className="w-64 hidden lg:block">
                  <WalletSearch />
                </div>

                {/* Favorites (Placeholder) */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 hidden sm:flex"
                  title="Favorite tokens (Coming Soon)"
                >
                  <Star className="h-4 w-4" />
                </Button>

                {/* Credit balance chip — visible when authenticated */}
                {isAuthenticated && balance !== null && (
                  <Link
                    href="/dashboard/credits"
                    className="hidden sm:flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-foreground hover:border-blue-500 transition-colors"
                    title="Credits & Billing"
                  >
                    <Coins className="h-3.5 w-3.5 text-blue-400" />
                    {balance.toLocaleString()}
                  </Link>
                )}

                {/* Profile Menu or Auth Buttons */}
                {isAuthenticated ? (
                  <UserMenu />
                ) : (
                  <div className="flex items-center gap-2">
                    <Button
                      onClick={() => setShowAuthModal(true, 'manual')}
                      variant="ghost"
                      size="sm"
                      className="hidden sm:flex text-white/70 hover:text-white"
                    >
                      Log In
                    </Button>
                    <Button
                      onClick={() => setShowAuthModal(true, 'manual')}
                      size="sm"
                      className="bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      Sign Up
                    </Button>
                  </div>
                )}
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

        {/* Auth Modal */}
        <AuthModal
          open={showAuthModal}
          onOpenChange={(open) => setShowAuthModal(open, open ? authModalReason : undefined)}
          reason={authModalReason}
          onSuccess={() => {
            setShowAuthModal(false);
            // Don't redirect if session expired - keep user on current page
            if (authModalReason !== 'session_expired') {
              router.push('/discover');
            }
          }}
        />
      </ThemeProvider>
    </SWRConfig>
  );
}
