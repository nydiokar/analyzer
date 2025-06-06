'use client';

// import type { Metadata } from 'next'; // Metadata type can be removed if not used elsewhere in this file
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SearchIcon, KeyRoundIcon, ListIcon, UsersIcon, TrendingUpIcon, ActivityIcon, CopyIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useApiKeyStore } from '@/store/api-key-store';
// It's better to import WalletSearch if it can be made context-agnostic
// For now, we'll create a simple search input placeholder
// import { WalletSearch } from \'@/components/sidebar/WalletSearch\';

// These wallets are for demonstration purposes and can be accessed without an API key.
// This list should ideally match the one defined in the backend's ApiKeyAuthGuard.
const DEMO_WALLETS = [
  { address: 'DNfuF1L62WWyW3pNakVkyGGFzVVhj4Yr52jSmdTyeBHm', name: 'Gake' },
  { address: '96sErVjEN7LNJ6Uvj63bdRWZxNuBngj56fnT9biHLKBf', name: 'Orange' },
  { address: 'Hnnw2hAgPgGiFKouRWvM3fSk3HnYgRv4Xq1PjUEBEuWM', name: 'SmartMoney' },
];


export default function Home() {
  const router = useRouter();
  const { apiKey, isInitialized } = useApiKeyStore();

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

  return (
    <div className="w-full min-h-full bg-gradient-to-br from-slate-900 via-gray-800 to-slate-900 text-white">
      <main className="container mx-auto max-w-5xl text-center flex flex-col h-full py-12 sm:py-16">
        <div className="w-full flex-grow">
          <h1 className="text-3xl sm:text-4xl font-bold mb-2 text-slate-50">
            Solana Wallet Intel Dashboard
          </h1>
          <p className="text-slate-400 text-base sm:text-lg mb-10">
            Analyze wallet behavior. Decode strategies. Profit smarter.
          </p>

          <form onSubmit={handleSearch} className="max-w-xl mx-auto mb-6">
            <div className="relative">
              <SearchIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-slate-400" />
              <Input
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

          {/* API Key Management Section */}
          {isInitialized && (
            <section className="max-w-xl mx-auto mb-12 p-4 bg-slate-800/50 rounded-lg border border-slate-700">
              <h2 className="text-lg font-semibold text-slate-100 mb-3 flex items-center justify-center">
                <KeyRoundIcon className="h-5 w-5 mr-2 text-slate-400"/>
                API Key Status
              </h2>
              {apiKey ? (
                <div className="text-center">
                  <p className="text-green-400">API Key is set and active.</p>
                  <p className="text-xs text-slate-400 mt-1">You can manage your key in the settings.</p>
                  <Button asChild variant="secondary" size="sm" className="mt-3">
                    <Link href="/settings">Go to Settings</Link>
                  </Button>
                </div>
              ) : (
                <div>
                  <p className="text-sm text-slate-400 mb-3">Enter an API Key in settings for full access to analyze any wallet.</p>
                  <Button asChild variant="default" size="sm">
                    <Link href="/settings">Go to Settings</Link>
                  </Button>
                </div>
              )}
            </section>
          )}
          
          {/* Explore Demo Wallets Section */}
          <section className="mt-12 text-left">
            <h2 className="text-xl font-semibold text-slate-100 mb-4 flex items-center">
              <ListIcon className="h-5 w-5 mr-2 text-slate-400"/>
              Explore a Wallet
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {DEMO_WALLETS.map(wallet => (
                <Link key={wallet.address} href={`/wallets/${wallet.address}`} className="block group">
                  <div className="p-4 bg-slate-800 rounded-md shadow hover:bg-slate-700 transition-colors h-full flex flex-col justify-between">
                    <div>
                      <p className="text-sm text-slate-300 font-semibold group-hover:text-blue-400 transition-colors truncate" title={wallet.name}>{wallet.name}</p>
                    </div>
                    <p className="font-mono text-xs text-slate-500 mt-2 self-end truncate">{wallet.address}</p>
                  </div>
                </Link>
              ))}
            </div>
          </section>

          {/* Kept for visual appeal, can be removed or powered by real data later */}
          <section className="mt-16 text-left">
            <h2 className="text-2xl font-semibold text-slate-100 mb-6">Live Market Insights (Mock Data)</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="p-6 bg-slate-800 rounded-md shadow">
                <div className="flex items-center mb-3">
                  <TrendingUpIcon className="h-7 w-7 text-green-400 mr-3" />
                  <h3 className="text-lg font-semibold text-slate-100">Top Tokens by ROI (7d)</h3>
                </div>
                <ul className="space-y-1 text-sm">
                  <li><span className="font-medium text-slate-200">WIF</span>: <span className="text-green-400">+125.5%</span></li>
                  <li><span className="font-medium text-slate-200">JUP</span>: <span className="text-green-400">+88.0%</span></li>
                  <li><span className="font-medium text-slate-200">BONK</span>: <span className="text-red-400">-15.2%</span></li>
                </ul>
              </div>
              <div className="p-6 bg-slate-800 rounded-md shadow">
                <div className="flex items-center mb-3">
                  <UsersIcon className="h-7 w-7 text-purple-400 mr-3" />
                  <h3 className="text-lg font-semibold text-slate-100">Recent Behaviors</h3>
                </div>
                <div className="space-y-2 text-sm">
                  <p><span className="font-mono text-slate-400">abc...</span> <span className="text-purple-300">Sniper Bot</span></p>
                  <p><span className="font-mono text-slate-400">def...</span> <span className="text-purple-300">Fresh Wallet</span></p>
                  <p><span className="font-mono text-slate-400">ghi...</span> <span className="text-purple-300">Airdrop Farmer</span></p>
                </div>
              </div>
              <div className="p-6 bg-slate-800 rounded-md shadow">
                <div className="flex items-center mb-3">
                  <ActivityIcon className="h-7 w-7 text-blue-400 mr-3" />
                  <h3 className="text-lg font-semibold text-slate-100">Market Pulse</h3>
                </div>
                <ul className="space-y-1 text-sm">
                  <li>Avg. Hold Time: <span className="text-slate-200">4.2 hours</span></li>
                  <li>Median Win Rate: <span className="text-slate-200">58%</span></li>
                  <li>Top Mover (24h): <span className="text-slate-200">WIF (+18%)</span></li>
                </ul>
              </div>
            </div>
          </section>
        </div>
        
        <footer className="w-full mt-auto pt-16 pb-8 text-sm text-slate-500">
          <p>&copy; {new Date().getFullYear()} Wallet Analyzer. All rights reserved.</p>
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
    <div className="p-6 bg-slate-800 rounded-lg shadow-lg border border-slate-700 hover:border-slate-600 transition-colors">
      <div className="flex justify-center md:justify-start">{icon}</div>
      <h3 className="text-xl font-semibold mb-2 mt-1 text-slate-100">{title}</h3>
      <p className="text-slate-300 text-sm">{description}</p>
    </div>
  );
}
