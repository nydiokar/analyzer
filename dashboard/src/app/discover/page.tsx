'use client';

import { AppShell } from '@/components/layout/AppShell';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { ChevronRightIcon, Compass } from 'lucide-react';

const FEATURED_WALLETS = [
  { address: 'DNfuF1L62WWyW3pNakVkyGGFzVVhj4Yr52jSmdTyeBHm', name: 'Gake', suggested: true, description: "High-volume trader, risky profile" },
  { address: '96sErVjEN7LNJ6Uvj63bdRWZxNuBngj56fnT9biHLKBf', name: 'Orange', suggested: true, description: "Momentum strategy, mid-cap bias" },
  { address: 'Hnnw2hAgPgGiFKouRWvM3fSk3HnYgRv4Xq1PjUEBEuWM', name: 'SmartMoney', suggested: false, description: "Frequent sniping, low win rate" },
];

export default function DiscoverPage() {
  return (
    <AppShell>
      <div className="container max-w-6xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="mb-12">
          <div className="flex items-center gap-3 mb-4">
            <Compass className="h-8 w-8 text-blue-500" />
            <h1 className="text-4xl font-bold">Discover</h1>
          </div>
          <p className="text-lg text-muted-foreground">
            Explore featured wallets and discover trading patterns on Solana.
          </p>
        </div>

        {/* Featured Wallets */}
        <section>
          <h2 className="text-2xl font-semibold mb-6">Featured Wallets</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURED_WALLETS.map(wallet => (
              <Link
                key={wallet.address}
                href={`/wallets/${wallet.address}`}
                className="block group"
              >
                <Card className="p-6 rounded-xl hover:shadow-hover transition-shadow h-full">
                  <div className="flex justify-between items-start mb-3">
                    <p className="text-lg font-semibold group-hover:text-blue-500 transition-colors">
                      {wallet.name}
                    </p>
                    {wallet.suggested && (
                      <Badge className="bg-green-700 text-green-100 text-xs border-green-600">
                        Suggested
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mb-4">{wallet.description}</p>
                  <div className="flex justify-between items-center">
                    <p className="font-mono text-xs text-muted-foreground truncate" title={wallet.address}>
                      {wallet.address.substring(0, 8)}...{wallet.address.substring(wallet.address.length - 6)}
                    </p>
                    <ChevronRightIcon className="h-5 w-5 text-muted-foreground group-hover:text-blue-500 group-hover:translate-x-1 transition-all" />
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </section>

        {/* Coming Soon Section */}
        <section className="mt-16">
          <Card className="p-12 rounded-xl border-dashed text-center">
            <div className="max-w-md mx-auto">
              <Compass className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-xl font-semibold mb-2">More Features Coming Soon</h3>
              <p className="text-sm text-muted-foreground">
                Token search, wallet rankings, trending strategies, and more discovery tools are on the way.
              </p>
            </div>
          </Card>
        </section>
      </div>
    </AppShell>
  );
}
