'use client';

import React, { useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { useCredits } from '@/hooks/useCredits';
import { useAuth } from '@/hooks/useAuth';
import { useCreditPacks } from '@/hooks/useCreditPacks';
import { useUIStore } from '@/store/ui-store';
import EChartComponent, { ECOption } from '@/components/charts/EChartComponent';
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
import type { CreditTransaction, CreditPack, CreditUsageSummaryItem } from '@/types/api';

// ── helpers ────────────────────────────────────────────────────────────────────

function formatEndpointReason(reason: string): string {
  const endpointLabelMap: Record<string, string> = {
    'AnalysesController.queueHolderProfilesAnalysis': 'Holder Profiles',
    'AnalysesController.queueSimilarityAnalysis': 'Similarity Analysis',
    'AnalysesController.queueDashboardWalletAnalysis': 'Dashboard Analysis',
    'AnalysesController.queueWalletHolderProfile': 'Wallet Profile',
    'IntelController.queueTokenHolders': 'Token Holder Profiles',
    'IntelController.queueTokenHoldersAgent': 'Token Holder Profiles (Agent)',
    'IntelController.queueWalletSimilarity': 'Wallet Similarity',
    'IntelController.queueWalletSimilarityAgent': 'Wallet Similarity (Agent)',
    'IntelController.queueTokenHoldersDeep': 'Deep Token Analysis',
  };

  if (endpointLabelMap[reason]) {
    return endpointLabelMap[reason];
  }

  const [, handlerName = reason] = reason.split('.');
  const cleaned = handlerName
    .replace(/^(queue|get|poll)/, '')
    .replace(/(Analysis|Agent)$/g, ' $1')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();

  return cleaned || reason;
}

function getReasonLabel(reason: string): string {
  if (reason.startsWith('precharge:')) {
    return `${formatEndpointReason(reason.slice('precharge:'.length))} Admission`;
  }

  if (reason.startsWith('endpoint:')) {
    return formatEndpointReason(reason.slice('endpoint:'.length));
  }

  if (reason.startsWith('refund:')) {
    const refundedReason = reason.slice('refund:'.length);
    return `${formatEndpointReason(refundedReason)} Refund`;
  }

  return reason;
}

function getUsageCategory(reason: string): string {
  if (reason.startsWith('precharge:')) return 'Queue Admission';
  if (reason.startsWith('endpoint:')) return getReasonLabel(reason);
  if (reason === 'dashboard-analysis') return 'Dashboard Analysis';
  if (reason === 'x402_payment') return 'Agent Payment (X402)';
  return getReasonLabel(reason);
}

function getTxConfig(tx: CreditTransaction): { label: string; detail: string; icon: React.ReactNode; color: string } {
  if (tx.reason.startsWith('refund:')) {
    return {
      label: getReasonLabel(tx.reason),
      detail: tx.reason,
      icon: <ArrowUpCircle className="h-4 w-4" />,
      color: 'text-yellow-400',
    };
  }

  if (tx.delta > 0) {
    if (tx.reason === 'signup_bonus') {
      return {
        label: 'Signup Bonus',
        detail: tx.reason,
        icon: <Gift className="h-4 w-4" />,
        color: 'text-blue-400',
      };
    }
    if (tx.reason === 'x402_payment') {
      return {
        label: 'Agent Payment (X402)',
        detail: tx.reason,
        icon: <Zap className="h-4 w-4" />,
        color: 'text-purple-400',
      };
    }
    return {
      label: 'Credit Purchase',
      detail: tx.reason,
      icon: <ArrowUpCircle className="h-4 w-4" />,
      color: 'text-green-400',
    };
  }

  return {
    label: getReasonLabel(tx.reason),
    detail: tx.reason,
    icon: <ArrowDownCircle className="h-4 w-4" />,
    color: 'text-red-400',
  };
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
  const { balance, transactions, usage, isLoading } = useCredits();
  const { packs, isLoading: packsLoading } = useCreditPacks();
  const router = useRouter();
  const packsRef = useRef<HTMLDivElement>(null);
  const usageRows = useMemo(() => {
    if (!usage) return [];

    const grouped = new Map<string, CreditUsageSummaryItem & { label: string }>();
    for (const item of usage.byReason) {
      const label = getUsageCategory(item.reason);
      const existing = grouped.get(label);
      if (!existing) {
        grouped.set(label, { ...item, label });
        continue;
      }

      grouped.set(label, {
        ...existing,
        creditsSpent: existing.creditsSpent + item.creditsSpent,
        transactionCount: existing.transactionCount + item.transactionCount,
        firstSeen: existing.firstSeen < item.firstSeen ? existing.firstSeen : item.firstSeen,
        lastSeen: existing.lastSeen > item.lastSeen ? existing.lastSeen : item.lastSeen,
      });
    }

    return Array.from(grouped.values())
      .sort((a, b) => b.creditsSpent - a.creditsSpent)
      .slice(0, 8);
  }, [usage]);

  const usageChartOption = useMemo<ECOption>(() => {
    const rows = [...usageRows].reverse();
    return {
      grid: { left: 142, right: 22, top: 8, bottom: 22 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: unknown) => {
          const point = Array.isArray(params) ? params[0] as { name: string; value: number; dataIndex: number } : null;
          if (!point) return '';
          const row = rows[point.dataIndex];
          return `${point.name}<br/>${point.value.toLocaleString()} credits<br/>${row.transactionCount.toLocaleString()} events`;
        },
      },
      xAxis: {
        type: 'value',
        axisLabel: { color: '#94a3b8' },
        splitLine: { lineStyle: { color: 'rgba(148, 163, 184, 0.12)' } },
      },
      yAxis: {
        type: 'category',
        data: rows.map((row) => row.label),
        axisLabel: { color: '#cbd5e1', width: 132, overflow: 'truncate' },
        axisLine: { lineStyle: { color: 'rgba(148, 163, 184, 0.18)' } },
        axisTick: { show: false },
      },
      series: [
        {
          type: 'bar',
          data: rows.map((row) => row.creditsSpent),
          barMaxWidth: 16,
          itemStyle: { color: '#3b82f6', borderRadius: [0, 4, 4, 0] },
        },
      ],
    };
  }, [usageRows]);

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
          <div className="space-y-5">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <Activity className="h-3.5 w-3.5" />
                  Usage Breakdown
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-56 w-full" />
                  </div>
                ) : !usage || usage.totalSpendTransactions === 0 ? (
                  <div className="flex flex-col items-center py-12 gap-3 text-muted-foreground">
                    <Receipt className="h-8 w-8 opacity-20" />
                    <p className="text-sm">No credit usage yet</p>
                  </div>
                ) : (
                  <div className="space-y-5">
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      <div className="rounded-lg border border-border bg-muted/20 p-3">
                        <p className="text-[11px] uppercase text-muted-foreground">Spent</p>
                        <p className="mt-1 text-2xl font-semibold tabular-nums">{usage.totalCreditsSpent.toLocaleString()}</p>
                      </div>
                      <div className="rounded-lg border border-border bg-muted/20 p-3">
                        <p className="text-[11px] uppercase text-muted-foreground">Events</p>
                        <p className="mt-1 text-2xl font-semibold tabular-nums">{usage.totalSpendTransactions.toLocaleString()}</p>
                      </div>
                      <div className="rounded-lg border border-border bg-muted/20 p-3 col-span-2 md:col-span-1">
                        <p className="text-[11px] uppercase text-muted-foreground">Top Type</p>
                        <p className="mt-1 text-sm font-medium truncate">{usageRows[0]?.label ?? '—'}</p>
                      </div>
                    </div>
                    <EChartComponent option={usageChartOption} style={{ height: 280, width: '100%' }} />
                    <div className="divide-y divide-border">
                      {usageRows.slice(0, 5).map((row) => (
                        <div key={row.label} className="flex items-center justify-between gap-3 py-2.5">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">{row.label}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {row.transactionCount.toLocaleString()} events · last {formatDate(row.lastSeen)}
                            </p>
                          </div>
                          <span className="font-mono text-sm font-semibold text-red-400 tabular-nums shrink-0">
                            {row.creditsSpent.toLocaleString()} cr
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

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
                          <div className={`flex items-start gap-2 min-w-0 ${config.color}`}>
                            <span className="shrink-0 pt-0.5">{config.icon}</span>
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-foreground truncate">{config.label}</div>
                              <div className="text-[11px] text-muted-foreground font-mono truncate">
                                {config.detail}
                              </div>
                            </div>
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
