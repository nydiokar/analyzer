'use client';

import React, { useState, Suspense, useEffect } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { AuthModal } from '@/components/auth/AuthModal';
import { useRouter, useSearchParams } from 'next/navigation';
import { LandingShell } from '@/components/layout/LandingShell';
import { Send } from 'lucide-react';
import Link from 'next/link';

// Component that uses search params - must be wrapped in Suspense
function SearchParamsHandler({ showAuthModal, setShowAuthModal }: { showAuthModal: boolean; setShowAuthModal: (show: boolean) => void }) {
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Check if redirected from a protected route
  useEffect(() => {
    const redirectPath = searchParams.get('redirect');
    if (redirectPath && !isAuthenticated) {
      setShowAuthModal(true);
    }
  }, [searchParams, isAuthenticated, setShowAuthModal]);

  // Redirect authenticated users to discover (or to their intended destination)
  useEffect(() => {
    if (isAuthenticated) {
      const redirectPath = searchParams.get('redirect');
      router.push(redirectPath || '/discover');
    }
  }, [isAuthenticated, router, searchParams]);

  // Don't render anything while redirecting
  if (isAuthenticated) {
    return null;
  }

  return (
    <AuthModal
      open={showAuthModal}
      onOpenChange={setShowAuthModal}
      onSuccess={() => {
        setShowAuthModal(false);
        router.push('/discover');
      }}
    />
  );
}

export default function LandingPage() {
  const [showAuthModal, setShowAuthModal] = useState(false);

  return (
    <LandingShell>
      <div className="min-h-screen w-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 relative overflow-hidden">
        {/* Animated background elements */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-pulse"></div>
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-pulse delay-1000"></div>
        </div>

        {/* Header */}
        <header className="relative z-10 w-full px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Image
              src="/sova_badge_primary.svg"
              alt="Sova Intel Logo"
              width={40}
              height={40}
              className="rounded-lg"
            />
            <span className="font-semibold text-lg text-white">Sova Intel</span>
          </div>

          {/* Auth Buttons */}
          <div className="flex items-center gap-3">
            <Button
              onClick={() => setShowAuthModal(true)}
              variant="ghost"
              className="text-slate-300 hover:text-white hover:bg-slate-800/50 transition-all"
            >
              Log In
            </Button>
            <Button
              onClick={() => setShowAuthModal(true)}
              className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white px-6 shadow-lg shadow-blue-500/25 transition-all"
            >
              Sign Up
            </Button>
          </div>
        </header>

        {/* Main Content */}
        <main className="relative z-10 flex flex-col items-center justify-center min-h-[calc(100vh-80px)] px-6 text-center">
          <div className="max-w-4xl mx-auto space-y-8">
            <div className="space-y-4">
              <h2 className="text-6xl font-bold text-white leading-tight">
                Welcome to{' '}
                <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                  Sova Intel
                </span>
              </h2>
              <p className="text-xl text-slate-400 max-w-2xl mx-auto">
              Your control layer for advanced Solana wallet analytics and behavioral intelligence.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-8">
              <Button
                onClick={() => setShowAuthModal(true)}
                size="lg"
                className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white px-8 py-6 text-lg shadow-2xl shadow-blue-500/30 transition-all hover:scale-105"
              >
                Start Analyzing
              </Button>
            </div>

            {/* Social Links - Landing Page Footer Style */}
            <div className="flex items-center justify-center gap-6 pt-16 pb-8">
              <Link
                href="https://t.me/sovaintel"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-slate-300 hover:text-white transition-colors group"
              >
                <Send className="h-5 w-5 group-hover:scale-110 transition-transform" />
                <span className="text-sm font-medium">Telegram</span>
              </Link>
              <div className="h-5 w-px bg-slate-700"></div>
              <Link
                href="https://x.com/Sova_intel"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-slate-300 hover:text-white transition-colors group"
              >
                <svg className="h-5 w-5 group-hover:scale-110 transition-transform" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                </svg>
                <span className="text-sm font-medium">X / Twitter</span>
              </Link>
            </div>
          </div>
        </main>

        {/* Search Params Handler with Suspense */}
        <Suspense fallback={null}>
          <SearchParamsHandler showAuthModal={showAuthModal} setShowAuthModal={setShowAuthModal} />
        </Suspense>
      </div>
    </LandingShell>
  );
}
