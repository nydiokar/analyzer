'use client';

// import type { Metadata } from 'next'; // Metadata type can be removed if not used elsewhere in this file
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SearchIcon, EyeIcon, BarChartIcon, UsersIcon, ZapIcon, ClockIcon, TrendingUpIcon, ActivityIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
// It's better to import WalletSearch if it can be made context-agnostic
// For now, we'll create a simple search input placeholder
// import { WalletSearch } from \'@/components/sidebar/WalletSearch\';

// Mock data for Recently Analyzed Wallets -  Replace with actual data fetching (e.g., from localStorage or API)
const mockRecentWallets = [
  { id: '1', address: 'Fm162SYqc7Vwmn6pLbxoXRkR1vFtvdP9L9dqhqyT4HmU', pnl: 1250.75, behavior: 'Active Trader' },
  { id: '2', address: 'ERgtHKpakjFBtcgrh4abzpqFCQKsMdM7QXdE1sfafrWU', pnl: -50.20, behavior: 'NFT Minter' },
  { id: '3', address: 'sFRpBSro9JJzZbQmrjNqvfUMKypdTfJumont9decDuV', pnl: 800.00, behavior: 'Yield Farmer' },
];
// Fallback featured wallet - Replace with actual anonymized data fetching
const mockFeaturedWallet = {
  address: 'FeaTuredWa11etAn0nymizedDataAddr3ssabc123',
  pnl: 2345.67,
  behavior: 'DeFi Power User',
};

