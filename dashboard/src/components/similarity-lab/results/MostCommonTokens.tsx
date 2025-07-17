'use client';

import { useMemo, memo, useState, useEffect } from 'react'; // Import memo
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { WalletBadge } from "@/components/shared/WalletBadge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { CombinedSimilarityResult, TokenInfo } from "./types";
import { Button } from "@/components/ui/button";
import { Copy, ExternalLink, Globe, X as Twitter, Send, HelpCircle } from "lucide-react";
import { TokenBadge } from "@/components/shared/TokenBadge";

interface MostCommonTokensProps {
  results: CombinedSimilarityResult;
  enrichedBalances: Record<string, any> | null;
}

// Custom TokenBadge with timeout fallback
const TokenBadgeWithFallback = ({ mint, metadata, size }: { mint: string; metadata: any; size: "sm" | "md" | "lg" | undefined }) => {
  const [showFallback, setShowFallback] = useState(false);

  useEffect(() => {
    if (!metadata) {
      const timer = setTimeout(() => {
        setShowFallback(true);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [metadata]);

  if (!metadata && showFallback) {
    return (
      <div className="flex items-center gap-2">
        <Avatar className="h-6 w-6">
          <AvatarFallback className="bg-muted">
            <HelpCircle className="h-3 w-3 text-muted-foreground" />
          </AvatarFallback>
        </Avatar>
        <div className="flex flex-col">
          <span className="font-medium text-sm">Unknown Token</span>
          <span className="text-xs text-muted-foreground font-mono">
            {mint.slice(0, 4)}...{mint.slice(-4)}
          </span>
        </div>
      </div>
    );
  }

  return <TokenBadge mint={mint} metadata={metadata} size={size} />;
};

// Function to build a lookup map for token metadata from enriched balances
const buildTokenMetadataMap = (enrichedBalances: Record<string, any> | null) => {
    const map = new Map<string, { name?: string; symbol?: string; imageUrl?: string, websiteUrl?: string; twitterUrl?: string; telegramUrl?: string; }>();
    if (!enrichedBalances) return map;

    for (const wallet of Object.values(enrichedBalances)) {
        // Check if wallet exists and has tokenBalances array
        if (!wallet || !wallet.tokenBalances || !Array.isArray(wallet.tokenBalances)) {
            continue;
        }
        
        for (const token of wallet.tokenBalances) {
            if (token.mint && !map.has(token.mint)) {
                map.set(token.mint, {
                    name: token.name,
                    symbol: token.symbol,
                    imageUrl: token.imageUrl,
                    websiteUrl: token.websiteUrl,
                    twitterUrl: token.twitterUrl,
                    telegramUrl: token.telegramUrl,
                });
            }
        }
    }
    return map;
};

// Wrap the component in React.memo
export const MostCommonTokens = memo(({ results, enrichedBalances }: MostCommonTokensProps) => {
    const { toast } = useToast();

    const tokenMetadataMap = buildTokenMetadataMap(enrichedBalances);

    const commonTokens = useMemo(() => {
        const tokenMap = new Map<string, Set<string>>();

        results.pairwiseSimilarities.forEach(pair => {
            if (pair.sharedTokens) {
                pair.sharedTokens.forEach(token => {
                    if (!tokenMap.has(token.mint)) {
                        tokenMap.set(token.mint, new Set());
                    }
                    const wallets = tokenMap.get(token.mint)!;
                    wallets.add(pair.walletA);
                    wallets.add(pair.walletB);
                });
            }
        });

        return Array.from(tokenMap.entries()).map(([mint, walletsSet]) => ({
            mint,
            count: walletsSet.size,
            wallets: Array.from(walletsSet),
        })).sort((a, b) => b.count - a.count).slice(0, 20);
    }, [results.pairwiseSimilarities, enrichedBalances]);
    
    if (commonTokens.length === 0) {
        return (
            <Card className="border">
                <CardHeader>
                    <CardTitle>Most Common Tokens</CardTitle>
                    <CardDescription>Top tokens shared across the wallet set.</CardDescription>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground text-center py-8">No shared tokens found.</p>
                </CardContent>
            </Card>
        );
    }
    
    return (
        <Card className="border w-full">
            <CardHeader>
              <div>
                <CardTitle>Most Common Tokens</CardTitle>
                <CardDescription>Top tokens shared across the wallet set.</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
                <ScrollArea className="h-[400px]">
                    <ul className="space-y-3">
                        {commonTokens.map((token) => {
                            const metadata = tokenMetadataMap.get(token.mint);

                            return (
                                <li key={token.mint} className="text-sm flex justify-between items-center border-b pb-2">
                                    <div className="flex items-center gap-3 flex-grow min-w-0">
                                        <TooltipProvider>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <div className="flex-1 min-w-0">
                                                        <TokenBadgeWithFallback 
                                                            mint={token.mint} 
                                                            metadata={metadata} 
                                                            size="lg" 
                                                        />
                                                    </div>
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                    <div className="flex flex-col gap-2 p-2 max-w-xs">
                                                        <p className="font-bold">Shared by:</p>
                                                        <div className="flex flex-wrap gap-2">
                                                            {token.wallets.map(w => <WalletBadge key={w} address={w} />)}
                                                        </div>
                                                    </div>
                                                </TooltipContent>
                                            </Tooltip>
                                        </TooltipProvider>
                                    </div>
                                    <div className="flex items-center gap-2 ml-4">
                                        <Badge variant="secondary">{token.count} wallets</Badge>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                </ScrollArea>
            </CardContent>
        </Card>
    );
});

MostCommonTokens.displayName = 'MostCommonTokens'; // Add display name 