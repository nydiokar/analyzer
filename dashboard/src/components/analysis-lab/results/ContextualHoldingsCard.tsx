import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { CombinedSimilarityResult, TokenInfo } from './types';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useEffect, useState, useMemo } from 'react';
import { fetcher } from '@/lib/fetcher';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

// Types for the new endpoint. Re-defined here to avoid direct backend imports.
interface TokenValueRequestItem {
  walletAddress: string;
  tokenAddress: string;
}

interface TokenValueResponseItem {
  walletAddress: string;
  tokenAddress: string;
  valueSol: number | null;
}

interface EnrichedTokenBalance {
  mint: string;
  metadata?: TokenInfo;
  valueSol?: number | null;
}

interface ContextualHoldingsCardProps {
  results: CombinedSimilarityResult;
}

const truncateAddress = (address: string) => `${address.slice(0, 4)}...${address.slice(-4)}`;

const formatSolValue = (value: number | null | undefined) => {
  if (value === null || typeof value === 'undefined') {
    return 'N/A';
  }
  if (value < 0.01 && value > 0) {
    return `< 0.01 SOL`;
  }
  return `${value.toFixed(2)} SOL`;
};

export function ContextualHoldingsCard({ results }: ContextualHoldingsCardProps) {
  const { walletBalances, uniqueTokensPerWallet } = results;
  const [tokenMetadata, setTokenMetadata] = useState<Record<string, TokenInfo>>({});
  const [tokenValues, setTokenValues] = useState<Record<string, number | null>>({});
  const [isLoading, setIsLoading] = useState(true);

  const allMints = useMemo(() => {
    if (!walletBalances) return [];
    const mints = new Set<string>();
    Object.values(walletBalances).forEach(balance => {
      balance.tokenBalances?.forEach(token => {
        mints.add(token.mint);
      });
    });
    return Array.from(mints);
  }, [walletBalances]);

  useEffect(() => {
    const fetchAllData = async () => {
      if (allMints.length === 0) {
        setIsLoading(false);
        return;
      }
      
      setIsLoading(true);
      try {
        // Fetch Metadata
        const metadataResponse: TokenInfo[] = await fetcher('/token-info', {
          method: 'POST',
          body: JSON.stringify({ tokenAddresses: allMints }),
        });
        const metadataMap = metadataResponse.reduce((acc, token) => {
          acc[token.tokenAddress] = token;
          return acc;
        }, {} as Record<string, TokenInfo>);
        setTokenMetadata(metadataMap);

        // Fetch Values
        if (walletBalances) {
          const tokenValuePayload: TokenValueRequestItem[] = [];
          Object.entries(walletBalances).forEach(([walletAddress, balanceInfo]) => {
            balanceInfo.tokenBalances.forEach(token => {
              tokenValuePayload.push({ walletAddress, tokenAddress: token.mint });
            });
          });

          const valuesResponse: TokenValueResponseItem[] = await fetcher('/wallets/token-values', {
            method: 'POST',
            body: JSON.stringify({ tokens: tokenValuePayload }),
          });

          const valueMap = valuesResponse.reduce((acc, item) => {
            // Create a unique key for wallet+token
            const key = `${item.walletAddress}-${item.tokenAddress}`;
            acc[key] = item.valueSol;
            return acc;
          }, {} as Record<string, number | null>);
          setTokenValues(valueMap);
        }

      } catch (error) {
        console.error("Failed to fetch token metadata or values", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchAllData();
  }, [allMints, walletBalances]);

  const getEnrichedBalances = (walletAddress: string): EnrichedTokenBalance[] => {
    const balanceInfo = walletBalances?.[walletAddress];
    if (!balanceInfo?.tokenBalances) return [];
    
    const enriched = balanceInfo.tokenBalances.map(token => {
      const key = `${walletAddress}-${token.mint}`;
      return {
        mint: token.mint,
        metadata: tokenMetadata[token.mint],
        valueSol: tokenValues[key],
      };
    });

    // Sort by value, descending. Null/undefined values go to the bottom.
    return enriched.sort((a, b) => (b.valueSol ?? -1) - (a.valueSol ?? -1));
  };


  if (!walletBalances || Object.keys(walletBalances).length === 0) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>Contextual Holdings</CardTitle>
                 <CardDescription>
                    Current token balances for analyzed wallets. This data was not provided in the analysis result.
                </CardDescription>
            </CardHeader>
        </Card>
    )
  }

  const wallets = Object.keys(walletBalances);

  return (
    <Card>
        <CardHeader>
            <CardTitle>Contextual Holdings</CardTitle>
            <CardDescription>
                A snapshot of current token balances for each analyzed wallet, sorted by SOL value to show significance.
            </CardDescription>
        </CardHeader>
        <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {wallets.map(walletAddress => {
                    const uniqueCounts = uniqueTokensPerWallet[walletAddress];
                    const enrichedBalances = getEnrichedBalances(walletAddress);
                    const hasNoHoldings = enrichedBalances.length === 0;

                    return (
                        <div key={walletAddress} className="border rounded-lg p-3 space-y-2 flex flex-col">
                            <div className="flex justify-between items-center">
                                <h4 className="font-semibold text-sm">{truncateAddress(walletAddress)}</h4>
                                <Badge variant="outline">
                                    {uniqueCounts.capital} Tokens
                                </Badge>
                            </div>
                            <Separator />
                            <div className="flex-grow">
                            {hasNoHoldings ? (
                                <p className="text-xs text-muted-foreground text-center py-4">No token holdings found.</p>
                            ) : (
                                <ScrollArea className="h-[120px] pr-3">
                                    <div className="space-y-1.5">
                                        {isLoading ? (
                                           Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)
                                        ) : (
                                            enrichedBalances.map(token => {
                                                const metadata = token.metadata;
                                                return (
                                                    <div key={token.mint} className="flex items-center justify-between space-x-2 text-xs p-1 hover:bg-muted/50 rounded-sm">
                                                        <div className="flex items-center space-x-2 overflow-hidden">
                                                            <Avatar className="h-4 w-4">
                                                                <AvatarImage src={metadata?.imageUrl ?? undefined} alt={metadata?.name || 'Token'} />
                                                                <AvatarFallback className="text-xs">
                                                                    {metadata?.symbol ? metadata.symbol.charAt(0) : '?'}
                                                                </AvatarFallback>
                                                            </Avatar>
                                                            <div className="flex flex-col truncate">
                                                              <span className="font-medium truncate">{metadata?.name || 'Unknown Token'}</span>
                                                              <span className="text-muted-foreground uppercase">{metadata?.symbol || truncateAddress(token.mint)}</span>
                                                            </div>
                                                        </div>
                                                        <div className="font-mono text-right text-muted-foreground flex-shrink-0">
                                                            {formatSolValue(token.valueSol)}
                                                        </div>
                                                    </div>
                                                )
                                            })
                                        )}
                                    </div>
                                </ScrollArea>
                            )}
                            </div>
                        </div>
                    )
                })}
            </div>
      </CardContent>
    </Card>
  );
} 