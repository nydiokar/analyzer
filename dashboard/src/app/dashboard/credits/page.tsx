'use client';

import React, { useRef } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { useCredits } from '@/hooks/useCredits';
import { useAuth } from '@/hooks/useAuth';
import { useCreditPacks } from '@/hooks/useCreditPacks';
import { useUIStore } from '@/store/ui-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Wallet,
  ArrowUpCircle,
  ArrowDownCircle,
  Gift,
  ShoppingCart,
  Coins,
  Receipt,
  Zap,
  Activity,
  Check,
  Bot,
} from 'lucide-react';
import type { CreditTransaction, CreditPack } from '@/types/api';

// ── helpers ────────────────────────────────────────────────────────────────────

function getTxConfig(tx: CreditTransaction): { label: string; icon: React.ReactNode; color: string } {
  if (tx.delta > 0) {
    if (tx.reason === 'signup_bonus') {
      return { label: 'Signup Bonus', icon: <Gift className="h-4 w-4" />, color: 'text-blue-400' };
    }
    if (tx.reason === 'x402_payment') {
      return { label: 'Agent Payment (X402)', icon: <Zap className="h-4 w-4" />, color: 'text-purple-400' };
    }
    return { label: 'Credit Purchase', icon: <ArrowUpCircle className="h-4 w-4" />, color: 'text-green-400' };
  }
  if (tx.reason.startsWith('refund:')) {
    return { label: 'Refund', icon: <ArrowUpCircle className="h-4 w-4" />, color: 'text-yellow-400' };
  }
  const labelMap: Record<string, string> = {
    'endpoint:AnalysesController.queueHolderProfilesAnalysis': 'Holder Profiles',
    'endpoint:AnalysesController.queueSimilarityAnalysis': 'Similarity Analysis',
    'endpoint:AnalysesController.queueDashboardWalletAnalysis': 'Dashboard Analysis',
    'endpoint:AnalysesController.queueWalletHolderProfile': 'Wallet Profile',
  };
  const label = labelMap[tx.reason] ?? 'Analysis';
  return { label, icon: <ArrowDownCircle className="h-4 w-4" />, color: 'text-red-400' };
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ── pack card ──────────────────────────────────────────────────────────────────

// Reference table (left column) — shows each operation individually for clarity
const OPERATION_COSTS = [
  { label: 'Dashboard Analysis', cost: 5 },
  { label: 'Holder Profiles + Similarity', cost: 30 },
  { label: 'Similarity (standalone)', cost: 20 },
] as const;

// Pack card breakdown — collapsed to meaningful "runs" a user can do with this pack
const PACK_BREAKDOWN_COSTS = [
  { label: 'Dashboard Analyses', cost: 5 },
  { label: 'Holder Profiles + Similarity runs', cost: 30 },
  { label: 'Standalone Similarity runs', cost: 20 },
] as const;

function PackCard({
  pack,
  highlight,
  onSelect,
}: {
  pack: CreditPack;
  highlight: boolean;
  onSelect: () => void;
}) {
  const usdPerCredit = (pack.priceUsdc / pack.credits).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');

  return (
    <div className={`relative rounded-xl border bg-card p-6 flex flex-col gap-5 transition-colors ${
      highlight
        ? 'border-blue-500 shadow-[0_0_0_1px_theme(colors.blue.500)]'
        : 'border-border hover:border-border/80'
    }`}>
      {highlight && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-xs font-semibold px-3 py-0.5 rounded-full">
          Most Popular
        </span>
      )}

      {/* Name + price */}
      <div>
        <p className="font-semibold text-foreground text-lg">{pack.name}</p>
        <div className="flex items-baseline gap-1.5 mt-2">
          <span className="text-4xl font-bold text-foreground">${pack.priceUsdc}</span>
          <span className="text-sm text-muted-foreground">USDC</span>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          {pack.credits.toLocaleString()} credits · ${usdPerCredit} each
        </p>
      </div>

      {/* What you get */}
      <ul className="space-y-2 flex-1">
        {PACK_BREAKDOWN_COSTS.map(({ label, cost }) => (
          <li key={label} className="flex items-center gap-2 text-sm text-muted-foreground">
            <Check className="h-3.5 w-3.5 text-green-500 shrink-0" />
            <span>
              <span className="font-semibold text-foreground">
                {Math.floor(pack.credits / cost).toLocaleString()}×
              </span>
              {' '}{label}
            </span>
          </li>
        ))}
      </ul>

      <Button
        onClick={onSelect}
        className={`w-full gap-2 ${highlight ? 'bg-blue-600 hover:bg-blue-700 text-white' : ''}`}
        variant={highlight ? 'default' : 'outline'}
      >
        <ShoppingCart className="h-4 w-4" />
        Select {pack.name}
      </Button>
    </div>
  );
}

