'use client';

// import type { Metadata } from 'next'; // Metadata type can be removed if not used elsewhere in this file
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SearchIcon, KeyRoundIcon, ListIcon, UsersIcon, TrendingUpIcon, ActivityIcon, CopyIcon, ChevronRightIcon, CheckIcon, SettingsIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useApiKeyStore } from '@/store/api-key-store';
import Image from 'next/image';
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
// It's better to import WalletSearch if it can be made context-agnostic
// For now, we'll create a simple search input placeholder
// import { WalletSearch } from \'@/components/sidebar/WalletSearch\';

function StatusIndicator({ isDemo }: { isDemo: boolean }) {
  const tooltipContent = isDemo 
    ? "Using demo mode. Click to change key for unrestricted analysis." 
    : "Using your key for unrestricted analysis.";

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Link href="/settings" className="flex items-center gap-3 group">
            <div className="text-right">
              <p className="text-sm font-medium text-slate-200">{isDemo ? 'Demo Mode' : 'Full Access'}</p>
              <p className="text-xs text-slate-400 group-hover:text-blue-400 transition-colors"></p>
            </div>
            <SettingsIcon className={`h-5 w-5 transition-all duration-300 group-hover:rotate-90 ${isDemo ? 'text-blue-400' : 'text-green-400'}`} />
          </Link>
        </TooltipTrigger>
        <TooltipContent>
          <p>{tooltipContent}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

// These wallets are for demonstration purposes and can be accessed without an API key.
// This list should ideally match the one defined in the backend's ApiKeyAuthGuard.
const DEMO_WALLETS = [
  { address: 'DNfuF1L62WWyW3pNakVkyGGFzVVhj4Yr52jSmdTyeBHm', name: 'Gake', suggested: true, description: "High-volume trader, risky profile" },
  { address: '96sErVjEN7LNJ6Uvj63bdRWZxNuBngj56fnT9biHLKBf', name: 'Orange', suggested: true, description: "Momentum strategy, mid-cap bias" },
  { address: 'Hnnw2hAgPgGiFKouRWvM3fSk3HnYgRv4Xq1PjUEBEuWM', name: 'SmartMoney', suggested: false, description: "Frequent sniping, low win rate" },
];


export default function Home() {
  const router = useRouter();
  const { apiKey, isInitialized, isDemo, setDemoMode } = useApiKeyStore();

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

  const useDemoKey = async () => {
    await setDemoMode();
  };

  const showSearch = isInitialized && apiKey && !isDemo;

  return (
    <div className="w-full min-h-full text-white animated-gradient">
      {/* Preload the dashboard preview image only on homepage */}
      <link rel="preload" href="/preview/dashboard-preview.png" as="image" type="image/png" />
      
      <header className="container mx-auto max-w-5xl h-16 flex justify-end items-center px-4 sm:px-6 lg:px-8">
          {isInitialized && apiKey && <StatusIndicator isDemo={isDemo} />}
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

          {isInitialized && !apiKey && (
            <div className="flex flex-col sm:flex-row justify-center gap-4 mt-8">
              <Button onClick={useDemoKey} size="lg" className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700">
                Try Demo Mode
              </Button>
              <Button asChild variant="outline" size="lg" className="w-full sm:w-auto border-slate-600 hover:border-slate-400">
                <Link href="/settings">Use Key</Link>
              </Button>
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
              Explore a Wallet
            </h2>
            <p className="text-center text-sm text-slate-500 mb-4">Choose a wallet to start exploring</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
              {DEMO_WALLETS.map(wallet => (
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
            <h2 className="text-2xl font-semibold text-slate-100 mb-8 text-center">Access the Dashboard</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
              {/* Demo Card */}
              <div className="p-6 bg-slate-800/60 rounded-lg shadow-lg border border-slate-700">
                <h3 className="text-xl font-semibold text-blue-400 mb-4">Demo Mode</h3>
                <p className="text-sm text-slate-400 mb-6">Get a feel for our platform with a curated experience.</p>
                <ul className="space-y-3">
                  <li className="flex items-center"><CheckIcon className="h-5 w-5 text-green-500 mr-3" /><span>Access to 3 Demo Wallets</span></li>
                  <li className="flex items-center"><CheckIcon className="h-5 w-5 text-green-500 mr-3" /><span>Full PNL and ROI Analysis</span></li>
                  <li className="flex items-center"><CheckIcon className="h-5 w-5 text-green-500 mr-3" /><span>Behavioral Pattern Recognition</span></li>
                </ul>
                <Button onClick={async () => await setDemoMode()} variant="secondary" className="w-full mt-8">
                  Start Demo
                </Button>
              </div>
              {/* Full Access Card */}
              <div className="p-6 bg-slate-800 rounded-lg shadow-lg border-2 border-purple-500 relative">
                 <div className="absolute top-0 right-4 -mt-3">
                    <Badge className="bg-purple-600 text-purple-100 text-xs border-purple-500">Full Power</Badge>
                  </div>
                <h3 className="text-xl font-semibold text-purple-400 mb-4">Full Access</h3>
                <p className="text-sm text-slate-400 mb-6">Unlock unlimited analysis on any Solana wallet.</p>
                <ul className="space-y-3">
                  <li className="flex items-center"><CheckIcon className="h-5 w-5 text-green-500 mr-3" /><span>Analyze Any Wallet Address</span></li>
                  <li className="flex items-center"><CheckIcon className="h-5 w-5 text-green-500 mr-3" /><span>Unlimited Searches</span></li>
                  <li className="flex items-center"><CheckIcon className="h-5 w-5 text-green-500 mr-3" /><span>Save and Track Favorite Wallets</span></li>
                  <li className="flex items-center"><CheckIcon className="h-5 w-5 text-green-500 mr-3" /><span>Priority Access to New Features</span></li>
                </ul>
                <Button asChild variant="default" className="w-full mt-8 bg-purple-600 hover:bg-purple-700">
                  <Link href="/settings">Use Your Key</Link>
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
