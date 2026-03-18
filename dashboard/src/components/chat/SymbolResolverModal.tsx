"use client";

import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface Candidate {
  tokenAddress: string;
  name?: string | null;
  symbol?: string | null;
}

interface Props {
  open: boolean;
  symbol: string;
  candidates: Candidate[];
  onCancel: () => void;
  onChoose: (address: string) => void;
}

export default function SymbolResolverModal({ open, symbol, candidates, onCancel, onChoose }: Props) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Resolve symbol @{symbol}</DialogTitle>
          <DialogDescription>Select the token address to use.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          {candidates.length === 0 && (
            <div className="text-sm text-muted-foreground">No matches found.</div>
          )}
          {candidates.map((c) => (
            <div key={c.tokenAddress} className="flex items-center justify-between border rounded px-2 py-1">
              <div className="text-sm">
                <div className="font-medium">{c.name ?? c.symbol ?? c.tokenAddress.slice(0,6)}</div>
                <div className="text-xs text-muted-foreground">{c.tokenAddress}</div>
              </div>
              <Button size="sm" onClick={() => onChoose(c.tokenAddress)}>Use</Button>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


