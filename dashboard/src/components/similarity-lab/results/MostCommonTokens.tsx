'use client';

import { useMemo, memo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { WalletBadge } from "@/components/shared/WalletBadge";
import { CombinedSimilarityResult } from "./types";
import { ChevronDown, ChevronRight } from "lucide-react";
import { TokenBadge } from "@/components/shared/TokenBadge";

interface MostCommonTokensProps {
  results: CombinedSimilarityResult;
  enrichedBalances: Record<string, any> | null;
}

const TokenBadgeWithFallback = ({ mint, metadata, size }: { mint: string; metadata: any; size: "sm" | "md" | "lg" | undefined }) => {
  return <TokenBadge mint={mint} metadata={metadata} variant="inline" size={size} />;
};

// Build a lookup map for token metadata only for mints we plan to render
const buildTokenMetadataMap = (
  enrichedBalances: Record<string, any> | null,
  targetMints: Set<string>
) => {
  const map = new Map<string, { name?: string; symbol?: string; imageUrl?: string; websiteUrl?: string; twitterUrl?: string; telegramUrl?: string; }>();
  if (!enrichedBalances || targetMints.size === 0) return map;

  for (const wallet of Object.values(enrichedBalances)) {
    if (!wallet || !wallet.tokenBalances || !Array.isArray(wallet.tokenBalances)) {
      continue;
    }

    for (const token of wallet.tokenBalances) {
      if (!token.mint || !targetMints.has(token.mint) || map.has(token.mint)) {
        continue;
      }
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
  return map;
};

// Wrap the component in React.memo
export const MostCommonTokens = memo(({ results, enrichedBalances }: MostCommonTokensProps) => {
    const getWalletLabel = (address: string) => results.walletLabels?.[address];

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

    const targetMints = useMemo(() => new Set(commonTokens.map(token => token.mint)), [commonTokens]);
    const tokenMetadataMap = useMemo(
      () => buildTokenMetadataMap(enrichedBalances, targetMints),
      [enrichedBalances, targetMints]
    );

    
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
    
    const [expandedTokens, setExpandedTokens] = useState<Set<string>>(new Set());

    const toggleToken = (mint: string) => {
        const newExpanded = new Set(expandedTokens);
        if (newExpanded.has(mint)) {
            newExpanded.delete(mint);
        } else {
            newExpanded.add(mint);
        }
        setExpandedTokens(newExpanded);
    };

    return (
        <Card className="border w-full">
            <CardHeader className="pb-3">
                <CardTitle className="text-sm">Most Common Tokens</CardTitle>
                <CardDescription className="text-xs">Click to expand and view holders</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
                <ScrollArea className="h-[450px]">
                    <div className="space-y-1.5 pr-3">
                        {commonTokens.map((token) => {
                            const metadata = tokenMetadataMap.get(token.mint);
                            const totalWallets = results.summary?.walletCount || Object.keys(results.uniqueTokensPerWallet || {}).length;
                            const percentage = totalWallets > 0 ? ((token.count / totalWallets) * 100).toFixed(0) : 0;
                            const isExpanded = expandedTokens.has(token.mint);

                            return (
                                <div key={token.mint} className="border border-border/40 rounded-lg overflow-hidden hover:border-border/70 transition-colors">
                                    {/* Token Header - Always Visible */}
                                    <div
                                        onClick={() => toggleToken(token.mint)}
                                        className="w-full flex items-center justify-between gap-3 p-2.5 bg-card hover:bg-muted/20 transition-colors cursor-pointer"
                                    >
                                        <div className="flex items-center gap-2 min-w-0">
                                            <div className="shrink-0">
                                                {isExpanded ? (
                                                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                                ) : (
                                                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                                )}
                                            </div>
                                            <div className="min-w-0">
                                                <TokenBadgeWithFallback
                                                    mint={token.mint}
                                                    metadata={metadata}
                                                    size="sm"
                                                />
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1.5 flex-shrink-0 text-xs font-semibold">
                                            <span className="text-foreground/70">{token.count}/{totalWallets}</span>
                                            <span className="text-muted-foreground">•</span>
                                            <span className="text-foreground/70">{percentage}%</span>
                                        </div>
                                    </div>

                                    {/* Expandable Wallet List */}
                                    {isExpanded && (
                                        <div className="p-2.5 bg-muted/20 border-t border-border/40">
                                            <div className="flex flex-wrap gap-1.5">
                                                {token.wallets.map(w => {
                                                    const walletLabel = getWalletLabel(w);
                                                    return (
                                                        <WalletBadge
                                                            key={w}
                                                            address={w}
                                                            size="s"
                                                            knownType={walletLabel?.knownType}
                                                            knownLabel={walletLabel?.knownLabel}
                                                            visibleActions={{ copy: true, solscan: true, profile: true }}
                                                        />
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </ScrollArea>
            </CardContent>
        </Card>
    );
});

MostCommonTokens.displayName = 'MostCommonTokens'; // Add display name 
