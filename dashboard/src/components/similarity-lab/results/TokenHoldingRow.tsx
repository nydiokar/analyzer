'use client';

import { memo } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Copy, ExternalLink } from "lucide-react";
import { toast } from "@/hooks/use-toast"; // Import the standalone toast function

// Types would be imported from a shared types file in a real app
interface TokenBalance {
  mint: string;
  name?: string;
  symbol?: string;
  imageUrl?: string;
  valueUsd?: number | null;
}

interface TokenHoldingRowProps {
  token: TokenBalance;
  walletAddress: string;
  formatUsdValue: (value: number | null | undefined) => string;
  truncateAddress: (address: string) => string;
}

const TokenHoldingRow = memo(({ token, walletAddress, formatUsdValue, truncateAddress }: TokenHoldingRowProps) => {
  // No useToast hook needed
  
  return (
    <Popover>
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
  );
});

TokenHoldingRow.displayName = 'TokenHoldingRow';

export { TokenHoldingRow }; 