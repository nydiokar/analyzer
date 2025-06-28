import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { shortenAddress } from "@/lib/solana-utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { CombinedSimilarityResult, TokenInfo } from "./types";
import { Button } from "@/components/ui/button";
import { Copy, Check, ExternalLink, Globe, X as Twitter, Send, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fetcher } from "@/lib/fetcher";
import { useApiKeyStore } from "@/store/api-key-store";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface MostCommonTokensProps {
  results: CombinedSimilarityResult;
}

export function MostCommonTokens({ results }: MostCommonTokensProps) {
    const [tokenInfoMap, setTokenInfoMap] = useState<Map<string, TokenInfo>>(new Map());
    const [isLoading, setIsLoading] = useState(false);
    const [hasUnknownTokens, setHasUnknownTokens] = useState(false);
    const { toast } = useToast();
    const apiKey = useApiKeyStore((state) => state.apiKey);
    
    // Keep track of mints that are currently being fetched to avoid re-fetching
    const fetchingMints = useRef(new Set<string>());
    // Keep a ref to the latest tokenInfoMap to break the useEffect dependency cycle
    const tokenInfoMapRef = useRef(tokenInfoMap);
    tokenInfoMapRef.current = tokenInfoMap;

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
    
    const fetchTokenInfo = useCallback(async () => {
        if (commonTokens.length === 0 || !apiKey) return;

        const mintsToFetch = commonTokens
            .map(t => t.mint)
            .filter(mint => !tokenInfoMap.has(mint) && !fetchingMints.current.has(mint));

        if (mintsToFetch.length === 0) return;

        setIsLoading(true);
        mintsToFetch.forEach(mint => fetchingMints.current.add(mint));
        
        try {
            const fetchedTokens: TokenInfo[] = await fetcher('/token-info', {
                method: 'POST',
                body: JSON.stringify({ tokenAddresses: mintsToFetch }),
            });

            const newMap = new Map(tokenInfoMap);
            fetchedTokens.forEach(info => newMap.set(info.tokenAddress, info));
            setTokenInfoMap(newMap);

            // Check if there are still unknown tokens after the fetch
            const unknownCount = commonTokens.filter(t => !newMap.has(t.mint)).length;
            setHasUnknownTokens(unknownCount > 0);

        } catch (error) {
            console.error("Failed to fetch token info", error);
            toast({ variant: "destructive", description: "Failed to load token details." });
        } finally {
            mintsToFetch.forEach(mint => fetchingMints.current.delete(mint));
            if (fetchingMints.current.size === 0) {
                setIsLoading(false);
            }
        }
    }, [commonTokens, apiKey, toast, tokenInfoMap]);

    useEffect(() => {
        fetchTokenInfo();
    }, [fetchTokenInfo]);


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
            <CardHeader className="flex flex-row items-start justify-between">
              <div>
                <CardTitle>Most Common Tokens</CardTitle>
                <CardDescription>Top tokens shared across the wallet set.</CardDescription>
              </div>
              {hasUnknownTokens && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" onClick={fetchTokenInfo} disabled={isLoading} className="h-8 w-8 flex-shrink-0">
                          <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Refresh token data</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
              )}
            </CardHeader>
            <CardContent>
                <ScrollArea className="h-[400px]">
                    <ul className="space-y-3">
                        {commonTokens.map((token) => {
                            const info = tokenInfoMap.get(token.mint);
                            const tokenName = info?.name || 'Unknown Token';
                            const tokenSymbol = info?.symbol || shortenAddress(token.mint, 4);

                            return (
                                <li key={token.mint} className="text-sm flex justify-between items-center border-b pb-2">
                                    <Popover>
                                        <PopoverTrigger asChild>
                                            <div className="flex items-center gap-3 flex-grow min-w-0 cursor-pointer">
                                                <Avatar className="h-8 w-8">
                                                    {isLoading && !info ? <Skeleton className="h-8 w-8 rounded-full" /> : <AvatarImage src={info?.imageUrl ?? undefined} alt={tokenName} />}
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