export default function Home() {
  const router = useRouter();
  // Example state for recent wallets - in a real app, this would come from localStorage or an API call
  const recentWallets = mockRecentWallets; // Using mock data for now
  // const recentWallets: typeof mockRecentWallets = []; // Use this line to test empty state/fallback

  const handleSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const query = formData.get("walletAddress") as string;
    if (query && query.trim() !== '') {
      router.push(`/wallets/${query.trim()}`);
    } else {
      // Optional: Add some user feedback if the input is empty
      alert("Please enter a wallet address.");
    }
  };

  return (
    <div className="w-full min-h-full bg-gradient-to-br from-slate-900 via-gray-800 to-slate-900 text-white">
      <main className="container mx-auto max-w-5xl text-center flex flex-col h-full py-12 sm:py-16">
        {/* Content wrapper div to allow footer to be pushed down by flex-grow on this div */}
        <div className="w-full flex-grow">
          <h1 className="text-3xl sm:text-4xl font-bold mb-2 text-slate-50">
            Solana Wallet Intel Dashboard
          </h1>
          <p className="text-slate-400 text-base sm:text-lg mb-10">
            Analyze wallet behavior. Decode strategies. Profit smarter.
          </p>

          <form onSubmit={handleSearch} className="max-w-xl mx-auto mb-12">
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
          
          <div className="flex flex-wrap gap-2 mt-7 justify-center mb-0.5">
            <Link href="/wallets/sample-portfolio">
              <Button variant="secondary" className="rounded-md bg-slate-700 hover:bg-slate-600 text-slate-200">Demo Portfolio</Button>
            </Link>
            <Link href="/compare">
              <Button variant="secondary" className="rounded-md bg-slate-700 hover:bg-slate-600 text-slate-200">Compare Wallets</Button>
            </Link>
            <Link href="/leaderboard">
              <Button variant="secondary" className="rounded-md bg-slate-700 hover:bg-slate-600 text-slate-200">Leaderboard</Button>
            </Link>
          </div>
        </div>

        {/* Step 1: Context-Aware Previews - Recently Analyzed Wallets */}
        {recentWallets.length > 0 ? (
          <section className="mt-12 text-left">
            <h2 className="text-xl font-semibold text-slate-100 mb-4">Recently Analyzed Wallets</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {recentWallets.map(wallet => (
                <Link key={wallet.id} href={`/wallets/${wallet.address}`} className="block group">
                  <div className="p-4 bg-slate-800 rounded-md shadow hover:bg-slate-700 transition-colors h-full flex flex-col justify-between">
                    <div>
                      <p className="text-sm text-slate-300 font-semibold group-hover:text-blue-400 transition-colors truncate" title={wallet.address}>{wallet.address.substring(0,12)}...{wallet.address.substring(wallet.address.length -4)}</p>
                      <p className={`text-sm ${wallet.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>PNL: {wallet.pnl.toFixed(2)} SOL</p>
                      <p className="text-xs text-slate-400">Behavior: {wallet.behavior}</p>
                    </div>
                    <p className="font-mono text-xs text-slate-500 mt-2 self-end truncate">{wallet.address}</p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ) : (
          <section className="mt-12 text-left">
            <h2 className="text-xl font-semibold text-slate-100 mb-4">Featured Wallet of the Day</h2>
            <Link href={`/wallets/${mockFeaturedWallet.address}`} className="block group">
              <div className="p-4 bg-slate-800 rounded-md shadow hover:bg-slate-700 transition-colors">
                <p className="text-sm text-slate-300 font-semibold group-hover:text-blue-400 transition-colors truncate" title={mockFeaturedWallet.address}>{mockFeaturedWallet.address.substring(0,12)}...{mockFeaturedWallet.address.substring(mockFeaturedWallet.address.length -4)}</p>
                <p className={`text-sm ${mockFeaturedWallet.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>PNL: {mockFeaturedWallet.pnl.toFixed(2)} SOL</p>
                <p className="text-xs text-slate-400">Behavior: {mockFeaturedWallet.behavior}</p>
                <p className="font-mono text-xs text-slate-500 mt-2 self-end truncate">{mockFeaturedWallet.address}</p>
              </div>
            </Link>
          </section>
        )}

        {/* Step 2: Enhanced Function Tiles */}
        <section className="mt-16 text-left">
          <h2 className="text-2xl font-semibold text-slate-100 mb-6">Live Market Insights</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Top Tokens by ROI */}
            <div className="p-6 bg-slate-800 rounded-md shadow">
              <div className="flex items-center mb-3">
                <TrendingUpIcon className="h-7 w-7 text-green-400 mr-3" />
                <h3 className="text-lg font-semibold text-slate-100">Top Tokens by ROI (7d)</h3>
              </div>
              <ul className="space-y-1 text-sm">
                <li><span className="font-medium text-slate-200">SOLANA</span>: <span className="text-green-400">+125.5%</span></li>
                <li><span className="font-medium text-slate-200">USDCet</span>: <span className="text-green-400">+88.0%</span></li>
                <li><span className="font-medium text-slate-200">BONK</span>: <span className="text-red-400">-15.2%</span></li>
              </ul>
              <p className="text-xs text-slate-500 mt-3">Mock data. Real data soon.</p>
            </div>
            {/* Live Behavior Examples */}
            <div className="p-6 bg-slate-800 rounded-md shadow">
              <div className="flex items-center mb-3">
                <UsersIcon className="h-7 w-7 text-purple-400 mr-3" />
                <h3 className="text-lg font-semibold text-slate-100">Recent Behaviors</h3>
              </div>
              <div className="space-y-2 text-sm">
                <p><span className="font-mono text-slate-400">abc...xyz</span> <span className="text-purple-300">Sniper Bot</span></p>
                <p><span className="font-mono text-slate-400">def...uvw</span> <span className="text-purple-300">Fresh Wallet</span></p>
                <p><span className="font-mono text-slate-400">ghi...123</span> <span className="text-purple-300">Airdrop Farmer</span></p>
              </div>
              <p className="text-xs text-slate-500 mt-3">Mock data examples.</p>
            </div>
            {/* Market Pulse */}
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
              <p className="text-xs text-slate-500 mt-3">Mock data. Real data soon.</p>
            </div>
          </div>
        </section>
        
        <footer className="w-full mt-auto pt-16 pb-8 text-sm text-slate-500"> {/* Increased pt-16 */}
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
