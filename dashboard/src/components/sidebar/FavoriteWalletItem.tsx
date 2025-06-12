"use client";

import useSWR from 'swr';
import { fetcher } from '@/lib/fetcher';
import { WalletSummaryData } from '@/types/api';
import { Skeleton } from "@/components/ui/skeleton";

interface FavoriteWalletItemProps {
  walletAddress: string;
}

export default function FavoriteWalletItem({ walletAddress }: FavoriteWalletItemProps) {
  const walletSummaryKey = walletAddress ? `/wallets/${walletAddress}/summary` : null;
  const { data: summary, error } = useSWR<WalletSummaryData>(
    walletSummaryKey,
    fetcher,
    {
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    }
  );

  if (error) {
    return (
        <div className="text-xs text-muted-foreground flex space-x-5 mt-0.5">
            <span>PNL: -</span>
            <span>Score: -</span>
        </div>
    );
  }
  if (!summary) {
      return (
          <div className="text-xs text-muted-foreground flex space-x-5 mt-0.5">
              <span>PNL: <Skeleton className="h-3 w-10 inline-block" /></span>
              <span>Score: <Skeleton className="h-3 w-10 inline-block" /></span>
          </div>
      );
  }

  const pnl = summary.latestPnl;
  const winRate = summary.tokenWinRate;

  return (
    <div className="text-xs text-muted-foreground flex space-x-5 mt-0.5">
        <span>PNL: {typeof pnl === 'number' ? `${pnl.toFixed(2)} SOL` : 'N/A'}</span>
        <span>Win Rate: {typeof winRate === 'number' ? `${winRate.toFixed(1)}%` : 'N/A'}</span> 
    </div>
  );
} 