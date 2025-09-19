'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { debounce } from 'lodash';
import { isValidSolanaAddress } from '@/lib/solana-utils';
import { AlertCircle } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface WalletInputFormProps {
  onWalletsChange: (wallets: string[]) => void;
  onAnalyze: () => void;
  isRunning: boolean;
  jobProgress?: number;
  progressMessage?: string;
  externalWallets?: string[];
}

export function WalletInputForm({ onWalletsChange, onAnalyze, isRunning, jobProgress = 0, progressMessage = '', externalWallets = [] }: WalletInputFormProps) {
  const [walletsText, setWalletsText] = useState('');

  const { wallets, validWallets, invalidWallets } = useMemo(() => {
    const addresses = Array.from(new Set(
      walletsText.replace(/[,|\n\r]+/g, ' ').split(' ').map(w => w.trim()).filter(Boolean)
    ));
    
    const valid: string[] = [];
    const invalid: string[] = [];
    
    addresses.forEach(addr => {
      if (isValidSolanaAddress(addr)) {
        valid.push(addr);
      } else if (addr.length > 0) {
        invalid.push(addr);
      }
    });
    
    return {
      wallets: addresses,
      validWallets: valid,
      invalidWallets: invalid
    };
  }, [walletsText]);

  const debouncedOnWalletsChange = useCallback(
    debounce((list: string[]) => {
      onWalletsChange(list);
    }, 300),
    [onWalletsChange]
  );

  useEffect(() => {
    debouncedOnWalletsChange(validWallets);
    return () => {
      debouncedOnWalletsChange.cancel();
    };
  }, [validWallets, debouncedOnWalletsChange]);

  // Merge externally provided wallets (e.g., from Top Holders panel) into the textarea seamlessly
  useEffect(() => {
    if (!externalWallets || externalWallets.length === 0) return;
    // Current addresses from textarea
    const current = Array.from(new Set(
      walletsText.replace(/[,|\n\r]+/g, ' ').split(' ').map(w => w.trim()).filter(Boolean)
    ));
    const merged = Array.from(new Set([...current, ...externalWallets])).filter(Boolean);
    // Only update if there's something new to avoid cursor jumps
    if (merged.length !== current.length) {
      setWalletsText(merged.join('\n'));
    }
  }, [externalWallets]);

  const hasErrors = invalidWallets.length > 0;
  const canAnalyze = validWallets.length >= 2 && !hasErrors && wallets.length === validWallets.length;

  const handleAnalyze = useCallback(() => {
    onAnalyze();
  }, [onAnalyze]);

  const isDisabled = !canAnalyze;

  return (
    <div className="space-y-4">
      {/* Wallet Input Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label htmlFor="wallet-addresses" className="text-sm font-medium">
            Wallet Addresses
          </Label>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-xs">
              {wallets.length} / 50 wallets
            </Badge>
            {hasErrors && (
              <Badge variant="outline" className="text-xs border-amber-200 text-amber-700">
                {invalidWallets.length} to fix
              </Badge>
            )}
          </div>
        </div>

        <Textarea
          id="wallet-addresses"
          placeholder="Enter wallet addresses, one per line..."
          value={walletsText}
          onChange={(e) => setWalletsText(e.target.value)}
          className={cn(
            "min-h-[120px] font-mono text-sm resize-none",
            hasErrors && "border-amber-200 bg-amber-50/30"
          )}
        />

        {/* Discrete single wallet message */}
        {wallets.length === 1 && !hasErrors && (
          <p className="text-xs text-muted-foreground">
            Add at least one more wallet to compare similarities
          </p>
        )}

        {/* Subtle validation feedback */}
        {hasErrors && (
          <div className="bg-white border border-amber-300 rounded-md p-3">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
              <div className="space-y-2 min-w-0 flex-1">
                <p className="text-sm text-gray-800 font-medium">
                  Please check these addresses:
                </p>
                <div className="space-y-1">
                  {invalidWallets.slice(0, 3).map((address, index) => {
                    const trimmed = address.trim();
                    const displayAddress = trimmed.length > 20 
                      ? `${trimmed.slice(0, 8)}...${trimmed.slice(-8)}`
                      : trimmed;
                    return (
                      <div key={index} className="text-xs text-gray-700 font-mono">
                        {displayAddress} ({trimmed.length} chars, need 32-44)
                      </div>
                    );
                  })}
                  {invalidWallets.length > 3 && (
                    <div className="text-xs text-gray-700">
                      ...and {invalidWallets.length - 3} more
                    </div>
                  )}
                </div>
                <p className="text-xs text-gray-600">
                  💡 Valid Solana addresses are 32-44 characters long
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Analysis Controls */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isRunning && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Analyzing... {Math.round(jobProgress)}%</span>
              </div>
            )}
          </div>
          
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <Button
                    onClick={handleAnalyze}
                    disabled={isDisabled || isRunning}
                    className="min-w-[100px]"
                  >
                    {isRunning ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Analyzing
                      </>
                    ) : (
                      'Analyze'
                    )}
                  </Button>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                {isRunning ? (
                  <p>Analysis in progress...</p>
                ) : wallets.length === 0 ? (
                  <p>Please enter wallet addresses to analyze</p>
                ) : wallets.length < 2 ? (
                  <p>Please enter at least 2 wallet addresses</p>
                ) : wallets.length > 50 ? (
                  <p>Maximum 50 wallet addresses allowed</p>
                ) : hasErrors ? (
                  <p>Please fix invalid addresses before analyzing</p>
                ) : (
                  <p>Click to start similarity analysis</p>
                )}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
    </div>
  );
} 