"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import WatchedTokenList from '@/components/tokens/WatchedTokenList';
import GlobalChat from '@/components/chat/GlobalChat';
import TokenThread from '@/components/chat/TokenThread';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useRouter, useSearchParams } from 'next/navigation';

export default function TokensPage() {
  const [selectedToken, setSelectedToken] = useState<string | null>(null);
  const isXL = useMediaQuery('(min-width: 1280px)');
  const router = useRouter();
  const search = useSearchParams();

  // Reflect query params ?view=token&addr=...&mid=...
  const qpView = search.get('view');
  const qpAddr = search.get('addr');
  const qpMid = search.get('mid');

  // Sync selected token with URL hash #thread=<addr> and query params
  useEffect(() => {
    const readHash = () => {
      const h = (typeof window !== 'undefined' ? window.location.hash : '') || '';
      const m = h.match(/^#thread=([^&]+)/);
      const addr = m?.[1] ? decodeURIComponent(m[1]) : null;
      if (addr) setSelectedToken(addr);
    };
    // Prefer query params; fallback to hash once on mount
    if (qpView === 'token' && qpAddr) {
      setSelectedToken(qpAddr);
    } else {
      readHash();
    }
    const onHash = () => readHash();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [qpAddr, qpView]);

  const handleSelect = useCallback((addr: string) => {
    // Shallow push query params; keep hash for backward compat
    router.push(`/tokens?view=token&addr=${encodeURIComponent(addr)}${qpMid ? `&mid=${encodeURIComponent(qpMid)}` : ''}`, { scroll: false });
    if (typeof window !== 'undefined') {
      window.location.hash = `#thread=${encodeURIComponent(addr)}`;
    }
    setSelectedToken(addr);
  }, [qpMid, router]);

  return (
    <div className="min-h-[100dvh] h-[100dvh] overflow-hidden flex flex-col">
      <div className="p-3 border-b border-border text-sm font-medium">Watched Tokens</div>
      {/* Tri‑pane workspace: nav | main | drawer */}
      <div className="flex-1 grid grid-cols-1 xl:grid-cols-[300px_1fr_380px] gap-0 h-full overflow-hidden">
        {/* Sidebar */}
        <nav className="border-r border-border overflow-auto" aria-label="Watched tokens">
          <WatchedTokenList onSelect={handleSelect} />
        </nav>

        {/* Center feed */}
        <main className="h-full flex flex-col overflow-hidden" aria-label="Global chat feed">
          <div className="flex-1 min-h-0 overflow-hidden">
            <GlobalChat />
          </div>
        </main>

        {/* Right drawer: shows token thread when selected; collapses below xl */}
        <aside className={`hidden xl:flex h-full flex-col overflow-hidden border-l border-border ${selectedToken ? '' : 'opacity-60'}`} aria-label="Token thread drawer">
          {selectedToken ? (
            <TokenThread tokenAddress={selectedToken} highlightId={qpMid || undefined} />
          ) : (
            <div className="h-full w-full flex items-center justify-center text-sm text-muted-foreground p-6">
              Select a token to open its thread
            </div>
          )}
        </aside>
      </div>

      {/* Mobile/tablet: fall back to modal for the token thread */}
      <Dialog
        open={!!selectedToken && !isXL}
        onOpenChange={(open) => {
          if (!open) {
            if (typeof window !== 'undefined') {
              window.location.hash = '';
            }
            setSelectedToken(null);
          }
        }}
      >
        <DialogContent className="xl:hidden max-w-3xl w-full p-0 sm:max-w-3xl sm:rounded-lg rounded-none h-[100dvh] sm:h-auto">
          <DialogTitle className="sr-only">Token Thread</DialogTitle>
          {selectedToken ? <TokenThread tokenAddress={selectedToken} highlightId={qpMid || undefined} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}


