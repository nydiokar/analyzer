'use client';

import React, { useState, useEffect, useCallback, use } from 'react';
import { useRouter } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import useSWR, { useSWRConfig } from 'swr';
import { toast } from 'sonner';
import Link from 'next/link';
import { AppShell } from '@/components/layout/AppShell';
import { ExpiryCountdown } from '@/components/credits/ExpiryCountdown';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { fetcher } from '@/lib/fetcher';
import { useCreditPacks } from '@/hooks/useCreditPacks';
import { useAuth } from '@/hooks/useAuth';
import { useUIStore } from '@/store/ui-store';
import { createCacheKey } from '@/lib/swr-config';
import { useAuthStore } from '@/store/auth-store';
import type { CheckoutResponse, PaymentStatus, CreditPack } from '@/types/api';
import {
  Loader2,
  CheckCircle2,
  ChevronLeft,
  Copy,
  Check,
  AlertCircle,
  RefreshCw,
  Coins,
  Zap,
  ArrowRight,
} from 'lucide-react';

// ── What you get breakdown ─────────────────────────────────────────────────────

function getAnalysisBreakdown(credits: number) {
  return [
    { label: 'Dashboard Analyses', count: Math.floor(credits / 5), cost: 5 },
    { label: 'Holder + Similarity runs', count: Math.floor(credits / 30), cost: 30 },
    { label: 'Standalone Similarity', count: Math.floor(credits / 20), cost: 20 },
  ];
}

// ── Copy button ────────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy');
    }
  };

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mt-1"
    >
      {copied ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
      {copied ? 'Copied!' : 'Copy payment URL'}
    </button>
  );
}

// ── Order summary (left column) ────────────────────────────────────────────────

function OrderSummary({ pack }: { pack: CreditPack }) {
  const breakdown = getAnalysisBreakdown(pack.credits);

  return (
    <Card className="h-fit">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Order Summary</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Pack details */}
        <div className="space-y-1">
          <p className="font-semibold text-foreground">{pack.name}</p>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-sm">{pack.credits.toLocaleString()} credits</span>
            <span className="font-bold text-lg">${pack.priceUsdc} <span className="text-xs font-normal text-muted-foreground">USDC</span></span>
          </div>
        </div>

        <div className="border-t border-border" />

        {/* What you get */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">What you get</p>
          {breakdown.map((item) => (
            <div key={item.label} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{item.label}</span>
              <span className="font-mono font-semibold text-foreground">{item.count.toLocaleString()}×</span>
            </div>
          ))}
        </div>

        <div className="border-t border-border" />

        <Link
          href="/dashboard/credits"
          className="flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300 transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          Change plan
        </Link>
      </CardContent>
    </Card>
  );
}

// ── Payment column states ─────────────────────────────────────────────────────

type PageState = 'loading' | 'qr' | 'confirmed' | 'expired' | 'error';

// ── Main checkout page ─────────────────────────────────────────────────────────

interface CheckoutPageProps {
  params: Promise<{ packId: string }>;
}

