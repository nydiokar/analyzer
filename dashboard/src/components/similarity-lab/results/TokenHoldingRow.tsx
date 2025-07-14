'use client';

import { memo } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Copy, ExternalLink } from "lucide-react";
import { toast } from "@/hooks/use-toast"; // Import the standalone toast function
import { TokenBadge } from "@/components/shared/TokenBadge";

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
    <div className="flex items-center justify-between space-x-2 text-xs p-1 hover:bg-muted/50 rounded-sm">
        <div className="flex items-center space-x-2 overflow-hidden flex-1 min-w-0">
            <TokenBadge 
                mint={token.mint} 
                metadata={{
                    name: token?.name || undefined,
                    symbol: token?.symbol || undefined,
                    imageUrl: token?.imageUrl || undefined
                }} 
                size="sm" 
            />
        </div>
        <div className="font-mono text-right text-foreground font-medium flex-shrink-0">
            {formatUsdValue(token.valueUsd)}
        </div>
    </div>
  );
});

TokenHoldingRow.displayName = 'TokenHoldingRow';

export { TokenHoldingRow }; 