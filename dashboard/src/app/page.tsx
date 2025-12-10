'use client';

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SearchIcon, ListIcon, UsersIcon, TrendingUpIcon, ActivityIcon, ChevronRightIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { AuthModal } from '@/components/auth/AuthModal';
import { UserMenu } from '@/components/auth/UserMenu';
import Image from 'next/image';
import { Badge } from "@/components/ui/badge";
import { useState, useEffect } from 'react';
import { toast } from 'sonner';
// It's better to import WalletSearch if it can be made context-agnostic
// For now, we'll create a simple search input placeholder
// import { WalletSearch } from \'@/components/sidebar/WalletSearch\';

function AuthHeader({ onShowAuthModal }: { onShowAuthModal?: () => void }) {
  const { isAuthenticated } = useAuth();

  if (isAuthenticated) {
    return <UserMenu className="ml-auto" />;
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        onClick={() => onShowAuthModal?.()}
        variant="ghost"
        size="sm"
        className="text-slate-200 hover:text-white hover:bg-slate-700"
      >
        Sign In
      </Button>
      <Button
        onClick={() => onShowAuthModal?.()}
        size="sm"
        className="bg-green-600 hover:bg-green-700 text-white"
      >
        Sign Up
      </Button>
    </div>
  );
}

const FEATURED_WALLETS = [
  { address: 'DNfuF1L62WWyW3pNakVkyGGFzVVhj4Yr52jSmdTyeBHm', name: 'Gake', suggested: true, description: "High-volume trader, risky profile" },
  { address: '96sErVjEN7LNJ6Uvj63bdRWZxNuBngj56fnT9biHLKBf', name: 'Orange', suggested: true, description: "Momentum strategy, mid-cap bias" },
  { address: 'Hnnw2hAgPgGiFKouRWvM3fSk3HnYgRv4Xq1PjUEBEuWM', name: 'SmartMoney', suggested: false, description: "Frequent sniping, low win rate" },
];


