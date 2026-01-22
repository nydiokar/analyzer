'use client';

import { useMemo, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { WalletBadge } from '@/components/shared/WalletBadge';
import { TokenBadge } from '@/components/shared/TokenBadge';
import { Loader2 } from 'lucide-react';
import { useTopHolders, useTokenMetadata } from '@/hooks/useTopHolders';
import type { TopHolderItem } from '@/types/api';

interface TokenHolderPickerProps {
  tokenMint: string;
  selectedAddresses: string[];
  onSelectionChange: (addresses: string[]) => void;
}

export function TokenHolderPicker({ tokenMint, selectedAddresses, onSelectionChange }: TokenHolderPickerProps) {
  // Fetch holders (cached by react-query)
  const { data: holdersData, isLoading } = useTopHolders(tokenMint, 'finalized');
  const { meta: tokenMetadata } = useTokenMetadata(tokenMint);

  const holders: TopHolderItem[] = useMemo(
    () => (holdersData?.holders || []).filter(h => !!h.ownerAccount),
    [holdersData]
  );

  // Auto-select top 10 on first load (only when holders first load)
  const [hasAutoSelected, setHasAutoSelected] = useState(false);

  useEffect(() => {
    if (holders.length > 0 && !hasAutoSelected) {
      const top10 = holders
        .slice(0, 10)
        .map(h => h.ownerAccount || h.tokenAccount)
        .filter(Boolean);
      onSelectionChange(top10);
      setHasAutoSelected(true);
    }
  }, [holders, hasAutoSelected, onSelectionChange]);

  const toggleHolder = (address: string) => {
    if (selectedAddresses.includes(address)) {
      onSelectionChange(selectedAddresses.filter(a => a !== address));
    } else {
      onSelectionChange([...selectedAddresses, address]);
    }
  };

  const selectAll = () => {
    const allAddresses = holders
      .map(h => h.ownerAccount || h.tokenAccount)
      .filter(Boolean);
    onSelectionChange(allAddresses);
  };

  const clearAll = () => {
    onSelectionChange([]);
  };

  const systemWalletCount = useMemo(() => {
    return holders.filter(h =>
      selectedAddresses.includes(h.ownerAccount || h.tokenAccount) && h.knownType === 'SYSTEM'
    ).length;
  }, [holders, selectedAddresses]);

  const formatAmount = (uiStr?: string | number | null, raw?: string) => {
    const ui = typeof uiStr === 'string' ? parseFloat(uiStr) : typeof uiStr === 'number' ? uiStr : NaN;
    if (!isNaN(ui)) return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(ui);
    const n = raw ? Number(raw) : NaN;
    if (!isNaN(n)) return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n);
    return uiStr ?? raw ?? '';
  };

  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>Loading holders...</span>
        </div>
      </div>
    );
  }

  if (holders.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="text-xs text-muted-foreground py-4">
          No holders found
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full space-y-2">
      {/* Compact Header */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium"></span>
            <TokenBadge
              mint={tokenMint}
              metadata={tokenMetadata ? {
                name: tokenMetadata.name ?? undefined,
                symbol: tokenMetadata.symbol ?? undefined,
                imageUrl: tokenMetadata.imageUrl ?? undefined,
              } : undefined}
              variant="inline"
              size="s"
            />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {selectedAddresses.length} / {holders.length}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={selectAll} className="h-6 text-xs px-2">
              All
            </Button>
            <Button variant="ghost" size="sm" onClick={clearAll} className="h-6 text-xs px-2">
              Clear
            </Button>
          </div>
        </div>

        {/* System Wallet Warning */}
        {systemWalletCount > 0 && (
          <Alert variant="default" className="border-yellow-500/50 bg-yellow-50 dark:bg-yellow-950/20 py-1.5">
            <AlertDescription className="text-[10px] leading-tight">
              {systemWalletCount} system wallet{systemWalletCount !== 1 ? 's' : ''} (may be filtered)
            </AlertDescription>
          </Alert>
        )}
      </div>

      {/* Ultra Compact Holder Table */}
      <div className="border rounded-md flex-1 overflow-y-auto">
        <div className="min-w-full">
          {/* Minimal Header */}
          <div className="sticky top-0 grid grid-cols-[24px_28px_1fr] gap-1 px-1.5 py-1 text-[10px] font-medium text-muted-foreground border-b bg-muted/90 backdrop-blur">
            <div></div>
            <div>#</div>
            <div>Wallet</div>
          </div>

          {/* Ultra Compact Rows */}
          {holders.map(h => {
            const key = h.ownerAccount || h.tokenAccount;
            const checked = selectedAddresses.includes(key);
            const isUnknown = !h.ownerAccount;

            return (
              <div
                key={key}
                className={`grid grid-cols-[24px_28px_1fr] items-center gap-1 px-1.5 py-1 border-b last:border-0 text-[10px] hover:bg-muted/30 transition-colors ${
                  isUnknown ? 'opacity-50' : ''
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleHolder(key)}
                  disabled={isUnknown}
                  className="cursor-pointer w-3 h-3"
                />
                <div className="text-muted-foreground text-[10px]">#{h.rank}</div>
                <div className="truncate text-[10px]" title={key}>
                  <WalletBadge
                    address={key}
                    knownType={h.knownType}
                    knownLabel={h.knownLabel}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