// ── page ───────────────────────────────────────────────────────────────────────

export default function CreditsPage() {
  const { isAuthenticated } = useAuth();
  const { setShowAuthModal } = useUIStore();
  const { balance, transactions, isLoading } = useCredits();
  const { packs, isLoading: packsLoading } = useCreditPacks();
  const router = useRouter();
  const packsRef = useRef<HTMLDivElement>(null);

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

  const handleScrollToPacks = () => {
    packsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const agentTxs = transactions.filter((tx) => tx.reason === 'x402_payment');
  const agentCreditsSpent = agentTxs.reduce((sum, tx) => sum + Math.abs(tx.delta), 0);
  const agentUsdcSpent = +(agentCreditsSpent * 0.015).toFixed(3);

  const handleSelectPack = (pack: CreditPack) => {
    router.push(`/dashboard/credits/checkout/${pack.id}`);
  };

  // Highlight the middle pack (best value) — index 1 of 3
  const highlightIndex = packs.length === 3 ? 1 : -1;

  return (
    <AppShell>
      <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-8">

        {/* Page header */}
        <div className="flex items-center gap-2">
          <Coins className="h-5 w-5 text-blue-400" />
          <h1 className="text-xl font-semibold">Credits</h1>
        </div>

        {/* ── Top section: balance + history ── */}
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-5 items-start">

          {/* Left column */}
          <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">

            {/* Balance */}
            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Available Balance
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-1">
                {isLoading ? (
                  <Skeleton className="h-14 w-36" />
                ) : (
                  <p className="text-6xl font-bold tabular-nums leading-none">
                    {balance?.toLocaleString() ?? '—'}
                  </p>
                )}
                <p className="text-sm text-muted-foreground mt-2">credits</p>
              </CardContent>
            </Card>

            {/* Cost per operation — reference */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5" />
                  Cost per operation
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5 text-sm">
                {OPERATION_COSTS.map(({ label, cost }) => (
                  <div key={label} className="flex items-center justify-between">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-mono text-foreground">{cost} cr</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Agent usage (x402) — only shown when there's activity */}
            {!isLoading && agentTxs.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                    <Bot className="h-3.5 w-3.5 text-purple-400" />
                    Agent API Usage
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2.5 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Payments (last 20)</span>
                    <span className="font-mono text-foreground">{agentTxs.length}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Credits consumed</span>
                    <span className="font-mono text-foreground">{agentCreditsSpent.toLocaleString()} cr</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">USDC equivalent</span>
                    <span className="font-mono text-purple-400">${agentUsdcSpent}</span>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Top-up CTA — scrolls to packs, doesn't navigate */}
            <Button
              onClick={handleScrollToPacks}
              className="w-full gap-2 bg-blue-600 hover:bg-blue-700 text-white"
            >
              <ShoppingCart className="h-4 w-4" />
              Top Up Credits
            </Button>
          </div>

          {/* Right column: transaction history */}
          <Card className="min-h-[400px]">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5" />
                Transaction History
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-3">
                  {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
                </div>
              ) : transactions.length === 0 ? (
                <div className="flex flex-col items-center py-16 gap-3 text-muted-foreground">
                  <Receipt className="h-8 w-8 opacity-20" />
                  <p className="text-sm">No transactions yet</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {transactions.map((tx) => {
                    const config = getTxConfig(tx);
                    const isCredit = tx.delta > 0;
                    return (
                      <div key={tx.id} className="flex items-center justify-between py-3 gap-3">
                        <div className={`flex items-center gap-2 shrink-0 ${config.color}`}>
                          {config.icon}
                          <span className="text-sm font-medium text-foreground">{config.label}</span>
                        </div>
                        <span className="text-xs text-muted-foreground flex-1 text-right mr-2 truncate">
                          {formatDate(tx.createdAt)}
                        </span>
                        <span className={`font-mono font-semibold text-sm tabular-nums shrink-0 ${isCredit ? 'text-green-400' : 'text-red-400'}`}>
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

        {/* ── Pack selection — below the fold ── */}
        <div ref={packsRef} className="space-y-4 scroll-mt-6">
          <div>
            <h2 className="text-base font-semibold text-foreground">Top up your balance</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Pay once with USDC on Solana. Credits never expire.
            </p>
          </div>

          {packsLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-64 w-full rounded-xl" />)}
            </div>
          ) : packs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No credit packs available.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {packs.map((pack, i) => (
                <PackCard
                  key={pack.id}
                  pack={pack}
                  highlight={i === highlightIndex}
                  onSelect={() => handleSelectPack(pack)}
                />
              ))}
            </div>
          )}

          <p className="text-xs text-muted-foreground text-center pt-1">
            Phantom, Backpack, Solflare, or any Solana Pay compatible wallet accepted
          </p>
        </div>

      </div>
    </AppShell>
  );
}