export default function CheckoutPage({ params }: CheckoutPageProps) {
  const { packId } = use(params);
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const { setShowAuthModal } = useUIStore();
  const { packs, isLoading: packsLoading } = useCreditPacks();
  const { mutate } = useSWRConfig();

  const [state, setState] = useState<PageState>('loading');
  const [checkout, setCheckout] = useState<CheckoutResponse | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [confirmedCredits, setConfirmedCredits] = useState<number | null>(null);

  const pack = packs.find((p) => p.id === packId) ?? null;

  // Create a checkout intent on mount (or retry)
  const createCheckout = useCallback(async (selectedPackId: string) => {
    setState('loading');
    setCheckoutError(null);
    setCheckout(null);
    try {
      const data = await fetcher('/payments/checkout', {
        method: 'POST',
        body: JSON.stringify({ packId: selectedPackId }),
      });
      setCheckout(data as CheckoutResponse);
      setState('qr');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to create checkout session';
      setCheckoutError(msg);
      setState('error');
    }
  }, []);

  // Kick off checkout once pack is loaded — use pack.id as the stable dep, not a boolean
  useEffect(() => {
    if (!isAuthenticated || packsLoading) return;
    if (!pack) return; // redirect handled by the effect below
    createCheckout(packId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packId, isAuthenticated, packsLoading, pack?.id]);

  // Redirect to billing if pack not found after packs loaded
  useEffect(() => {
    if (!packsLoading && packs.length > 0 && !pack) {
      router.replace('/dashboard/credits');
    }
  }, [packsLoading, packs.length, pack, router]);

  // Handle confirmed
  const handleConfirmed = useCallback((credits: number) => {
    setConfirmedCredits(credits);
    setState('confirmed');
    mutate(createCacheKey.credits());
  }, [mutate]);

  // Handle expiry
  const handleExpired = useCallback(() => {
    setState('expired');
  }, []);

  // Status polling (3s) — only while QR is showing
  const { data: statusData } = useSWR<PaymentStatus>(
    state === 'qr' && checkout ? createCacheKey.paymentStatus(checkout.id) : null,
    fetcher,
    {
      refreshInterval: 3000,
      revalidateOnFocus: false,
      dedupingInterval: 0,
      errorRetryCount: 0,
    }
  );

  useEffect(() => {
    if (statusData?.status === 'confirmed' && state === 'qr') {
      handleConfirmed(checkout?.credits ?? 0);
    }
    if (statusData?.status === 'expired' && state === 'qr') {
      handleExpired();
    }
  }, [statusData, state, checkout, handleConfirmed, handleExpired]);

  // WebSocket listener — faster than polling
  useEffect(() => {
    if (state !== 'qr' || !checkout) return;

    const userId = useAuthStore.getState().user?.id;
    if (!userId) return;

    const baseUrl = process.env.NEXT_PUBLIC_WEBSOCKET_URL || 'https://sova-intel.duckdns.org';
    const transports = (process.env.NEXT_PUBLIC_SOCKET_TRANSPORTS || 'polling,websocket')
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t === 'polling' || t === 'websocket') as ('polling' | 'websocket')[];

    const socket: Socket = io(baseUrl, {
      path: '/socket.io/',
      transports,
      upgrade: process.env.NEXT_PUBLIC_SOCKET_UPGRADE !== 'false',
      autoConnect: true,
      reconnectionAttempts: 5,
      auth: { userId },
    });

    const handlePaymentConfirmed = (data: {
      intentId: string;
      credits: number;
      balance: number;
      txSignature: string;
    }) => {
      if (data.intentId !== checkout.id) return;
      handleConfirmed(data.credits);
    };

    socket.on('payment:confirmed', handlePaymentConfirmed);
    return () => {
      socket.off('payment:confirmed', handlePaymentConfirmed);
      socket.disconnect();
    };
  }, [state, checkout, handleConfirmed]);

  // Toast on success
  useEffect(() => {
    if (state === 'confirmed' && confirmedCredits !== null) {
      toast.success(`${confirmedCredits.toLocaleString()} credits added to your account!`);
    }
  }, [state, confirmedCredits]);

  // ── Auth gate ─────────────────────────────────────────────────────────────

  if (!isAuthenticated) {
    return (
      <AppShell>
        <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-4">
          <Coins className="h-12 w-12 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Sign in to purchase credits</h1>
          <Button onClick={() => setShowAuthModal(true, 'manual')}>Sign In</Button>
        </div>
      </AppShell>
    );
  }

  // ── Loading pack ──────────────────────────────────────────────────────────

  if (packsLoading) {
    return (
      <AppShell>
        <div className="p-4 md:p-8 max-w-5xl mx-auto">
          <Skeleton className="h-8 w-48 mb-6" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Skeleton className="h-64" />
            <Skeleton className="h-64" />
          </div>
        </div>
      </AppShell>
    );
  }

  if (!pack) return null; // redirect in flight

  return (
    <AppShell>
      <div className="p-4 md:p-8 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Link
            href="/dashboard/credits"
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Back to credits"
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <div className="flex items-center gap-2">
            <Coins className="h-5 w-5 text-blue-400" />
            <h1 className="text-xl font-semibold">Checkout</h1>
          </div>
        </div>

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Left: Order summary */}
          <OrderSummary pack={pack} />

          {/* Right: Payment */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Payment</CardTitle>
            </CardHeader>
            <CardContent>
              {/* LOADING: creating intent */}
              {state === 'loading' && (
                <div className="flex flex-col items-center gap-3 py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Creating payment session…</p>
                </div>
              )}

              {/* ERROR: failed to create intent */}
              {state === 'error' && (
                <div className="flex flex-col items-center gap-4 py-8 text-center">
                  <AlertCircle className="h-12 w-12 text-red-400" />
                  <div>
                    <p className="font-semibold text-foreground">Failed to create session</p>
                    <p className="text-sm text-muted-foreground mt-1">{checkoutError}</p>
                  </div>
                  <Button
                    onClick={() => createCheckout(packId)}
                    variant="outline"
                    className="gap-2"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Try Again
                  </Button>
                  <Link href="/dashboard/credits" className="text-sm text-muted-foreground hover:text-foreground">
                    Back to billing
                  </Link>
                </div>
              )}

              {/* QR: waiting for payment */}
              {state === 'qr' && checkout && (
                <div className="flex flex-col items-center gap-5">
                  {/* QR code */}
                  <div className="rounded-xl bg-white p-4 shadow-sm">
                    {/* eslint-disable-next-line @next/next/no-img-element -- src is a data: URI, next/image cannot optimize it */}
                    <img
                      src={checkout.qrCodeDataUrl}
                      alt="Solana Pay QR code"
                      width={240}
                      height={240}
                      style={{ display: 'block' }}
                    />
                  </div>

                  {/* Amount summary */}
                  <div className="text-center space-y-0.5">
                    <p className="font-semibold text-foreground text-lg">
                      ${checkout.amountUsdc} USDC
                    </p>
                    <p className="text-sm text-muted-foreground">
                      → {checkout.credits.toLocaleString()} credits
                    </p>
                  </div>

                  {/* URL + copy */}
                  <div className="w-full space-y-1">
                    <p className="text-xs text-muted-foreground text-center font-medium">Mobile wallet users</p>
                    <div className="rounded-md bg-muted/40 border border-border px-3 py-2 text-xs font-mono text-muted-foreground break-all">
                      {checkout.solanaPayUrl}
                    </div>
                    <div className="flex justify-center">
                      <CopyButton text={checkout.solanaPayUrl} />
                    </div>
                  </div>

                  {/* Waiting indicator */}
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Waiting for payment confirmation…
                  </div>

                  {/* Expiry */}
                  <ExpiryCountdown
                    expiresAt={checkout.expiresAt}
                    onExpired={handleExpired}
                    prominent
                  />
                </div>
              )}

              {/* CONFIRMED: success state */}
              {state === 'confirmed' && (
                <div className="flex flex-col items-center gap-5 py-8 text-center">
                  <CheckCircle2 className="h-16 w-16 text-green-500" />
                  <div>
                    <p className="text-xl font-bold text-foreground">Payment Confirmed!</p>
                    {confirmedCredits !== null && (
                      <p className="text-muted-foreground mt-1 flex items-center justify-center gap-1.5">
                        <Zap className="h-4 w-4 text-blue-400" />
                        {confirmedCredits.toLocaleString()} credits added to your account
                      </p>
                    )}
                  </div>
                  <Button
                    onClick={() => router.push('/dashboard/credits')}
                    className="gap-2"
                  >
                    View Balance
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              )}

              {/* EXPIRED: session expired */}
              {state === 'expired' && (
                <div className="flex flex-col items-center gap-4 py-8 text-center">
                  <AlertCircle className="h-12 w-12 text-orange-400" />
                  <div>
                    <p className="font-semibold text-foreground">Session Expired</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Your payment session has expired. Start a new one to continue.
                    </p>
                  </div>
                  <Button
                    onClick={() => createCheckout(packId)}
                    className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Start New Session
                  </Button>
                  <Link href="/dashboard/credits" className="text-sm text-muted-foreground hover:text-foreground">
                    Back to billing
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Footer note */}
        <p className="text-xs text-muted-foreground text-center mt-6">
          Pay with USDC on Solana using Phantom, Backpack, or any Solana Pay compatible wallet.
          Credits are added instantly upon on-chain confirmation.
        </p>
      </div>
    </AppShell>
  );
}
