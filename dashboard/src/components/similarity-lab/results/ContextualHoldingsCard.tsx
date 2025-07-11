import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { CombinedSimilarityResult, TokenInfo } from './types';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Copy, ExternalLink, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import Link from 'next/link';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useMemo } from 'react';
import { WalletBadge } from '@/components/shared/WalletBadge';

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

export function ContextualHoldingsCard({ results, enrichedBalances, onRefreshPrices, isRefreshing }: ContextualHoldingsCardProps) {
  const balancesSource = enrichedBalances || results.walletBalances;
  const { walletBalances, uniqueTokensPerWallet } = results;
  const { toast } = useToast();

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
                    disabled={isRefreshing || !hasBalances}
                    className="flex-shrink-0"
                  >
                    <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{isRefreshing ? 'Refreshing prices...' : (hasBalances ? 'Click to refresh token prices' : 'No holdings to refresh')}</p>
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

                    return (
                        <div key={walletAddress} className="border rounded-lg p-3 space-y-2 flex flex-col">
                            <div className="flex justify-between items-center">
                                <WalletBadge address={walletAddress} />
                                <Badge variant="outline">
                                    {uniqueCounts.capital} Tokens
                                </Badge>
                            </div>
                            <Separator />
                            <div className="flex-grow">
                            {hasNoHoldings ? (
                                <p className="text-xs text-muted-foreground text-center py-4">No token holdings found.</p>
                            ) : (
                                <ScrollArea className="h-[200px] pr-3">
                                    <div className="space-y-1.5">
                                        {sortedBalances.map((token, index) => (
                                          <Popover key={`${walletAddress}-${token.mint}-${index}`}>
                                            <PopoverTrigger asChild>
                                              <div className="flex items-center justify-between space-x-2 text-xs p-1 hover:bg-muted/50 rounded-sm cursor-pointer">
                                                  <div className="flex items-center space-x-2 overflow-hidden">
                                                      <Avatar className="h-4 w-4">
                                                          <AvatarImage src={token?.imageUrl ?? undefined} alt={token?.name || 'Token'} />
                                                          <AvatarFallback className="text-xs">
                                                              {token?.symbol ? token.symbol.charAt(0) : '?'}
                                                          </AvatarFallback>
                                                      </Avatar>
                                                      <div className="flex flex-col truncate">
                                                        <span className="font-medium truncate">{token?.name || 'Unknown Token'}</span>
                                                        <span className="text-muted-foreground uppercase">{token?.symbol || truncateAddress(token.mint)}</span>
                                                      </div>
                                                  </div>
                                                  <div className="font-mono text-right text-foreground font-medium flex-shrink-0">
                                                      {formatUsdValue(token.valueUsd)}
                                                  </div>
                                              </div>
                                            </PopoverTrigger>
                                            <PopoverContent className="w-auto p-2">
                                              <div className="space-y-2">
                                                  <div className="font-bold text-sm">{token?.name || 'Unknown Token'}</div>
                                                  <div className="text-xs text-muted-foreground break-all">{token.mint}</div>
                                                  <div className="flex items-center gap-1 pt-1">
                                                    <TooltipProvider>
                                                      <Tooltip>
                                                        <TooltipTrigger asChild>
                                                          <Button variant="outline" size="sm" className="h-auto px-2 py-1 text-xs" onClick={() => { navigator.clipboard.writeText(token.mint); toast({ description: "Copied!" })}}><Copy className="h-3 w-3 mr-1"/>Copy</Button>
                                                        </TooltipTrigger>
                                                        <TooltipContent>
                                                          <p>Copy token address</p>
                                                        </TooltipContent>
                                                      </Tooltip>
                                                    </TooltipProvider>
                                                    <TooltipProvider>
                                                      <Tooltip>
                                                        <TooltipTrigger asChild>
                                                           <Button variant="outline" size="sm" className="h-auto px-2 py-1 text-xs" asChild><a href={`https://solscan.io/token/${token.mint}`} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3 w-3 mr-1"/>Solscan</a></Button>
                                                        </TooltipTrigger>
                                                        <TooltipContent>
                                                          <p>View on Solscan</p>
                                                        </TooltipContent>
                                                      </Tooltip>
                                                    </TooltipProvider>
                                                  </div>
                                              </div>
                                            </PopoverContent>
                                          </Popover>
                                        ))}
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