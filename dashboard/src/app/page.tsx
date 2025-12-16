'use client';

import { Button } from "@/components/ui/button";
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { AuthModal } from '@/components/auth/AuthModal';
import Image from 'next/image';
import { useState } from 'react';
import { LandingShell } from '@/components/layout/LandingShell';
import { useRouter } from 'next/navigation';

export default function LandingPage() {
  const { isAuthenticated } = useAuth();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const router = useRouter();

  // If authenticated, redirect to discover
  if (isAuthenticated) {
    router.push('/discover');
    return null;
  }

  return (
    <LandingShell>
      <div className="min-h-screen bg-gradient-to-br from-slate-950 to-slate-900">
        {/* Minimal Header */}
        <header className="container mx-auto max-w-6xl px-6 py-4 flex justify-between items-center">
          <Link href="/" className="flex items-center gap-2">
            <Image
              src="/logo.svg"
              alt="Sova Intel"
              width={32}
              height={32}
              className="w-8 h-8"
            />
            <span className="font-bold text-xl text-slate-50">Sova Intel</span>
          </Link>

          <div className="flex gap-2">
            <Button
              onClick={() => setShowAuthModal(true)}
              variant="ghost"
              size="sm"
              className="text-slate-200 hover:text-white hover:bg-slate-700"
            >
              Log In
            </Button>
            <Button
              onClick={() => setShowAuthModal(true)}
              size="sm"
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              Sign Up
            </Button>
          </div>
        </header>

        {/* Hero Section */}
        <main className="container mx-auto max-w-4xl px-6 py-20 text-center">
          {/* Logo */}
          <div className="mb-8 flex justify-center">
            <div className="relative">
              <div className="absolute inset-0 bg-blue-500/20 blur-3xl rounded-full"></div>
              <Image
                src="/logo.svg"
                alt="Sova Intel"
                width={120}
                height={120}
                className="w-24 h-24 sm:w-32 sm:h-32 relative"
              />
            </div>
          </div>

          {/* Tagline */}
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold mb-6 text-slate-50">
            Decode Solana Wallets
          </h1>

          {/* Description */}
          <p className="text-lg sm:text-xl text-slate-300 mb-10 max-w-2xl mx-auto">
            Sova Intel is the professional wallet analysis platform for Solana.
            Track PNL, uncover behavioral patterns, and analyze trading strategies with institutional-grade tools.
          </p>

          {/* CTA */}
          <Button
            onClick={() => setShowAuthModal(true)}
            size="lg"
            className="bg-blue-600 hover:bg-blue-700 text-white text-lg px-8 py-6 h-auto"
          >
            Start Analyzing
          </Button>

          {/* Feature Highlights */}
          <div className="mt-20 grid md:grid-cols-3 gap-8 text-left">
            <FeatureCard
              title="Deep PNL Tracking"
              description="Realized and unrealized gains, win rates, and ROI across all trades."
            />
            <FeatureCard
              title="Behavior Recognition"
              description="Automatically classify wallet strategies: snipers, holders, farmers, and more."
            />
            <FeatureCard
              title="Complete History"
              description="Every purchase, sale, and transfer for any Solana wallet."
            />
          </div>
        </main>

        {/* Footer */}
        <footer className="container mx-auto max-w-6xl px-6 py-8 text-center text-sm text-slate-500 border-t border-slate-800">
          <p>&copy; {new Date().getFullYear()} Sova Intel. All rights reserved.</p>
        </footer>
      </div>

      {/* Auth Modal */}
      <AuthModal
        open={showAuthModal}
        onOpenChange={setShowAuthModal}
        onSuccess={() => {
          setShowAuthModal(false);
          router.push('/discover');
        }}
      />
    </LandingShell>
  );
}

interface FeatureCardProps {
  title: string;
  description: string;
}

function FeatureCard({ title, description }: FeatureCardProps) {
  return (
    <div className="p-6 bg-slate-800/50 rounded-xl border border-slate-700 hover:border-slate-600 transition-colors">
      <h3 className="text-lg font-semibold mb-2 text-slate-100">{title}</h3>
      <p className="text-sm text-slate-400">{description}</p>
    </div>
  );
}
