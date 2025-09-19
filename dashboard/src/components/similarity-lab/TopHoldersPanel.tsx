'use client';

import { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useTopHolders } from '@/hooks/useTopHolders';
import type { TopHolderItem } from '@/types/api';
import { WalletBadge } from '@/components/shared/WalletBadge';
import { toast } from 'sonner';

interface Props {
  onAddToSet?: (wallets: string[]) => void;
}

export function TopHoldersPanel({ onAddToSet }: Props) {
  const [mint, setMint] = useState('');
  const [commitment, setCommitment] = useState<'finalized' | 'confirmed' | 'processed' | undefined>('finalized');
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [ownersOnly, setOwnersOnly] = useState<boolean>(true);

  const { data, isLoading } = useTopHolders(mint || undefined, commitment);
  const holdersRaw: TopHolderItem[] = data?.holders || [];
  const holders: TopHolderItem[] = useMemo(() => ownersOnly ? holdersRaw.filter(h => !!h.ownerAccount) : holdersRaw, [holdersRaw, ownersOnly]);

  const allSelected = useMemo(() => holders.length > 0 && holders.every(h => selected[h.ownerAccount || h.tokenAccount]), [holders, selected]);

  const toggleAll = () => {
    if (holders.length === 0) return;
    if (allSelected) {
      setSelected({});
    } else {
      const next: Record<string, boolean> = {};
      holders.forEach(h => { next[h.ownerAccount || h.tokenAccount] = true; });
      setSelected(next);
    }
  };

  const addSelected = () => {
    const wallets = holders
      .map(h => h.ownerAccount || '')
      .filter(Boolean);
    const chosen = wallets.filter(w => selected[w]);
    if (chosen.length > 0 && onAddToSet) {
      onAddToSet(chosen);
      toast.success(`Added ${chosen.length} wallet${chosen.length > 1 ? 's' : ''} to the set`);
    }
  };

  const copySelected = async () => {
    const wallets = holders
      .map(h => h.ownerAccount || '')
      .filter(Boolean)
      .filter(w => selected[w]);
    if (wallets.length === 0) {
      toast.info('Nothing to copy');
      return;
    }
    try {
      await navigator.clipboard.writeText(wallets.join('\n'));
      toast.success(`Copied ${wallets.length} wallet${wallets.length > 1 ? 's' : ''}`);
    } catch {
      toast.error('Copy failed');
    }
  };

  return (
    <Card className="p-4 space-y-3">
      <div className="flex gap-2">
        <Input placeholder="Enter token mint" value={mint} onChange={e => setMint(e.target.value.trim())} />
        <Select value={commitment} onValueChange={(v: any) => setCommitment(v)}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="commitment" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="finalized">finalized</SelectItem>
            <SelectItem value="confirmed">confirmed</SelectItem>
            <SelectItem value="processed">processed</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="secondary" onClick={toggleAll} disabled={!holders.length}>
          {allSelected ? 'Unselect all' : 'Select all'}
        </Button>
        {onAddToSet && (
          <Button onClick={addSelected} disabled={!Object.values(selected).some(Boolean)}>Add to Similarity Set</Button>
        )}
        <Button variant="outline" onClick={copySelected} disabled={!Object.values(selected).some(Boolean)}>Copy Selected</Button>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground mb-2 px-1">
        <label className="flex items-center gap-2 select-none">
          <input type="checkbox" checked={ownersOnly} onChange={(e) => setOwnersOnly(e.target.checked)} />
          Owners only (exclude unknown/program accounts)
        </label>
        <div>{holders.length} holders • {Object.values(selected).filter(Boolean).length} selected</div>
      </div>

      {!ownersOnly && (
        <div className="text-xs text-muted-foreground mb-2">
          Note: entries without ownerAccount will not be added to the similarity set.
        </div>
      )}

      <ScrollArea className="h-96 border rounded-md">
        <div className="min-w-full">
          {isLoading && <div className="p-3 text-sm text-muted-foreground">Loading...</div>}
          {!isLoading && holders.length === 0 && mint && (
            <div className="p-3 text-sm text-muted-foreground">No holders found.</div>
          )}
          {!isLoading && holders.length > 0 && (
            <div className="grid grid-cols-[60px_1fr_160px_28px] px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground border-b">
              <div>Rank</div>
              <div>Account</div>
              <div className="text-right">Amount</div>
              <div></div>
            </div>
          )}
          {!isLoading && holders.map(h => {
            const key = h.ownerAccount || h.tokenAccount;
            const checked = !!selected[key];
            const isUnknown = !h.ownerAccount;
            const formatAmount = (uiStr?: string | number | null, raw?: string) => {
              const ui = typeof uiStr === 'string' ? parseFloat(uiStr) : typeof uiStr === 'number' ? uiStr : NaN;
              if (!isNaN(ui)) {
                return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(ui);
              }
              const n = raw ? Number(raw) : NaN;
              if (!isNaN(n)) return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n);
              return uiStr ?? raw ?? '';
            };
            return (
              <div key={key} className={`grid grid-cols-[60px_1fr_160px_28px] items-center gap-3 px-3 py-2 border-b text-sm ${isUnknown ? 'opacity-70' : ''}`}>
                <div className="text-muted-foreground">{h.rank}</div>
                <div className="truncate" title={h.ownerAccount || h.tokenAccount}>
                  <WalletBadge address={h.ownerAccount || h.tokenAccount} />
                </div>
                <div className="text-right tabular-nums">{formatAmount(h.uiAmountString, h.amount)}</div>
                <input type="checkbox" checked={checked} onChange={() => setSelected(s => ({ ...s, [key]: !checked }))} disabled={isUnknown} />
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </Card>
  );
}


