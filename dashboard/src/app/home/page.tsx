'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { UserCircle2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { SignInModal } from '@/components/auth/SignInModal';
import { SignUpModal } from '@/components/auth/SignUpModal';
import { UserProfileDropdown } from '@/components/auth/UserProfileDropdown';

export default function HomePage() {
  const { isAuthenticated, user } = useAuth();
  const [showSignIn, setShowSignIn] = useState(false);
  const [showSignUp, setShowSignUp] = useState(false);

  const switchToSignUp = () => {
    setShowSignIn(false);
    setTimeout(() => setShowSignUp(true), 150);
  };

  const switchToSignIn = () => {
    setShowSignUp(false);
    setTimeout(() => setShowSignIn(true), 150);
  };

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 relative overflow-hidden">
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-pulse delay-1000"></div>
      </div>

      {/* Header */}
      <header className="relative z-10 w-full px-6 py-4 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <Image
            src="/sova_badge_primary.svg"
            alt="Sova Intel Logo"
            width={40}
            height={40}
            className="rounded-lg"
          />
        </div>

        {/* Auth UI */}
        <div>
          {!isAuthenticated ? (
            <div className="flex items-center gap-3">
              <Button
                onClick={() => setShowSignIn(true)}
                variant="ghost"
                className="text-slate-300 hover:text-white hover:bg-slate-800/50 transition-all"
              >
                Sign In
              </Button>
              <Button
                onClick={() => setShowSignUp(true)}
                className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white px-6 shadow-lg shadow-blue-500/25 transition-all"
              >
                Sign Up
              </Button>
            </div>
          ) : (
            <UserProfileDropdown />
          )}
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
              Your gateway to advanced Solana wallet analytics, behavioral insights, and trading intelligence.
            </p>
          </div>

          {!isAuthenticated && (
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-8">
              <Button
                onClick={() => setShowSignUp(true)}
                size="lg"
                className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white px-8 py-6 text-lg shadow-2xl shadow-blue-500/30 transition-all hover:scale-105"
              >
                Get Started Free
              </Button>
              <Button
                onClick={() => setShowSignIn(true)}
                size="lg"
                variant="outline"
                className="border-slate-700 text-slate-300 hover:bg-slate-800/50 hover:text-white px-8 py-6 text-lg transition-all"
              >
                Sign In
              </Button>
            </div>
          )}

          {isAuthenticated && (
            <div className="pt-8 space-y-4">
              <div className="flex items-center justify-center gap-3 text-slate-300">
                <UserCircle2 className="w-8 h-8 text-blue-400" />
                <p className="text-lg">
                  Logged in as{' '}
                  <span className="font-semibold text-white">
                    {user?.displayName || user?.email || 'User'}
                  </span>
                </p>
              </div>
              <Button
                size="lg"
                className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white px-8 py-6 text-lg shadow-2xl shadow-blue-500/30 transition-all hover:scale-105"
              >
                Go to Dashboard
              </Button>
            </div>
          )}
        </div>
      </main>

      {/* Modals */}
      <SignInModal
        open={showSignIn}
        onOpenChange={setShowSignIn}
        onSwitchToSignUp={switchToSignUp}
      />
      <SignUpModal
        open={showSignUp}
        onOpenChange={setShowSignUp}
        onSwitchToSignIn={switchToSignIn}
      />
    </div>
  );
}
