'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import useSWR from 'swr';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { fetcher } from '@/lib/fetcher';
import { useCreditPacks } from '@/hooks/useCreditPacks';
import { createCacheKey } from '@/lib/swr-config';
import { useAuthStore } from '@/store/auth-store';
import type { CheckoutResponse, PaymentStatus, CreditPack } from '@/types/api';
import { useSWRConfig } from 'swr';
import { Loader2, CheckCircle2, ChevronLeft } from 'lucide-react';
import { ExpiryCountdown } from '@/components/credits/ExpiryCountdown';

interface CreditPurchaseModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Stage = 'packs' | 'qr' | 'confirmed';

export function CreditPurchaseModal({ open, onOpenChange }: CreditPurchaseModalProps) {
  const { packs, isLoading: packsLoading } = useCreditPacks();
  const [stage, setStage] = useState<Stage>('packs');
  const [checkout, setCheckout] = useState<CheckoutResponse | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [confirmedCredits, setConfirmedCredits] = useState<number | null>(null);
  const { mutate } = useSWRConfig();

  // Reset to pack selection when modal opens
  useEffect(() => {
    if (open) {
      setStage('packs');
      setCheckout(null);
      setConfirmedCredits(null);
    }
  }, [open]);

  // Status polling — only active while on QR stage with a pending intent
  const shouldPoll = stage === 'qr' && !!checkout;
  const { data: statusData } = useSWR<PaymentStatus>(
    shouldPoll ? createCacheKey.paymentStatus(checkout!.id) : null,
    fetcher,
    {
      refreshInterval: 3000,
      revalidateOnFocus: false,
      dedupingInterval: 0,
      errorRetryCount: 0,
    }
  );

  // Handle confirmed status from polling
  const handleConfirmed = useCallback((credits: number) => {
    setConfirmedCredits(credits);
    setStage('confirmed');
    // Refresh the global credits balance
    mutate(createCacheKey.credits());
  }, [mutate]);

  useEffect(() => {
    if (statusData?.status === 'confirmed' && stage === 'qr') {
      handleConfirmed(checkout?.credits ?? 0);
    }
  }, [statusData, stage, checkout, handleConfirmed]);

  // WebSocket listener for payment:confirmed — faster than polling
  useEffect(() => {
    if (!open || stage !== 'qr' || !checkout) return;

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
  }, [open, stage, checkout, handleConfirmed]);

  // Show success toast when confirmed
  useEffect(() => {
    if (stage === 'confirmed' && confirmedCredits !== null) {
      toast.success(`${confirmedCredits.toLocaleString()} credits added to your account!`);
    }
  }, [stage, confirmedCredits]);

  const handleSelectPack = async (pack: CreditPack) => {
    setCheckoutLoading(true);
    try {
      const data = await fetcher('/payments/checkout', {
        method: 'POST',
        body: JSON.stringify({ packId: pack.id }),
      });
      setCheckout(data as CheckoutResponse);
      setStage('qr');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to create checkout';
      toast.error(msg);
    } finally {
      setCheckoutLoading(false);
    }
  };

  const handleClose = () => onOpenChange(false);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {stage === 'packs' && 'Buy Credits'}
            {stage === 'qr' && (
              <span className="flex items-center gap-2">
                <button
                  onClick={() => setStage('packs')}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Back to packs"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                Scan to Pay
              </span>
            )}
            {stage === 'confirmed' && 'Payment Confirmed'}
          </DialogTitle>
        </DialogHeader>

        {/* STAGE: Pack selection */}
        {stage === 'packs' && (
          <div className="flex flex-col gap-3 pt-2">
            {packsLoading && (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}
            {!packsLoading && packs.map((pack) => (
              <button
                key={pack.id}
                onClick={() => handleSelectPack(pack)}
                disabled={checkoutLoading}
                className="flex items-center justify-between rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-blue-500 hover:bg-accent/50 disabled:opacity-50"
              >
                <div>
                  <p className="font-semibold text-foreground">{pack.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {pack.credits.toLocaleString()} credits
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-lg text-foreground">${pack.priceUsdc}</p>
                  <p className="text-xs text-muted-foreground">USDC</p>
                </div>
              </button>
            ))}
            {checkoutLoading && (
              <div className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating payment…
              </div>
            )}
            <p className="text-xs text-muted-foreground text-center pt-1">
              Pay with USDC on Solana using Phantom, Backpack, or any Solana Pay wallet
            </p>
          </div>
        )}

        {/* STAGE: QR code */}
        {stage === 'qr' && checkout && (
          <div className="flex flex-col items-center gap-4 pt-2">
            <div className="rounded-lg bg-white p-3 shadow-sm">
              {/* eslint-disable-next-line @next/next/no-img-element -- src is a data: URI, next/image cannot optimize it */}
              <img
                src={checkout.qrCodeDataUrl}
                alt="Solana Pay QR code"
                width={220}
                height={220}
                style={{ display: 'block' }}
              />
            </div>

            <div className="w-full text-center space-y-1">
              <p className="font-semibold text-foreground">
                ${checkout.amountUsdc} USDC → {checkout.credits.toLocaleString()} credits
              </p>
              <p className="text-xs text-muted-foreground break-all px-2">
                {checkout.solanaPayUrl}
              </p>
            </div>

            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Waiting for payment…
            </div>

            <ExpiryCountdown expiresAt={checkout.expiresAt} onExpired={() => setStage('packs')} />
          </div>
        )}

        {/* STAGE: Confirmed */}
        {stage === 'confirmed' && (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <CheckCircle2 className="h-16 w-16 text-green-500" />
            <div>
              <p className="text-xl font-bold text-foreground">Payment confirmed!</p>
              {confirmedCredits !== null && (
                <p className="text-muted-foreground mt-1">
                  {confirmedCredits.toLocaleString()} credits added to your account.
                </p>
              )}
            </div>
            <Button onClick={() => onOpenChange(false)} className="w-full">
              Done
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

