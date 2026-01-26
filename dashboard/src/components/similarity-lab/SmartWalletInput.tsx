'use client';

import { useMemo } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Loader2, Search, X } from 'lucide-react';
import { isValidSolanaAddress } from '@/lib/solana-utils';

interface SmartWalletInputProps {
  value: string;
  onChange: (value: string) => void;
  onAnalyze: () => void;
  isAnalyzing: boolean;
  selectedHolderCount?: number;
}

export function SmartWalletInput({
  value,
  onChange,
  onAnalyze,
  isAnalyzing,
  selectedHolderCount = 0,
}: SmartWalletInputProps) {
  // Parse wallets from textarea - flexible parsing (newlines, commas, spaces)
  const wallets = useMemo(() => {
    return value
      .split(/[\n,\s]+/) // Split by newlines, commas, or spaces
      .map(line => line.trim())
      .filter(Boolean);
  }, [value]);

  const validWallets = useMemo(() => {
    return wallets.filter(w => isValidSolanaAddress(w));
  }, [wallets]);

  const invalidWallets = useMemo(() => {
    return wallets.filter(w => !isValidSolanaAddress(w));
  }, [wallets]);

  // Total count = holders + valid custom wallets
  const totalCount = selectedHolderCount + validWallets.length;

  // Count truly invalid addresses (not valid Solana addresses)
  const invalidCount = useMemo(() => {
    return invalidWallets.length;
  }, [invalidWallets]);

  // Status message
  const statusMessage = useMemo(() => {
    if (wallets.length === 0 && selectedHolderCount === 0) {
      return '';
    }

    const parts: string[] = [];

    if (selectedHolderCount > 0) {
      parts.push(`${selectedHolderCount} from holders`);
    }

    if (validWallets.length > 0) {
      parts.push(`${validWallets.length} custom`);
    }

    if (invalidCount > 0) {
      parts.push(`${invalidCount} invalid`);
    }

    const summary = parts.join(' | ');

    if (totalCount >= 2) {
      return `${summary} | Ready to analyze`;
    } else if (totalCount === 1) {
      return `${summary} | Add at least one more`;
    }

    return summary || '';
  }, [wallets.length, validWallets.length, invalidCount, selectedHolderCount, totalCount]);

  const statusColor = useMemo(() => {
    if (invalidCount > 0 && totalCount < 2) {
      return 'text-red-600 dark:text-red-500';
    }
    if (invalidCount > 0) {
      return 'text-yellow-600 dark:text-yellow-500';
    }
    if (totalCount >= 2) {
      return 'text-green-600 dark:text-green-500';
    }
    return 'text-muted-foreground';
  }, [invalidCount, totalCount]);

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label htmlFor="walletInput" className="text-sm font-medium">
            Wallet Addresses
          </label>
          {value && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onChange('')}
              disabled={isAnalyzing}
              className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3 mr-1" />
              Clear All
            </Button>
          )}
        </div>
        <Textarea
          id="walletInput"
          placeholder="Paste wallet addresses.&#10; Accepts: comma-separated, space-separated, or one per line."
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={isAnalyzing}
          className="min-h-[180px] max-h-[400px] font-mono text-sm resize-y bg-muted/30 border-foreground/20 shadow-sm focus-visible:ring-2 focus-visible:ring-primary/40"
          rows={8}
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        {statusMessage && (
          <p className={`text-xs ${statusColor} flex-1`}>
            {statusMessage}
          </p>
        )}

        <Button
          onClick={onAnalyze}
          disabled={isAnalyzing || totalCount < 2}
          size="sm"
          className="h-9 px-5"
        >
          {isAnalyzing ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Analyzing
            </>
          ) : (
            <>
              <Search className="mr-2 h-4 w-4" /> Analyze ({totalCount})
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
