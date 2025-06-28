import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useMemo } from 'react';
import { shortenAddress } from "@/lib/solana-utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { CombinedSimilarityResult, TokenInfo } from "./types";
import { Button } from "@/components/ui/button";
import { Copy, ExternalLink, Globe, X as Twitter, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";

interface MostCommonTokensProps {
  results: CombinedSimilarityResult;
}

export function MostCommonTokens({ results }: MostCommonTokensProps) {
    const { toast } = useToast();

    // The data is now pre-enriched, so we can build the info map directly.
    const tokenInfoMap = useMemo(() => {
        const map = new Map<string, TokenInfo>();
        if (!results.walletBalances) return map;

        Object.values(results.walletBalances).forEach(balance => {
            balance.tokenBalances.forEach(token => {
                if (!map.has(token.mint)) {
                    map.set(token.mint, {
                        tokenAddress: token.mint,
                        name: token.name,
                        symbol: token.symbol,
                        imageUrl: token.imageUrl,
                        websiteUrl: token.websiteUrl,
                        twitterUrl: token.twitterUrl,
                        telegramUrl: token.telegramUrl,
                    });
                }
            });
        });
        return map;
    }, [results.walletBalances]);

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
    }, [results.pairwiseSimilarities]);
    
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
        <Card className="border">
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
                            const info = tokenInfoMap.get(token.mint);
                            const tokenName = info?.name || 'Unknown Token';
                            const tokenSymbol = info?.symbol || shortenAddress(token.mint, 4);
                            const isLoading = !info && tokenName === 'Unknown Token';

                            return (
                                <li key={token.mint} className="text-sm flex justify-between items-center border-b pb-2">
                                    <Popover>
                                        <PopoverTrigger asChild>
                                            <div className="flex items-center gap-3 flex-grow min-w-0 cursor-pointer">
                                                <Avatar className="h-8 w-8">
                                                    {isLoading ? <Skeleton className="h-8 w-8 rounded-full" /> : <AvatarImage src={info?.imageUrl ?? undefined} alt={tokenName} />}
                                                    <AvatarFallback>{tokenName.charAt(0)}</AvatarFallback>
                                                </Avatar>
                                                <div className="flex-grow min-w-0">
                                                    <TooltipProvider>
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <div className="truncate font-medium">{tokenName}</div>
                                                            </TooltipTrigger>
                                                            <TooltipContent>
                                                                <p>Shared by: {token.wallets.map(w => shortenAddress(w, 4)).join(', ')}</p>
                                                            </TooltipContent>
                                                        </Tooltip>
                                                    </TooltipProvider>
                                                    <div className="text-muted-foreground truncate">{tokenSymbol}</div>
                                                </div>
                                            </div>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-auto p-2">
                                            <div className="space-y-2">
                                                <div className="font-bold text-sm">{info?.name || 'Unknown Token'}</div>
                                                <div className="text-xs text-muted-foreground break-all">{token.mint}</div>
                                                <div className="flex items-center gap-1 pt-1">
                                                    <Button variant="outline" size="sm" className="h-auto px-2 py-1 text-xs" onClick={() => { navigator.clipboard.writeText(token.mint); toast({ description: "Copied!" })}}><Copy className="h-3 w-3 mr-1"/>Copy</Button>
                                                    <Button variant="outline" size="sm" className="h-auto px-2 py-1 text-xs" asChild><a href={`https://solscan.io/token/${token.mint}`} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3 w-3 mr-1"/>Solscan</a></Button>
                                                    {info?.websiteUrl && <Button variant="ghost" size="icon" className="h-7 w-7" asChild><a href={info.websiteUrl} target="_blank" rel="noopener noreferrer"><Globe className="h-4 w-4"/></a></Button>}
                                                    {info?.twitterUrl && <Button variant="ghost" size="icon" className="h-7 w-7" asChild><a href={info.twitterUrl} target="_blank" rel="noopener noreferrer"><Twitter className="h-4 w-4"/></a></Button>}
                                                    {info?.telegramUrl && <Button variant="ghost" size="icon" className="h-7 w-7" asChild><a href={info.telegramUrl} target="_blank" rel="noopener noreferrer"><Send className="h-4 w-4"/></a></Button>}
                                                </div>
                                            </div>
                                        </PopoverContent>
                                    </Popover>
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
} 