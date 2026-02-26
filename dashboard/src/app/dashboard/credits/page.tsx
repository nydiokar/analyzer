'use client';

import { useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { CreditPurchaseModal } from '@/components/credits/CreditPurchaseModal';
import { useCredits } from '@/hooks/useCredits';
import { useAuth } from '@/hooks/useAuth';
import { useUIStore } from '@/store/ui-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Wallet, ShoppingCart, ArrowUpCircle, ArrowDownCircle, Gift, Loader2 } from 'lucide-react';
import type { CreditTransaction } from '@/types/api';

/** Map backend `reason` prefix to display config */
function getTxConfig(tx: CreditTransaction): { label: string; icon: React.ReactNode; color: string } {
  if (tx.delta > 0) {
    if (tx.reason === 'signup_bonus') {
      return { label: 'Signup Bonus', icon: <Gift className="h-4 w-4" />, color: 'text-blue-400' };
    }
    return { label: 'Purchase', icon: <ArrowUpCircle className="h-4 w-4" />, color: 'text-green-400' };
  }
  return { label: 'Used', icon: <ArrowDownCircle className="h-4 w-4" />, color: 'text-red-400' };
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function CreditsPage() {
  const { isAuthenticated } = useAuth();
  const { setShowAuthModal } = useUIStore();
  const { balance, transactions, isLoading } = useCredits();
  const [modalOpen, setModalOpen] = useState(false);

  if (!isAuthenticated) {
    return (
      <AppShell>
        <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-4">
          <Wallet className="h-12 w-12 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Sign in to view your credits</h1>
          <p className="text-muted-foreground text-sm max-w-sm">
            Credits are used to access analysis features. Sign in to view your balance and purchase more.
          </p>
          <Button onClick={() => setShowAuthModal(true, 'manual')}>Sign In</Button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-6">
        {/* Balance card */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Wallet className="h-4 w-4" />
              Credit Balance
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-end justify-between">
            <div>
              {isLoading ? (
                <Skeleton className="h-12 w-32" />
              ) : (
                <p className="text-5xl font-bold tabular-nums">
                  {balance?.toLocaleString() ?? '—'}
                </p>
              )}
              <p className="text-sm text-muted-foreground mt-1">credits available</p>
            </div>
            <Button
              onClick={() => setModalOpen(true)}
              className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
            >
              <ShoppingCart className="h-4 w-4" />
              Buy Credits
            </Button>
          </CardContent>
        </Card>

        {/* Credit costs reference */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Credit Costs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Behavior Analysis</span>
                <Badge variant="outline">5 credits</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Dashboard Analysis</span>
                <Badge variant="outline">10 credits</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Similarity Analysis</span>
                <Badge variant="outline">100 credits</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Transaction ledger */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Transaction History</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : transactions.length === 0 ? (
              <div className="flex flex-col items-center py-8 gap-2 text-muted-foreground">
                <Loader2 className="h-6 w-6 opacity-30" />
                <p className="text-sm">No transactions yet</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {transactions.map((tx) => {
                  const config = getTxConfig(tx);
                  const isCredit = tx.delta > 0;
                  return (
                    <div key={tx.id} className="flex items-center justify-between py-3 gap-3">
                      <div className={`flex items-center gap-2 ${config.color}`}>
                        {config.icon}
                        <span className="text-sm font-medium text-foreground">{config.label}</span>
                      </div>
                      <span className="text-xs text-muted-foreground flex-1 text-right mr-4">
                        {formatDate(tx.createdAt)}
                      </span>
                      <span className={`font-mono font-semibold text-sm tabular-nums ${isCredit ? 'text-green-400' : 'text-red-400'}`}>
                        {isCredit ? '+' : ''}{tx.delta.toLocaleString()}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <CreditPurchaseModal open={modalOpen} onOpenChange={setModalOpen} />
    </AppShell>
  );
}
