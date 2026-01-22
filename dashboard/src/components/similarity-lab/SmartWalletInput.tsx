'use client';

import { useMemo, useEffect, useRef } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Loader2, Search } from 'lucide-react';
import { isValidSolanaAddress } from '@/lib/solana-utils';

interface SmartWalletInputProps {
  value: string;
  onChange: (value: string) => void;
  onAnalyze: () => void;
  isAnalyzing: boolean;
  onTokenDetected?: (token: string) => void;
  selectedHolderCount?: number;
}

export function SmartWalletInput({
  value,
  onChange,
  onAnalyze,
  isAnalyzing,
  onTokenDetected,
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

  // Detect token address (first valid 32-44 char address) - memoize to prevent re-triggers
  const detectedToken = useMemo(() => {
    return wallets.find(w => w.length >= 32 && w.length <= 44 && isValidSolanaAddress(w));
  }, [wallets]);

  // Track last detected token to prevent re-triggering onTokenDetected
  const lastDetectedTokenRef = useRef<string | undefined>();

  useEffect(() => {
    if (detectedToken && detectedToken !== lastDetectedTokenRef.current && onTokenDetected) {
      lastDetectedTokenRef.current = detectedToken;
      onTokenDetected(detectedToken);
    } else if (!detectedToken && lastDetectedTokenRef.current) {
      // Token was removed, clear the ref
      lastDetectedTokenRef.current = undefined;
    }
  }, [detectedToken, onTokenDetected]);

  // Count custom wallets (exclude token address)
  const customWalletCount = useMemo(() => {
    return validWallets.filter(w => w !== detectedToken).length;
  }, [validWallets, detectedToken]);

  // Total count = holders + custom wallets
  const totalCount = selectedHolderCount + customWalletCount;

  // Count truly invalid addresses (not valid Solana addresses)
  const invalidCount = useMemo(() => {
    return invalidWallets.filter(w => w !== detectedToken).length;
  }, [invalidWallets, detectedToken]);

  // Status message
  const statusMessage = useMemo(() => {
    if (wallets.length === 0 && selectedHolderCount === 0) {
      return 'Paste wallet or token addresses';
    }

    const parts: string[] = [];

    if (selectedHolderCount > 0) {
      parts.push(`${selectedHolderCount} from holders`);
    }

    if (customWalletCount > 0) {
      parts.push(`${customWalletCount} custom`);
    }

    if (invalidCount > 0) {
      parts.push(`${invalidCount} invalid`);
    }

    if (detectedToken && selectedHolderCount === 0) {
      parts.push('token detected (select holders on right)');
    }

    const summary = parts.join(' • ');

    if (totalCount >= 2) {
      return `${summary} • Ready to analyze`;
    } else if (totalCount === 1) {
      return `${summary} • Add at least one more`;
    } else if (totalCount === 0 && detectedToken) {
      return 'Token detected • Select holders to analyze';
    }

    return summary || 'Enter wallet addresses';
  }, [wallets.length, customWalletCount, invalidCount, detectedToken, selectedHolderCount, totalCount]);

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
        <label htmlFor="walletInput" className="text-sm font-medium">
          Wallet Addresses
        </label>
        <Textarea
          id="walletInput"
          placeholder="Paste wallet or token addresses&#10;Accepts: comma-separated, space-separated, or one per line&#10;Token addresses will show holder selection on the right"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={isAnalyzing}
          className="min-h-[320px] font-mono text-sm resize-y"
          rows={15}
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className={`text-xs ${statusColor} flex-1`}>
          {statusMessage}
        </p>

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
