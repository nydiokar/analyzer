'use client';

import { AppShell } from '@/components/layout/AppShell';
import { Card } from '@/components/ui/card';
import { Bookmark } from 'lucide-react';

export default function TrackersPage() {
  return (
    <AppShell>
      <div className="container max-w-6xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="mb-12">
          <div className="flex items-center gap-3 mb-4">
            <Bookmark className="h-8 w-8 text-purple-500" />
            <h1 className="text-4xl font-bold">My Wallets</h1>
          </div>
          <p className="text-lg text-muted-foreground">
            Track your favorite Solana wallets and monitor their performance.
          </p>
        </div>

        {/* Coming Soon Section */}
        <section>
          <Card className="p-12 rounded-xl border-dashed text-center">
            <div className="max-w-md mx-auto">
              <Bookmark className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-xl font-semibold mb-2">Tracked Wallets Coming Soon</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Save your favorite wallets here for quick access. View aggregated stats, track changes, and get notified of new activity.
              </p>
              <p className="text-xs text-muted-foreground">
                For now, use the search bar to analyze any wallet.
              </p>
            </div>
          </Card>
        </section>
      </div>
    </AppShell>
  );
}
