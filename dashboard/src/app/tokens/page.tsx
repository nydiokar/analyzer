"use client";

import React, { useCallback, useEffect, useState } from 'react';
import WatchedTokenList from '@/components/tokens/WatchedTokenList';
import GlobalChat from '@/components/chat/GlobalChat';
import TokenThread from '@/components/chat/TokenThread';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

export default function TokensPage() {
  const [selectedToken, setSelectedToken] = useState<string | null>(null);

  // Sync selected token with URL hash #thread=<addr>
  useEffect(() => {
    const readHash = () => {
      const h = (typeof window !== 'undefined' ? window.location.hash : '') || '';
      const m = h.match(/^#thread=([^&]+)/);
      const addr = m?.[1] ? decodeURIComponent(m[1]) : null;
      setSelectedToken(addr);
    };
    readHash();
    const onHash = () => readHash();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const handleSelect = useCallback((addr: string) => {
    if (typeof window !== 'undefined') {
      window.location.hash = `#thread=${encodeURIComponent(addr)}`;
    }
    setSelectedToken(addr);
  }, []);
  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b border-border text-sm font-medium">Watched Tokens</div>
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-0 h-full">
        <div className="border-r border-border overflow-auto">
          <WatchedTokenList onSelect={handleSelect} />
        </div>
        <div className="h-full flex flex-col overflow-hidden">
          <div className="flex-1 min-h-0 overflow-auto">
            <GlobalChat />
          </div>
        </div>
      </div>

      <Dialog open={!!selectedToken} onOpenChange={(open) => {
        if (!open) {
          if (typeof window !== 'undefined') {
            window.location.hash = '';
          }
          setSelectedToken(null);
        }
      }}>
        <DialogContent className="max-w-3xl w-full p-0 sm:max-w-3xl sm:rounded-lg rounded-none h-[100dvh] sm:h-auto">
          <DialogTitle className="sr-only">Token Thread</DialogTitle>
          {selectedToken ? <TokenThread tokenAddress={selectedToken} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}


