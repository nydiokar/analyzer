'use client';

import { memo, useState } from 'react'; // Import memo and useState
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { CombinedSimilarityResult } from './types';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Button } from "@/components/ui/button";
import { RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useMemo, useCallback } from 'react';
import { WalletBadge } from '@/components/shared/WalletBadge';
import { TokenHoldingRow } from './TokenHoldingRow'; // Import the new component

// Performance configuration
const TOKENS_PER_WALLET_DEFAULT = 10;
const TOKENS_PER_WALLET_EXPANDED = 50;

// This type is now provided directly in CombinedSimilarityResult
// interface EnrichedTokenBalance {
//   mint: string;
//   metadata?: TokenInfo;
//   valueSol?: number | null; // We will use valueUsd and convert
// }

interface ContextualHoldingsCardProps {
  results: CombinedSimilarityResult;
  enrichedBalances: Record<string, any> | null;
  onRefreshPrices: () => void;
  isRefreshing: boolean;
}

const truncateAddress = (address: string) => `${address.slice(0, 4)}...${address.slice(-4)}`;

const formatUsdValue = (value: number | null | undefined) => {
  if (value === null || typeof value === 'undefined') {
    return 'N/A';
  }
  if (value < 1 && value > 0) {
    return `< $1`;
  }
  // Use Intl.NumberFormat for better formatting with thousand separators and no decimals.
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
};

// Wrap the entire component with React.memo
export const ContextualHoldingsCard = memo(({ results, enrichedBalances, onRefreshPrices, isRefreshing }: ContextualHoldingsCardProps) => {
  const balancesSource = enrichedBalances || results.walletBalances;
  const { uniqueTokensPerWallet } = results;
  
  // Simplified state management - always show top 10, allow expansion
  const [expandedWallets, setExpandedWallets] = useState<Set<string>>(new Set());
  
  // Toggle wallet expansion
  const toggleWalletExpansion = (walletAddress: string) => {
    setExpandedWallets(prev => {
      const newSet = new Set(prev);
      if (newSet.has(walletAddress)) {
        newSet.delete(walletAddress);
      } else {
        newSet.add(walletAddress);
      }
      return newSet;
    });
  };

  // No more loading state or client-side fetching is needed.
  // const [tokenMetadata, setTokenMetadata] = useState<Record<string, TokenInfo>>({});
  // const [tokenValues, setTokenValues] = useState<Record<string, number | null>>({});
  // const [isLoading, setIsLoading] = useState(true);

  if (!balancesSource) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Contextual Wallet Holdings</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Loading wallet holdings...</p>
        </CardContent>
      </Card>
    );
  }

  const walletAddresses = Object.keys(balancesSource);

  const { walletOrder, hasBalances } = useMemo(() => {
    const balances = balancesSource || {};
    const order = Object.keys(balances);
    const hasAnyBalances = order.some(addr => balances[addr]?.tokenBalances?.length > 0);
    return { walletOrder: order, hasBalances: hasAnyBalances };
  }, [balancesSource]);

  const areBalancesLoading = !balancesSource || Object.keys(balancesSource).length === 0;

  // Use useCallback for functions passed as props to memoized components
  const memoizedFormatUsdValue = useCallback(formatUsdValue, []);
  const memoizedTruncateAddress = useCallback(truncateAddress, []);

  return (
    <Card>
        <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Contextual Holdings</CardTitle>
              <CardDescription>
                  A snapshot of current token balances for each analyzed wallet, sorted by USD value.
              </CardDescription>
            </div>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={onRefreshPrices}
                    disabled={isRefreshing || areBalancesLoading}
                    className="flex-shrink-0"
                  >
                    <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{isRefreshing ? 'Refreshing prices...' : (areBalancesLoading ? 'Waiting for balances to load...' : 'Click to refresh token prices')}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
        </CardHeader>
        <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {walletAddresses.map(walletAddress => {
                    const balanceInfo = balancesSource[walletAddress];
                    const uniqueCounts = uniqueTokensPerWallet[walletAddress] || { binary: 0, capital: 0 };

                    // Sort balances by USD value, descending. Null/undefined values go to the bottom.
                    const sortedBalances = [...(balanceInfo.tokenBalances || [])].sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1));
                    const hasNoHoldings = sortedBalances.length === 0;

                    // Performance optimization: limit tokens per wallet
                    const isExpanded = expandedWallets.has(walletAddress);
                    const tokenLimit = isExpanded ? TOKENS_PER_WALLET_EXPANDED : TOKENS_PER_WALLET_DEFAULT;
                    const displayedTokens = sortedBalances.slice(0, tokenLimit);
                    const hasMoreTokens = sortedBalances.length > tokenLimit;

                    return (
                        <div key={walletAddress} className="border rounded-lg p-3 space-y-2 flex flex-col">
                            <div className="flex justify-between items-center">
                                <WalletBadge address={walletAddress} />
                                <div className="flex items-center gap-2">
                                  <Badge variant="outline">
                                      {uniqueCounts.capital} Tokens
                                  </Badge>
                                  {hasMoreTokens && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => toggleWalletExpansion(walletAddress)}
                                      className="h-6 px-2 text-xs"
                                    >
                                      {isExpanded ? (
                                        <>
                                          <ChevronUp className="h-3 w-3 mr-1" />
                                          Less
                                        </>
                                      ) : (
                                        <>
                                          <ChevronDown className="h-3 w-3 mr-1" />
                                          +{sortedBalances.length - tokenLimit}
                                        </>
                                      )}
                                    </Button>
                                  )}
                                </div>
                            </div>
                            <Separator />
                            <div className="flex-grow">
                            {hasNoHoldings ? (
                                <p className="text-xs text-muted-foreground text-center py-4">No token holdings found.</p>
                            ) : (
                                <>
                                  <ScrollArea className="h-[200px] pr-3">
                                      <div className="space-y-1.5">
                                          {displayedTokens.map((token, index) => (
                                            <TokenHoldingRow
                                              key={`${walletAddress}-${token.mint}-${index}`}
                                              token={token}
                                              walletAddress={walletAddress}
                                              formatUsdValue={memoizedFormatUsdValue}
                                              truncateAddress={memoizedTruncateAddress}
                                            />
                                          ))}
                                      </div>
                                  </ScrollArea>
                                  {hasMoreTokens && (
                                    <div className="text-center pt-2">
                                      <p className="text-xs text-muted-foreground">
                                        Showing {displayedTokens.length} of {sortedBalances.length} tokens
                                      </p>
                                    </div>
                                  )}
                                </>
                            )}
                            </div>
                        </div>
                    )
                })}
            </div>
      </CardContent>
    </Card>
  );
});

ContextualHoldingsCard.displayName = 'ContextualHoldingsCard'; 