export default function Home() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, user, requestEmailVerification, verifyEmail } = useAuth();
  const [showAuthModal, setShowAuthModal] = useState(false);

  // Handle verify-token parameter (when user clicks email link while logged out)
  useEffect(() => {
    const verifyToken = searchParams.get('verify-token');
    if (verifyToken && isAuthenticated) {
      // User is now logged in, attempt verification
      const attemptVerify = async () => {
        try {
          const success = await verifyEmail(verifyToken);
          if (success) {
            toast.success('Email verified successfully! 🎉');
            // Clear the token from URL
            router.replace('/');
          } else {
            toast.error('Verification link expired or invalid. Please request a new one.');
          }
        } catch (error) {
          toast.error('Verification failed. Please try again.');
        }
      };
      attemptVerify();
    } else if (verifyToken && !isAuthenticated) {
      // Show auth modal with a message
      toast.info('Please sign in to verify your email', { duration: 5000 });
      setShowAuthModal(true);
    }
  }, [searchParams, isAuthenticated, verifyEmail, router]);

  const handleSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const query = formData.get("walletAddress") as string;
    if (query && query.trim() !== '') {
      router.push(`/wallets/${query.trim()}`);
    } else {
      alert("Please enter a wallet address.");
    }
  };

  const isVerified = Boolean(user?.emailVerified);
  const showSearch = isAuthenticated && isVerified;

  const handleResendVerification = async () => {
    const success = await requestEmailVerification();
    if (success) {
      toast.success('Verification email sent');
    } else {
      toast.error('Unable to send verification email right now. Please try again.');
    }
  };

  return (
    <div className="w-full min-h-full text-white animated-gradient">
      {/* Preload the dashboard preview image only on homepage */}
      <link rel="preload" href="/preview/dashboard-preview.png" as="image" type="image/png" />
      
      <header className="container mx-auto max-w-5xl h-16 flex justify-end items-center px-4 sm:px-6 lg:px-8">
        <AuthHeader onShowAuthModal={() => setShowAuthModal(true)} />
      </header>

      <main className="container mx-auto max-w-5xl text-center flex flex-col h-full px-4 sm:px-6 lg:px-8 pb-12 sm:pb-16">
        <div className="w-full flex-grow">
          <h1 className="text-4xl sm:text-5xl font-bold mb-3 text-slate-50">
            Solana Wallet Intel Dashboard
          </h1>
          <p className="text-slate-400 text-base sm:text-lg mb-4">
            Analyze wallet behavior. Decode strategies. Profit smarter.
          </p>
          <p className="max-w-2xl mx-auto text-slate-400/80 mb-10">
            Institutional-grade tools to analyze any Solana wallet. Track PNL, uncover patterns, and get historical insights.
          </p>

          {!isAuthenticated && (
            <div className="flex flex-col sm:flex-row justify-center gap-4 mt-8">
              <Button onClick={() => setShowAuthModal(true)} size="lg" className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700">
                Get Started
              </Button>
              <Button asChild variant="outline" size="lg" className="w-full sm:w-auto border-slate-600 hover:border-slate-400">
                <Link href="/help">View documentation</Link>
              </Button>
            </div>
          )}

          {isAuthenticated && !isVerified && (
            <div className="max-w-2xl mx-auto mt-8 mb-10 rounded-xl border border-slate-800 bg-slate-900/70 p-5 text-left shadow-sm">
              <h2 className="text-lg font-semibold text-slate-100 mb-1">Verify your email to run analyses</h2>
              <p className="text-sm text-slate-400 mb-4">
                A verification link was sent to <span className="font-medium text-slate-200">{user?.email}</span>. We'll unlock analysis tools once your email is confirmed.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button onClick={handleResendVerification} size="sm">
                  Resend verification email
                </Button>
                <Button asChild variant="outline" size="sm" className="border-slate-700 text-slate-200 hover:bg-slate-800">
                  <Link href="/help">Need help?</Link>
                </Button>
              </div>
            </div>
          )}

          {showSearch && (
            <form onSubmit={handleSearch} className="max-w-xl mx-auto mb-6">
              <div className="relative">
                <SearchIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-slate-400" />
                <Input
                  id="walletAddress"
                  type="text"
                  name="walletAddress"
                  placeholder="Enter Solana Wallet Address to Analyze..."
                  className="w-full pl-10 pr-4 py-3 h-12 text-base rounded-md bg-slate-700 border-slate-600 placeholder-slate-400 focus:ring-2 focus:ring-blue-500 focus:ring-opacity-75 focus:border-blue-500 transition-shadow duration-200 ease-in-out shadow-sm hover:shadow-md focus:shadow-lg"
                  required
                />
              </div>
              <Button type="submit" className="mt-4 w-full sm:w-auto bg-blue-600 hover:bg-blue-700 h-11 text-base rounded-md">
                Analyze Wallet
              </Button>
            </form>
          )}

          <section className="mt-16 text-left">
            <h2 className="text-2xl font-semibold text-slate-100 mb-6 text-center">Unlock Powerful Insights</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <FeatureCard 
                icon={<TrendingUpIcon className="h-8 w-8 text-green-400 mb-2" />}
                title="In-Depth PNL Analysis"
                description="Go beyond surface-level stats. Track realized/unrealized gains, win rates, and total ROI across all trades."
              />
              <FeatureCard 
                icon={<UsersIcon className="h-8 w-8 text-purple-400 mb-2" />}
                title="Behavioral Pattern Recognition"
                description="Automatically identify wallet strategies. Is it a sniper bot, an airdrop farmer, or a long-term holder?"
              />
              <FeatureCard 
                icon={<ActivityIcon className="h-8 w-8 text-blue-400 mb-2" />}
                title="Comprehensive Wallet History"
                description="Get a complete, readable history of every token purchase, sale, and transfer for any wallet."
              />
            </div>
          </section>

          <section className="mt-16 text-left">
            <h2 className="text-xl font-semibold text-slate-100 mb-2 flex items-center">
              <ListIcon className="h-5 w-5 mr-2 text-slate-400"/>
              Featured Wallets
            </h2>
            <p className="text-center text-sm text-slate-500 mb-4">Jump into an analysis with one of our curated wallets.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
              {FEATURED_WALLETS.map(wallet => (
                <Link key={wallet.address} href={`/wallets/${wallet.address}`} className="block group">
                  <div className="p-4 bg-slate-800/70 rounded-lg shadow-lg border border-slate-700 hover:border-blue-500/80 transition-all duration-300 h-full flex flex-col justify-between hover:shadow-xl hover:shadow-blue-500/20 bg-gradient-to-br from-slate-800 to-slate-900 hover:-translate-y-1">
                    <div className="flex justify-between items-start">
                      <p className="text-base text-slate-100 font-semibold group-hover:text-blue-400 transition-colors" title={wallet.name}>{wallet.name}</p>
                      {wallet.suggested && <Badge className="bg-green-700 text-green-100 text-xs border-green-600">Suggested</Badge>}
                    </div>
                    <p className="text-xs text-slate-400 mt-2 text-left">{wallet.description}</p>
                    <div className="flex justify-between items-end mt-3">
                      <p className="font-mono text-xs text-slate-500 truncate" title={wallet.address}>{wallet.address}</p>
                      <ChevronRightIcon className="h-5 w-5 text-slate-600 group-hover:text-blue-400 transition-all duration-300 transform group-hover:translate-x-1" />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>

          <section className="mt-20 text-left">
            <div className="p-8 bg-slate-900/70 rounded-2xl border border-slate-700 shadow-xl text-center max-w-4xl mx-auto">
              <h2 className="text-2xl font-semibold text-slate-100 mb-3">Access the full dashboard</h2>
              <p className="text-slate-400 text-base mb-8">
                Create an account to unlock unlimited wallet analysis, behavioral insights, and historical performance data.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Button onClick={() => setShowAuthModal(true)} size="lg" className="w-full sm:w-auto bg-purple-600 hover:bg-purple-700">
                  Create Account
                </Button>
                <Button asChild variant="outline" size="lg" className="w-full sm:w-auto border-slate-600 hover:border-slate-400">
                  <Link href="/help">Learn more</Link>
                </Button>
              </div>
            </div>
          </section>

          <section className="mt-20 text-center">
              <h2 className="text-2xl font-semibold text-slate-100 mb-2">See It In Action</h2>
              <p className="text-slate-400 text-base sm:text-lg mb-8 max-w-2xl mx-auto">
                Our dashboard uncovers hidden patterns, PNL, and behavioral traits for any Solana wallet.
              </p>
              <div className="max-w-5xl mx-auto relative group">
                <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg blur-lg opacity-40 group-hover:opacity-75 transition duration-500"></div>
                <Image 
                  src="/preview/dashboard-preview.png" 
                  alt="Dashboard Preview" 
                  width={1024}
                  height={576}
                  className="rounded-md shadow-xl relative w-full h-auto"
                  quality={85}
                  placeholder="blur"
                  blurDataURL="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAIAAoDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAhEAACAQMDBQAAAAAAAAAAAAABAgMABAUGIWGRkqGx0f/EABUBAQEAAAAAAAAAAAAAAAAAAAMF/8QAGhEAAgIDAAAAAAAAAAAAAAAAAAECEgMRkf/aAAwDAQACEQMRAD8AltJagyeH0AthI5xdrLcNM91BF5pX2HaH9bcfaSXWGaRmknyJckliyjqTzSlT54b6bk+h0R//2Q=="
                />
              </div>
          </section>
        </div>
        
        <footer className="w-full mt-auto pt-16 pb-8 text-sm text-slate-500">
          <p>&copy; {new Date().getFullYear()} Sova Intel. All rights reserved.</p>
          <p className="mt-1">
            <Link href="/help" className="hover:text-slate-300 underline">Help & Documentation</Link>
            {' | '}
            <Link href="/settings" className="hover:text-slate-300 underline">Settings</Link>
          </p>
        </footer>
      </main>
      
      {/* Auth Modal */}
      <AuthModal 
        open={showAuthModal} 
        onOpenChange={setShowAuthModal}
        onSuccess={() => {
          setShowAuthModal(false);
        }}
      />
    </div>
  );
}

interface FeatureCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
}

function FeatureCard({ icon, title, description }: FeatureCardProps) {
  return (
    <div className="p-6 bg-slate-800 rounded-lg shadow-lg border border-slate-700 hover:border-slate-600 transition-all duration-300 hover:-translate-y-1 hover:scale-105">
      <div className="flex justify-center md:justify-start">{icon}</div>
      <h3 className="text-xl font-semibold mb-2 mt-1 text-slate-100">{title}</h3>
      <p className="text-slate-300 text-sm">{description}</p>
    </div>
  );
}
